from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ml_env: Literal["development", "test", "production"] = "development"
    # Shared secret the backend sends in X-Internal-Token. The ml-service is never
    # called by browsers directly with this token.
    internal_service_token: str = "change-me-internal-token"
    # Which ranking strategy serves /recommendations (see app/recommender/registry.py).
    recommender: str = "rule-based"
    # MediaPipe FaceLandmarker model for proctoring (download_model.py fetches it).
    face_model_path: str = "models/face_landmarker.task"


@lru_cache
def get_settings() -> Settings:
    return Settings()
