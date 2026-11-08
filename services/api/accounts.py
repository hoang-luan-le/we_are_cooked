"""Auth0 sign-in: token verification and the account -> handle link.

Users sign in with Google or GitHub through Auth0, then claim a pseudonymous handle once.
Only the handle is ever shown to other people; the Auth0 subject stays server-side.
"""
from __future__ import annotations

import logging
import sqlite3
import threading
import time
from typing import Any, Callable

import httpx
import jwt

logger = logging.getLogger("incident_lab.accounts")
JWKS_CACHE_S = 600.0
JWKS_MIN_REFETCH_S = 30.0   # unknown key ids can't make us hammer Auth0
TIMEOUT_S = 5.0


class InvalidToken(Exception):
    pass


class HandleTaken(Exception):
    pass


class Auth0Verifier:
    """Verifies RS256 access tokens from https://<domain>/ for <audience>, using the tenant's JWKS."""

    def __init__(self, domain: str, audience: str, transport: httpx.BaseTransport | None = None,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.issuer = f"https://{domain.strip().rstrip('/')}/"
        self.audience = audience
        self._http = httpx.Client(timeout=TIMEOUT_S, transport=transport)
        self._clock = clock
        self._keys: dict[str, Any] = {}
        self._fetched_at = float("-inf")
        self._lock = threading.Lock()

    def close(self) -> None:
        self._http.close()

    def _signing_key(self, kid: str, refresh: bool = False) -> Any:
        with self._lock:
            since = self._clock() - self._fetched_at
            unknown_kid = kid not in self._keys and since >= JWKS_MIN_REFETCH_S
            if refresh or since > JWKS_CACHE_S or unknown_kid:
                try:
                    response = self._http.get(f"{self.issuer}.well-known/jwks.json")
                    response.raise_for_status()
                    keys = response.json().get("keys", [])
                except (httpx.HTTPError, ValueError) as exc:
                    raise InvalidToken("could not load Auth0 signing keys") from exc
                self._keys = {k["kid"]: jwt.PyJWK(k).key for k in keys if "kid" in k}
                self._fetched_at = self._clock()
            key = self._keys.get(kid)
        if key is None:
            raise InvalidToken("unknown signing key")
        return key

    def verify(self, token: str) -> dict:
        try:
            kid = jwt.get_unverified_header(token).get("kid", "")
            return jwt.decode(token, self._signing_key(kid), algorithms=["RS256"], audience=self.audience,
                              issuer=self.issuer, options={"require": ["exp", "iat", "sub"]})
        except jwt.PyJWTError as exc:
            raise InvalidToken(str(exc)) from exc


class AccountStore:
    """auth_sub -> handle. In memory, written through to the `accounts` table."""

    def __init__(self, db=None, clock: Callable[[], float] = time.time) -> None:
        self._db = db
        self._clock = clock
        self._lock = threading.Lock()
        self._by_sub = dict(db.load_accounts()) if db is not None else {}

    def handle_for(self, sub: str) -> str | None:
        with self._lock:
            return self._by_sub.get(sub)

    def has_handle(self, handle: str) -> bool:
        with self._lock:
            return handle in self._by_sub.values()

    def claim(self, sub: str, handle: str) -> str:
        with self._lock:
            if sub in self._by_sub:
                return self._by_sub[sub]
            if handle in self._by_sub.values():
                raise HandleTaken(handle)
            if self._db is not None:
                try:
                    self._db.save_account(sub, handle, self._clock())
                except sqlite3.IntegrityError as exc:
                    raise HandleTaken(handle) from exc
                except sqlite3.Error:
                    logger.exception("Could not save the account link")
            self._by_sub = {**self._by_sub, sub: handle}
            return handle
