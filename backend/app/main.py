from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app import auth, db
from app.routes import accounts, admin, boards, chat
from app.routes.accounts import DEMO_PASSWORD, DEMO_USERNAME, create_account

STATIC_DIR = Path(__file__).parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    if create_account(DEMO_USERNAME, DEMO_PASSWORD) is None:
        db.ensure_password(DEMO_USERNAME, auth.hash_password(DEMO_PASSWORD))
    # There is always someone who can manage users: if nobody is an admin, the demo account is.
    db.ensure_an_admin(DEMO_USERNAME)
    yield


# One schema per model for requests and responses, so fields with defaults (such as a
# card's optional priority) are optional in the generated TypeScript types too.
app = FastAPI(lifespan=lifespan, separate_input_output_schemas=False)
app.add_middleware(
    SessionMiddleware,
    secret_key=auth.session_secret(),
    https_only=auth.https_only(),
    same_site="lax",
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


for module in (accounts, admin, boards, chat):
    app.include_router(module.router)

# Last, so the /api routes above take priority over the static site.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
