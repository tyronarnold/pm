"""Write the API's OpenAPI schema to a file: `python -m app.openapi <path>`.

The frontend generates its TypeScript types from the saved schema
(`backend/openapi.json`), and a test fails if that file is out of date.
Regenerate both with `npm run api:types` in `frontend/`.
"""

import json
import sys
from pathlib import Path

from app.main import app


def schema() -> dict:
    return app.openapi()


if __name__ == "__main__":
    Path(sys.argv[1]).write_text(json.dumps(schema(), indent=2) + "\n")
