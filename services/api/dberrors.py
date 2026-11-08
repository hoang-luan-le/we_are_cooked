"""Database exceptions for both backends (SQLite and Postgres/Tiger Data), so stores catch either."""
from __future__ import annotations

import sqlite3

try:
    import psycopg

    DB_ERRORS: tuple[type[BaseException], ...] = (sqlite3.Error, psycopg.Error)
    UNIQUE_VIOLATIONS: tuple[type[BaseException], ...] = (sqlite3.IntegrityError, psycopg.errors.UniqueViolation)
except ImportError:  # pragma: no cover - psycopg is in requirements.txt
    DB_ERRORS = (sqlite3.Error,)
    UNIQUE_VIOLATIONS = (sqlite3.IntegrityError,)
