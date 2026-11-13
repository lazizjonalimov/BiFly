"""Object storage behind one small interface.

A local folder in development. In production the same methods are implemented on a private S3 bucket and the
browser uploads straight to a presigned URL; the upload contract the API exposes (intent, upload, complete)
is already shaped for that, so nothing calling this changes.
"""
import uuid
from pathlib import Path
from typing import Protocol

from app.core.config import get_settings


class Storage(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes: ...
    def exists(self, key: str) -> bool: ...
    def delete(self, key: str) -> None: ...


class LocalStorage:
    def __init__(self, root: str):
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError("Invalid storage key")
        return path

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


def get_storage() -> Storage:
    return LocalStorage(get_settings().storage_dir)


def make_key(org_id: uuid.UUID, doc_id: uuid.UUID) -> str:
    # Keys never contain user-supplied names.
    return f"{org_id}/{doc_id}"
