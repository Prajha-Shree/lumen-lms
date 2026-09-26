from fastapi import FastAPI

from app import __version__
from app.routers import health


def create_app() -> FastAPI:
    app = FastAPI(
        title="LMS ML Service",
        version=__version__,
        description="Cognitive profiling, adaptive recommendations, and proctoring inference.",
    )
    app.include_router(health.router)
    return app


app = create_app()
