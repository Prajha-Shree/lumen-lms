import cv2
import numpy as np
import pytest

from app.config import Settings, get_settings
from app.main import create_app
from app.proctoring.analyzer import MAX_FRAME_BYTES, FrameAnalysis, FrameError, decode_frame
from app.proctoring.pose import HeadPose, gaze_offset, head_pose_from_matrix, is_looking_away, rotation_matrix
from app.routers.proctoring import analyzer_dependency
from fastapi.testclient import TestClient

TOKEN = "test-internal-token"


def jpeg(w=320, h=240, value=128) -> bytes:
    ok, buf = cv2.imencode(".jpg", np.full((h, w, 3), value, dtype=np.uint8))
    assert ok
    return buf.tobytes()


# ─── Pose geometry ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("yaw,pitch,roll", [(0, 0, 0), (35, 0, 0), (-20, 10, 5), (0, -30, 0), (10, 20, -15)])
def test_head_pose_roundtrip(yaw, pitch, roll):
    pose = head_pose_from_matrix(rotation_matrix(yaw, pitch, roll))
    assert pose.yaw == pytest.approx(yaw, abs=0.2)
    assert pose.pitch == pytest.approx(pitch, abs=0.2)
    assert pose.roll == pytest.approx(roll, abs=0.2)


def _landmarks(iris_frac: float):
    """478 points with both eyes spanning x∈[0.4, 0.5] and irises at the given fraction."""
    pts = [(0.5, 0.5)] * 478
    pts[33], pts[133] = (0.40, 0.4), (0.50, 0.4)
    pts[362], pts[263] = (0.55, 0.4), (0.65, 0.4)
    pts[468] = (0.40 + 0.10 * iris_frac, 0.4)
    pts[473] = (0.55 + 0.10 * iris_frac, 0.4)
    return pts


def test_gaze_offset_centered_and_averted():
    assert gaze_offset(_landmarks(0.5)) == pytest.approx(0.0)
    assert gaze_offset(_landmarks(0.9)) == pytest.approx(0.4)
    assert gaze_offset([(0.0, 0.0)] * 468) is None  # no iris landmarks


def test_looking_away_rules():
    frontal = HeadPose(0, 0, 0)
    assert is_looking_away(frontal, 0.0) == (False, None)
    assert is_looking_away(HeadPose(40, 0, 0), 0.0) == (True, "head turned")
    assert is_looking_away(HeadPose(0, -30, 0), 0.0) == (True, "head tilted")
    assert is_looking_away(frontal, 0.35) == (True, "eyes averted")
    # A turned head makes iris offsets unreliable, so gaze alone doesn't count there.
    assert is_looking_away(HeadPose(20, 0, 0), 0.35) == (False, None)
    # Normal small movements are tolerated.
    assert is_looking_away(HeadPose(15, 12, 8), 0.1) == (False, None)


# ─── Decoding ────────────────────────────────────────────────────────────────


def test_decode_downscales_large_frames():
    rgb = decode_frame(jpeg(1280, 960))
    assert max(rgb.shape[:2]) == 640 and rgb.shape[2] == 3


def test_decode_rejects_garbage_and_oversize():
    with pytest.raises(FrameError):
        decode_frame(b"not an image")
    with pytest.raises(FrameError):
        decode_frame(b"\xff" * (MAX_FRAME_BYTES + 1))
    with pytest.raises(FrameError):
        decode_frame(b"")


# ─── API ─────────────────────────────────────────────────────────────────────


class FakeAnalyzer:
    def __init__(self, result: FrameAnalysis):
        self.result = result
        self.seen_shapes = []

    def analyze(self, rgb):
        self.seen_shapes.append(rgb.shape)
        return self.result


def make_client(analyzer=None, model_path="does/not/exist.task") -> TestClient:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(internal_service_token=TOKEN, face_model_path=model_path)
    if analyzer is not None:
        app.dependency_overrides[analyzer_dependency] = lambda: analyzer
    return TestClient(app, headers={"X-Internal-Token": TOKEN})


def test_analyze_returns_structured_signals_only():
    fake = FakeAnalyzer(FrameAnalysis(2, True, "head turned", HeadPose(40, 0, 0), 0.1, 0.9, 0.5))
    res = make_client(fake).post("/proctoring/analyze", content=jpeg(), headers={"Content-Type": "image/jpeg"})
    assert res.status_code == 200
    body = res.json()
    assert body == {
        "faces": 2,
        "lookingAway": True,
        "reason": "head turned",
        "pose": {"yaw": 40.0, "pitch": 0.0, "roll": 0.0},
        "gaze": 0.1,
        "confidence": 0.9,
        "brightness": 0.5,
    }
    assert fake.seen_shapes == [(240, 320, 3)]


def test_analyze_rejects_wrong_type_and_bad_bytes():
    client = make_client(FakeAnalyzer(FrameAnalysis(1, False, None, None, None, 1, 0.5)))
    assert client.post("/proctoring/analyze", content=b"{}", headers={"Content-Type": "application/json"}).status_code == 415
    assert client.post("/proctoring/analyze", content=b"xx", headers={"Content-Type": "image/jpeg"}).status_code == 422


def test_analyze_is_503_with_a_clear_message_when_model_missing():
    res = make_client().post("/proctoring/analyze", content=jpeg(), headers={"Content-Type": "image/jpeg"})
    assert res.status_code == 503
    assert "download_model" in res.json()["detail"]


def test_analyze_requires_internal_token():
    res = TestClient(create_app()).post("/proctoring/analyze", content=jpeg(), headers={"Content-Type": "image/jpeg"})
    assert res.status_code == 401
