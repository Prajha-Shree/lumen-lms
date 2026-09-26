from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.config import Settings, get_settings
from app.proctoring.analyzer import FrameAnalyzer, FrameError, decode_frame, get_analyzer, load_error
from app.security import require_internal_token

router = APIRouter(prefix="/proctoring", tags=["proctoring"], dependencies=[Depends(require_internal_token)])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


def analyzer_dependency(settings: Annotated[Settings, Depends(get_settings)]) -> FrameAnalyzer:
    analyzer = get_analyzer(Path(settings.face_model_path))
    if analyzer is None:
        raise HTTPException(status_code=503, detail=load_error() or "Face analysis unavailable")
    return analyzer


class PoseOut(BaseModel):
    yaw: float
    pitch: float
    roll: float


class AnalysisOut(BaseModel):
    faces: int
    lookingAway: bool
    reason: str | None
    pose: PoseOut | None
    gaze: float | None
    confidence: float
    brightness: float


@router.post("/analyze", response_model=AnalysisOut)
async def analyze(request: Request, analyzer: Annotated[FrameAnalyzer, Depends(analyzer_dependency)]) -> AnalysisOut:
    """Analyzes one webcam frame (raw image bytes in the body). The frame is never
    persisted or logged; only these derived signals are returned."""
    content_type = request.headers.get("content-type", "").split(";")[0].strip()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported frame type '{content_type}'")
    body = await request.body()
    try:
        rgb = decode_frame(body)
    except FrameError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    finally:
        del body
    result = analyzer.analyze(rgb)
    del rgb
    return AnalysisOut(
        faces=result.faces,
        lookingAway=result.looking_away,
        reason=result.reason,
        pose=PoseOut(yaw=result.pose.yaw, pitch=result.pose.pitch, roll=result.pose.roll) if result.pose else None,
        gaze=result.gaze,
        confidence=result.confidence,
        brightness=result.brightness,
    )
