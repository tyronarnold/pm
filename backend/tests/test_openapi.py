import json
from pathlib import Path

from app.openapi import schema

SAVED = Path(__file__).parent.parent / "openapi.json"


def test_saved_openapi_schema_is_up_to_date():
    # The frontend's TypeScript types are generated from this file. If this fails,
    # run `npm run api:types` in frontend/ and commit both generated files.
    assert json.loads(SAVED.read_text()) == schema()
