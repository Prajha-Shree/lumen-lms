"""Frame analysis for proctoring.

PRIVACY (ADR-2): frames arrive as bytes, are decoded and analyzed in memory, and are
discarded when the request ends. Nothing is written to disk or logged; only the
structured result below leaves this module.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from app.proctoring.pose import HeadPose, gaze_offset, head_pose_from_matrix, is_looking_away

MAX_FRAME_BYTES = 512 * 1024
MAX_SIDE = 640  # frames are downscaled before inference; plenty for face presence/pose


class FrameError(ValueError):
    pass


@dataclass(frozen=True)
class FrameAnalysis:
    faces: int
    looking_away: bool
    reason: str | None
    pose: HeadPose | None
    gaze: float | None
    confidence: float  # 0..1: how much to trust this frame's result (face presence score / lighting)
    brightness: float  # mean luma 0..1, lets the UI suggest better lighting


class FrameAnalyzer(Protocol):
    def analyze(self, rgb: np.ndarray) -> FrameAnalysis: ...


def decode_frame(data: bytes) -> np.ndarray:
    """JPEG/PNG/WebP bytes → RGB uint8 array, downscaled to at most MAX_SIDE."""
    import cv2  # local import keeps the API importable without the CV stack

    if not data:
        raise FrameError("Empty frame")
    if len(data) > MAX_FRAME_BYTES:
        raise FrameError(f"Frame too large ({len(data)} bytes, max {MAX_FRAME_BYTES})")
    bgr = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        raise FrameError("Could not decode image")
    h, w = bgr.shape[:2]
    scale = MAX_SIDE / max(h, w)
    if scale < 1:
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


class MediaPipeAnalyzer:
    """MediaPipe FaceLandmarker (Tasks API): up to 3 faces, 478 landmarks with iris,
    plus the facial transformation matrix used for head pose."""

    def __init__(self, model_path: Path):
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        self._mp = mp
        options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=3,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            output_facial_transformation_matrixes=True,
        )
        self._landmarker = vision.FaceLandmarker.create_from_options(options)
        # The landmarker isn't documented as thread-safe; FastAPI runs sync endpoints
        # in a thread pool, so serialize access. Scale out with more worker processes.
        self._lock = threading.Lock()

    def analyze(self, rgb: np.ndarray) -> FrameAnalysis:
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        with self._lock:
            result = self._landmarker.detect(image)
        brightness = float(rgb.mean() / 255.0)
        faces = len(result.face_landmarks)
        if faces == 0:
            return FrameAnalysis(0, False, None, None, None, confidence=0.8 if brightness > 0.15 else 0.4, brightness=brightness)

        # The largest face is the test taker; others count toward MULTIPLE_FACES.
        def area(lms) -> float:
            xs = [p.x for p in lms]
            ys = [p.y for p in lms]
            return (max(xs) - min(xs)) * (max(ys) - min(ys))

        idx = max(range(faces), key=lambda i: area(result.face_landmarks[i]))
        landmarks = [(p.x, p.y) for p in result.face_landmarks[idx]]
        pose = head_pose_from_matrix(result.facial_transformation_matrixes[idx])
        gaze = gaze_offset(landmarks)
        away, reason = is_looking_away(pose, gaze)
        # Small faces (far from camera) and dim frames are less trustworthy.
        size_conf = min(1.0, area(result.face_landmarks[idx]) / 0.04)
        light_conf = min(1.0, brightness / 0.25)
        return FrameAnalysis(
            faces=faces,
            looking_away=away,
            reason=reason,
            pose=pose,
            gaze=None if gaze is None else round(gaze, 3),
            confidence=round(0.5 + 0.5 * min(size_conf, light_conf), 2),
            brightness=round(brightness, 2),
        )


_analyzer: FrameAnalyzer | None = None
_load_error: str | None = None
_load_lock = threading.Lock()


def get_analyzer(model_path: Path) -> FrameAnalyzer | None:
    """Lazily loads the model once. Returns None (and remembers why) if unavailable."""
    global _analyzer, _load_error
    if _analyzer is not None:
        return _analyzer
    with _load_lock:
        if _analyzer is None:
            # A missing file is re-checked on every call (cheap), so downloading the
            # model later takes effect without a restart. Load failures are cached.
            if not model_path.exists():
                _load_error = f"Model file not found at {model_path}. Run: python -m app.proctoring.download_model"
            elif _load_error is None or "not found" in _load_error:
                try:
                    _analyzer = MediaPipeAnalyzer(model_path)
                    _load_error = None
                except Exception as e:  # noqa: BLE001 - surface any load failure as "unavailable"
                    _load_error = f"Failed to load model: {e}"
    return _analyzer


def load_error() -> str | None:
    return _load_error
