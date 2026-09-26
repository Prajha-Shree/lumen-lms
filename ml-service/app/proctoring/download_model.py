"""Downloads the MediaPipe FaceLandmarker model from Google's official model storage.

    python -m app.proctoring.download_model

The Docker image runs this at build time. The file is ~3.6 MB and is git-ignored.
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

from app.config import get_settings

URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"


def main() -> int:
    dest = Path(get_settings().face_model_path)
    if dest.exists():
        print(f"Model already present: {dest}")
        return 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    print(f"Downloading {URL}\n  → {dest}")
    with urllib.request.urlopen(URL, timeout=60) as res, open(tmp, "wb") as f:
        while chunk := res.read(1 << 16):
            f.write(chunk)
    tmp.replace(dest)
    digest = hashlib.sha256(dest.read_bytes()).hexdigest()
    print(f"Done: {dest.stat().st_size / 1e6:.1f} MB, sha256 {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
