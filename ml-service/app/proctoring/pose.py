"""Pure geometry for attention signals (no model, no I/O), unit-testable in isolation."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

# Thresholds are deliberately generous: false "looking away" flags on someone who
# glances at scratch paper or has a non-centered webcam are worse than misses. The
# backend additionally requires the condition to persist for several seconds.
YAW_LIMIT_DEG = 30.0
PITCH_LIMIT_DEG = 25.0
GAZE_OFFSET_LIMIT = 0.23  # iris offset from eye center, as a fraction of eye width

# MediaPipe face-mesh indices (478-point model with iris refinement).
EYE_A = (33, 133, 468)  # outer corner, inner corner, iris center
EYE_B = (362, 263, 473)


@dataclass(frozen=True)
class HeadPose:
    yaw: float
    pitch: float
    roll: float


def head_pose_from_matrix(m: Sequence[Sequence[float]]) -> HeadPose:
    """Euler angles (degrees) from the rotation part of MediaPipe's 4x4 facial
    transformation matrix. 0/0/0 means facing the camera squarely."""
    r = [[float(m[i][j]) for j in range(3)] for i in range(3)]
    sy = math.hypot(r[2][1], r[2][2])
    pitch = math.degrees(math.atan2(r[2][1], r[2][2]))
    yaw = math.degrees(math.atan2(-r[2][0], sy))
    roll = math.degrees(math.atan2(r[1][0], r[0][0]))
    return HeadPose(yaw=round(yaw, 1), pitch=round(pitch, 1), roll=round(roll, 1))


def rotation_matrix(yaw: float = 0.0, pitch: float = 0.0, roll: float = 0.0) -> list[list[float]]:
    """Builds R = Rz(roll) · Ry(yaw) · Rx(pitch) as a 4x4, matching `head_pose_from_matrix`."""
    y, p, r = (math.radians(v) for v in (yaw, pitch, roll))
    cy, sy_, cp, sp, cr, sr = math.cos(y), math.sin(y), math.cos(p), math.sin(p), math.cos(r), math.sin(r)
    m = [
        [cr * cy, cr * sy_ * sp - sr * cp, cr * sy_ * cp + sr * sp],
        [sr * cy, sr * sy_ * sp + cr * cp, sr * sy_ * cp - cr * sp],
        [-sy_, cy * sp, cy * cp],
    ]
    return [row + [0.0] for row in m] + [[0.0, 0.0, 0.0, 1.0]]


def gaze_offset(landmarks: Sequence[tuple[float, float]]) -> float | None:
    """Mean horizontal iris offset from each eye's center, in eye widths (−0.5..0.5).
    None if the iris landmarks aren't present."""
    if len(landmarks) < 478:
        return None
    offsets = []
    for a, b, iris in (EYE_A, EYE_B):
        left, right = sorted((landmarks[a][0], landmarks[b][0]))
        width = right - left
        if width <= 1e-6:
            continue
        offsets.append((landmarks[iris][0] - left) / width - 0.5)
    return sum(offsets) / len(offsets) if offsets else None


def is_looking_away(pose: HeadPose, gaze: float | None) -> tuple[bool, str | None]:
    if abs(pose.yaw) > YAW_LIMIT_DEG:
        return True, "head turned"
    if abs(pose.pitch) > PITCH_LIMIT_DEG:
        return True, "head tilted"
    # Eye direction only counts when the head is roughly frontal; otherwise the iris
    # estimate is unreliable.
    if gaze is not None and abs(pose.yaw) < 15 and abs(gaze) > GAZE_OFFSET_LIMIT:
        return True, "eyes averted"
    return False, None
