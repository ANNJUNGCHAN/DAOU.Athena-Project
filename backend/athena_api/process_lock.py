"""Cross-platform, nonblocking ownership locks for single-owner local resources."""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path
from typing import BinaryIO

LOCK_FILENAME_PREFIX = "daou-athena-kiwoom"
BRAIN_LOCK_FILENAME_PREFIX = "daou-athena-brain"


class ProcessLock:
    """One process may hold the lock file at ``path``; a second attempt raises.

    Subclasses only pick a lock file path and, optionally, a conflict message — the
    OS-level advisory locking (``msvcrt`` on Windows, ``fcntl`` elsewhere) lives here once
    so every single-writer local resource (Kiwoom credentials, the LadybugDB brain
    projection, ...) goes through the same, already-tested mechanism instead of
    reimplementing it per owner.
    """

    def __init__(self, path: Path, *, label: str | None = None) -> None:
        self.path = path
        self.label = label
        self._file: BinaryIO | None = None

    def _conflict_message(self) -> str:
        message = "another process already holds this lock"
        if self.label:
            message = f"{message} ({self.label})"
        return message

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
            raise RuntimeError(self._conflict_message()) from exc
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


class CredentialProcessLock(ProcessLock):
    def __init__(self, path: Path | None = None, *, label: str | None = None) -> None:
        super().__init__(
            path or Path(tempfile.gettempdir()) / f"{LOCK_FILENAME_PREFIX}.lock", label=label
        )

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

    def _conflict_message(self) -> str:
        message = "another credential-owning Athena backend is already running"
        if self.label:
            message = f"{message} for account '{self.label}'"
        return message


class BrainProcessLock(ProcessLock):
    """Lock ownership of one LadybugDB graph projection file.

    ADR investment-brain-architecture.md §4.1 requires exactly one process to hold the
    projection's READ_WRITE handle. The lock is keyed off the resolved database path
    (not a credential fingerprint — the brain has no credentials), so two different
    profiles never contend and two processes pointed at the same path always do.
    """

    @classmethod
    def for_db_path(cls, db_path: Path, *, label: str | None = None) -> BrainProcessLock:
        digest = hashlib.sha256(str(Path(db_path).resolve()).encode("utf-8")).hexdigest()[:16]
        path = Path(tempfile.gettempdir()) / f"{BRAIN_LOCK_FILENAME_PREFIX}-{digest}.lock"
        return cls(path, label=label)

    def _conflict_message(self) -> str:
        message = "another Athena backend already owns the investment-brain graph"
        if self.label:
            message = f"{message} ({self.label})"
        return message
