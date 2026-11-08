"""Engine rejections. Routes turn these into {"code", "detail"} with the given HTTP status,
so the UI can show a plain message per code (design doc: API surface)."""
from __future__ import annotations


class ActionRejected(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def conflict(code: str, message: str) -> ActionRejected:
    return ActionRejected(409, code, message)


def invalid(code: str, message: str) -> ActionRejected:
    return ActionRejected(422, code, message)
