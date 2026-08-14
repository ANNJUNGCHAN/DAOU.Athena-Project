from pathlib import Path

import pytest

from athena_api.process_lock import CredentialProcessLock


def test_credential_process_lock_rejects_contention_and_releases(tmp_path: Path) -> None:
    path = tmp_path / "athena.lock"
    first = CredentialProcessLock(path)
    second = CredentialProcessLock(path)
    first.acquire()
    try:
        with pytest.raises(RuntimeError, match="already running"):
            second.acquire()
    finally:
        first.release()

    second.acquire()
    second.release()
