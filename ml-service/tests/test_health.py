from typing import Annotated

from fastapi import Depends
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.security import require_internal_token


def make_client() -> TestClient:
    app = create_app()

    @app.get("/_protected", dependencies=[Depends(require_internal_token)])
    def protected() -> dict:
        return {"ok": True}

    app.dependency_overrides[get_settings] = lambda: Settings(internal_service_token="secret-token")
    return TestClient(app)


def test_health_reports_capabilities():
    res = make_client().get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert set(body["capabilities"]) == {"mediapipe", "opencv", "sklearn"}


def test_internal_token_required():
    client = make_client()
    assert client.get("/_protected").status_code == 401
    assert client.get("/_protected", headers={"X-Internal-Token": "wrong"}).status_code == 401
    assert client.get("/_protected", headers={"X-Internal-Token": "secret-token"}).status_code == 200
