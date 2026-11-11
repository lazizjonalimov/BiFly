"""Object storage abstraction. Local filesystem in development; swap in S3 (private bucket + presigned URLs)
for production by implementing the same two methods."""
import uuid
from pathlib import Path
from typing import Protocol

from app.core.config import get_settings


class Storage(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes: ...


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


def get_storage() -> Storage:
    return LocalStorage(get_settings().storage_dir)


def make_key(org_id: uuid.UUID, doc_id: uuid.UUID) -> str:
    # Keys never contain user-supplied names.
    return f"{org_id}/{doc_id}"
