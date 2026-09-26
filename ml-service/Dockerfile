FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# MediaPipe pulls in a GUI OpenCV build that links against libGL/glib.
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/app
COPY requirements.txt requirements-cv.txt ./
RUN pip install -r requirements.txt -r requirements-cv.txt
# Face model for proctoring (~3.6 MB, Google's official MediaPipe model storage).
COPY app ./app
RUN python -m app.proctoring.download_model

FROM base AS dev
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM base AS prod
COPY app ./app
RUN useradd --create-home appuser
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
