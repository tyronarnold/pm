"""Passwords, session settings and login rate limiting."""

import logging
import os
import secrets
import time

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError

logger = logging.getLogger(__name__)

hasher = PasswordHasher()  # argon2id with the library's recommended settings

# Checked when the username does not exist, so a wrong username takes as long as a wrong password
# (otherwise response times would reveal which usernames exist).
_DUMMY_HASH = hasher.hash(secrets.token_hex(16))


def hash_password(password: str) -> str:
    return hasher.hash(password)


def verify_password(stored_hash: str | None, password: str) -> bool:
    """Check a password against a stored hash; None (no such user) is always rejected."""
    try:
        hasher.verify(stored_hash or _DUMMY_HASH, password)
    except VerificationError:
        return False
    return stored_hash is not None


def session_secret() -> str:
    """The key that signs session cookies. Set SESSION_SECRET to keep sessions across restarts."""
    secret = os.environ.get("SESSION_SECRET")
    if not secret:
        logger.warning("SESSION_SECRET is not set; using a random secret, so restarts sign everyone out")
        return secrets.token_hex(32)
    return secret


def https_only() -> bool:
    """Set SESSION_HTTPS_ONLY=true when the app is served over HTTPS (the cookie is then marked Secure)."""
    return os.environ.get("SESSION_HTTPS_ONLY", "").lower() == "true"


# Login rate limiting: after MAX_FAILED_LOGINS failures for a username within
# LOCKOUT_SECONDS, further attempts for that username are refused until the oldest
# failure is older than the window. Keyed by username rather than client address,
# because behind Docker's port mapping every client has the same address.
# Kept in memory: it resets when the server restarts, which is fine for one process.
MAX_FAILED_LOGINS = 5
LOCKOUT_SECONDS = 15 * 60
failed_logins: dict[str, list[float]] = {}
now = time.monotonic  # replaced in tests


def _recent_failures(username: str) -> list[float]:
    cutoff = now() - LOCKOUT_SECONDS
    recent = [at for at in failed_logins.get(username, []) if at > cutoff]
    if recent:
        failed_logins[username] = recent
    else:
        failed_logins.pop(username, None)
    return recent


def is_locked_out(username: str) -> bool:
    return len(_recent_failures(username)) >= MAX_FAILED_LOGINS


def record_failure(username: str) -> None:
    failed_logins[username] = [*_recent_failures(username), now()]


def clear_failures(username: str) -> None:
    failed_logins.pop(username, None)
