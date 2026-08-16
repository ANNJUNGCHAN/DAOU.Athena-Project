"""Cross-platform, nonblocking ownership lock for credential-bearing runtimes."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import BinaryIO

LOCK_FILENAME_PREFIX = "daou-athena-kiwoom"


class CredentialProcessLock:
    def __init__(self, path: Path | None = None, *, label: str | None = None) -> None:
        self.path = path or Path(tempfile.gettempdir()) / f"{LOCK_FILENAME_PREFIX}.lock"
        self.label = label
        self._file: BinaryIO | None = None

    @classmethod
    def for_credentials(
        cls, fingerprint: str, *, label: str | None = None
    ) -> CredentialProcessLock:
        """Lock ownership of one credential pair, not of the whole process.

        Two processes may legitimately own two different Kiwoom accounts at once, so the
        lock is keyed off the credential fingerprint rather than a single fixed path.
        """
        path = Path(tempfile.gettempdir()) / f"{LOCK_FILENAME_PREFIX}-{fingerprint}.lock"
        return cls(path, label=label)

    def acquire(self) -> None:
        handle: BinaryIO | None = None
        try:
            handle = self.path.open("a+b")
            handle.seek(0)
            if handle.read(1) == b"":
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            if handle is not None:
                handle.close()
            message = "another credential-owning Athena backend is already running"
            if self.label:
                message = f"{message} for account '{self.label}'"
            raise RuntimeError(message) from exc
        assert handle is not None
        self._file = handle

    def release(self) -> None:
        handle, self._file = self._file, None
        if handle is None:
            return
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()
