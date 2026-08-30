from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest

from athena_mcp import atomic_json_state
from athena_mcp.atomic_json_state import StateLockTimeoutError, exclusive_state_lock


@pytest.mark.skipif(atomic_json_state.os.name != "nt", reason="Windows lock race")
def test_windows_zero_length_seed_contention_is_retried(tmp_path, monkeypatch):
    path = tmp_path / "state.lock"
    owner_entered = threading.Event()
    release_owner = threading.Event()
    waiter_seed_attempted = threading.Event()
    waiter_entered = threading.Event()
    failures: list[BaseException] = []
    original_fstat = atomic_json_state.os.fstat
    original_write = atomic_json_state.os.write

    def fstat_with_stale_zero(fd: int):
        if threading.current_thread().name == "state-lock-waiter":
            return SimpleNamespace(st_size=0)
        return original_fstat(fd)

    def write_with_seed_probe(fd: int, data: bytes) -> int:
        if (
            threading.current_thread().name == "state-lock-waiter"
            and data == b"\0"
        ):
            waiter_seed_attempted.set()
            if not release_owner.is_set():
                raise PermissionError(13, "lock byte owned by peer")
        return original_write(fd, data)

    monkeypatch.setattr(atomic_json_state.os, "fstat", fstat_with_stale_zero)
    monkeypatch.setattr(atomic_json_state.os, "write", write_with_seed_probe)

    def owner() -> None:
        with exclusive_state_lock(path):
            owner_entered.set()
            release_owner.wait(timeout=2)

    def waiter() -> None:
        try:
            assert owner_entered.wait(timeout=1)
            with exclusive_state_lock(path, timeout_seconds=1):
                waiter_entered.set()
        except BaseException as exc:
            failures.append(exc)

    owner_thread = threading.Thread(target=owner, name="state-lock-owner")
    waiter_thread = threading.Thread(target=waiter, name="state-lock-waiter")
    owner_thread.start()
    waiter_thread.start()
    assert waiter_seed_attempted.wait(timeout=1)
    release_owner.set()
    owner_thread.join(timeout=1)
    waiter_thread.join(timeout=1)

    assert not owner_thread.is_alive()
    assert not waiter_thread.is_alive()
    assert failures == []
    assert waiter_entered.is_set()


def test_suspended_owner_is_not_reclaimed_from_old_mtime(tmp_path):
    path = tmp_path / "state.lock"
    entered = threading.Event()
    release = threading.Event()

    def hold_lock() -> None:
        with exclusive_state_lock(path):
            entered.set()
            release.wait(timeout=2)

    owner = threading.Thread(target=hold_lock)
    owner.start()
    assert entered.wait(timeout=1)

    with pytest.raises(StateLockTimeoutError):
        with exclusive_state_lock(
            path,
            timeout_seconds=0.05,
            stale_after_seconds=0,
        ):
            pass

    release.set()
    owner.join(timeout=1)
    assert not owner.is_alive()


def test_third_writer_enters_only_after_current_owner_releases(tmp_path):
    path = tmp_path / "state.lock"
    order: list[str] = []
    first_entered = threading.Event()
    release_first = threading.Event()

    def first() -> None:
        with exclusive_state_lock(path):
            order.append("first-enter")
            first_entered.set()
            release_first.wait(timeout=2)
            order.append("first-exit")

    def third() -> None:
        assert first_entered.wait(timeout=1)
        with exclusive_state_lock(path, timeout_seconds=1):
            order.append("third-enter")

    owner = threading.Thread(target=first)
    waiter = threading.Thread(target=third)
    owner.start()
    waiter.start()
    assert first_entered.wait(timeout=1)
    release_first.set()
    owner.join(timeout=1)
    waiter.join(timeout=1)

    assert order == ["first-enter", "first-exit", "third-enter"]


def test_orphaned_metadata_does_not_block_kernel_reclamation(tmp_path):
    path = tmp_path / "state.lock"
    path.write_text(
        '{"pid":999999,"owner_token":"dead-owner","acquired_at_ns":1}',
        encoding="ascii",
    )

    with exclusive_state_lock(path, timeout_seconds=0.1):
        pass

    assert "dead-owner" not in path.read_text(encoding="ascii")


def test_release_does_not_clear_replaced_owner_token(tmp_path, monkeypatch):
    path = tmp_path / "state.lock"
    monkeypatch.setattr(
        atomic_json_state,
        "_fd_owner_token",
        lambda _fd: "replacement-owner",
    )

    with exclusive_state_lock(path):
        pass

    assert "owner_token" in path.read_text(encoding="ascii")

    monkeypatch.undo()
    with exclusive_state_lock(path):
        pass
