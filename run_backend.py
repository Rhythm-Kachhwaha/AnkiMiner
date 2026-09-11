"""
AnkiMiner Backend Runner
------------------------
Convenience script to start the local FastAPI backend server for AnkiMiner.
Runs on http://127.0.0.1:8000.
"""

import os
import sys
import uvicorn

# Ensure the backend directory is on sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

if __name__ == "__main__":
    print("=" * 60)
    print("  AnkiMiner Local Backend Server")
    print("  URL:      http://127.0.0.1:8000")
    print("  API Docs: http://127.0.0.1:8000/docs")
    print("  Status:   http://127.0.0.1:8000/api/anki/status")
    print("=" * 60)
    print("Press Ctrl+C to stop the server.\n")

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        app_dir=BACKEND_DIR,
        reload=True,
    )
