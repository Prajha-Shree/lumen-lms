import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app

TOKEN = "test-internal-token"


@pytest.fixture
def client() -> TestClient:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(internal_service_token=TOKEN)
    return TestClient(app, headers={"X-Internal-Token": TOKEN})
