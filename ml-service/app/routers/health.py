import importlib.util

from fastapi import APIRouter

from app import __version__

router = APIRouter(tags=["health"])


def _installed(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


@router.get("/health")
def health() -> dict:
    # Capabilities tell the backend which pipelines this instance can serve, e.g. a
    # host where only requirements.txt was installed reports mediapipe/opencv False.
    return {
        "status": "ok",
        "service": "lms-ml-service",
        "version": __version__,
        "capabilities": {
            "mediapipe": _installed("mediapipe"),
            "opencv": _installed("cv2"),
            "sklearn": _installed("sklearn"),
        },
    }
