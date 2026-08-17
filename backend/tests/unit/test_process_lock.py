from pathlib import Path

import pytest

from athena_api.process_lock import BrainProcessLock, CredentialProcessLock, ProcessLock


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


def test_process_lock_base_class_has_a_generic_default_message(tmp_path: Path) -> None:
    path = tmp_path / "generic.lock"
    first = ProcessLock(path, label="widget")
    second = ProcessLock(path, label="widget")
    first.acquire()
    try:
        with pytest.raises(RuntimeError, match=r"already holds this lock \(widget\)"):
            second.acquire()
    finally:
        first.release()


def test_brain_process_lock_rejects_contention_on_the_same_db_path(tmp_path: Path) -> None:
    db_path = tmp_path / "brain.lbug"
    first = BrainProcessLock.for_db_path(db_path)
    second = BrainProcessLock.for_db_path(db_path)
    first.acquire()
    try:
        with pytest.raises(RuntimeError, match="owns the investment-brain graph"):
            second.acquire()
    finally:
        first.release()

    second.acquire()
    second.release()


def test_brain_process_lock_path_is_independent_per_db_path(tmp_path: Path) -> None:
    one = BrainProcessLock.for_db_path(tmp_path / "one.lbug")
    other = BrainProcessLock.for_db_path(tmp_path / "other.lbug")
    assert one.path != other.path

    one.acquire()
    other.acquire()
    one.release()
    other.release()
