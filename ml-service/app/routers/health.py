import importlib.util
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends

from app import __version__
from app.config import Settings, get_settings

router = APIRouter(tags=["health"])


def _installed(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


@router.get("/health")
def health(settings: Annotated[Settings, Depends(get_settings)]) -> dict:
    # Capabilities tell the backend which pipelines this instance can serve, e.g. a
    # host without the face model reports faceLandmarker False (proctoring degrades
    # to browser-only signals).
    return {
        "status": "ok",
        "service": "lms-ml-service",
        "version": __version__,
        "capabilities": {
            "mediapipe": _installed("mediapipe"),
            "opencv": _installed("cv2"),
            "sklearn": _installed("sklearn"),
            "faceLandmarker": Path(settings.face_model_path).exists(),
        },
    }
