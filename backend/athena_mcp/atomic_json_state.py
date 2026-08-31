from __future__ import annotations

import json
import os
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

if os.name == "nt":
    import msvcrt
else:
    import fcntl


class StateLockTimeoutError(TimeoutError):
    """Another process held the state mutation lock for too long."""


@contextmanager
def exclusive_state_lock(
    path: Path,
    *,
    timeout_seconds: float = 5.0,
    stale_after_seconds: float = 30.0,
) -> Iterator[None]:
    """Cross-process lock whose ownership is released by the operating system.

    The lock file is intentionally persistent.  Removing a lock file based on
    its age is unsafe: a suspended owner can still hold the critical section,
    and unlinking its file lets a third writer enter concurrently.  Advisory
    file locks remain owned while a process is suspended and are reclaimed by
    the kernel when the owning descriptor/process exits.

    ``stale_after_seconds`` remains in the signature for compatibility with
    older callers.  Staleness is no longer inferred from wall-clock time.
    """
    del stale_after_seconds
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + timeout_seconds
    owner_token = uuid.uuid4().hex
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    acquired = False
    try:
        while True:
            try:
                if os.name == "nt" and os.fstat(fd).st_size == 0:
                    os.lseek(fd, 0, os.SEEK_SET)
                    os.write(fd, b"\0")
                    os.fsync(fd)
                _try_lock_fd(fd)
                acquired = True
                break
            except (BlockingIOError, OSError) as exc:
                if not _is_lock_contention(exc):
                    raise
                if time.monotonic() >= deadline:
                    raise StateLockTimeoutError(
                        f"state lock timeout: {path.name}"
                    ) from None
                time.sleep(0.01)

        payload = json.dumps(
            {
                "pid": os.getpid(),
                "owner_token": owner_token,
                "acquired_at_ns": time.time_ns(),
            },
            sort_keys=True,
        ).encode("ascii")
        os.lseek(fd, 0, os.SEEK_SET)
        os.ftruncate(fd, 0)
        os.write(fd, payload)
        os.fsync(fd)

        try:
            yield
        finally:
            if _fd_owner_token(fd) == owner_token:
                os.lseek(fd, 0, os.SEEK_SET)
                os.ftruncate(fd, 0)
                os.write(fd, b"{}\n")
                os.fsync(fd)
    finally:
        if acquired:
            _unlock_fd(fd)
        os.close(fd)


def _try_lock_fd(fd: int) -> None:
    os.lseek(fd, 0, os.SEEK_SET)
    if os.name == "nt":
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
    else:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def _unlock_fd(fd: int) -> None:
    os.lseek(fd, 0, os.SEEK_SET)
    if os.name == "nt":
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    else:
        fcntl.flock(fd, fcntl.LOCK_UN)


def _is_lock_contention(exc: OSError) -> bool:
    if isinstance(exc, BlockingIOError):
        return True
    return exc.errno in {13, 11, 36}


def _fd_owner_token(fd: int) -> str | None:
    try:
        os.lseek(fd, 0, os.SEEK_SET)
        raw = os.read(fd, 4096)
        parsed = json.loads(raw.decode("ascii"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    token = parsed.get("owner_token") if isinstance(parsed, dict) else None
    return token if isinstance(token, str) else None


def atomic_write_json(path: Path, payload: Any) -> None:
    """Write JSON durably in the target directory, then atomically replace it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    data = json.dumps(
        payload,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8")
    try:
        fd = os.open(temp_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            with os.fdopen(fd, "wb", closefd=True) as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        except BaseException:
            try:
                os.close(fd)
            except OSError:
                pass
            raise
        os.replace(temp_path, path)
        _fsync_directory(path.parent)
    finally:
        temp_path.unlink(missing_ok=True)


def _fsync_directory(directory: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    try:
        fd = os.open(directory, flags)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        # Windows does not expose a portable directory fsync operation.
        pass
    finally:
        os.close(fd)
