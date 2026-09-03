"""youtube.py — 워치 페이지에서 브리프를 걷는 계약(결정 D5).

네트워크는 한 번도 나가지 않는다: 워치 페이지 HTML을 여기서 만들고 `httpx.MockTransport`로
받아친다(tests/unit/test_auth.py와 같은 방식). 실제 유튜브 응답 모양을 고정해 두는 것이
이 파일의 값이다 — 자막 우선순위·json3/XML 평문화·설명 폴백·실패 단계 이름.
"""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest

from athena_api.backtest import youtube

VIDEO_ID = "dQw4w9WgXcQ"

ACCEPTED = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s&list=PL1",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "http://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abcdefgh",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share",
    "youtu.be/dQw4w9WgXcQ",  # 스킴 없이 붙여 넣는 모양
    "  https://youtu.be/dQw4w9WgXcQ  ",
]

REJECTED = [
    "",
    "그냥 글자",
    "https://vimeo.com/123456789",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/playlist?list=PL1",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=short",
    "https://youtu.be/",
    "https://www.youtube.com/shorts/",
]


def _track(language: str, base_url: str, *, kind: str | None = None) -> dict[str, object]:
    track: dict[str, object] = {
        "baseUrl": base_url,
        "name": {"simpleText": language},
        "languageCode": language,
        "isTranslatable": True,
    }
    if kind is not None:
        track["kind"] = kind
    return track


def _watch_page(
    *,
    tracks: list[dict[str, object]] | None = None,
    description: str | None = None,
    title: str = "퀀트 투자 3원칙",
    author: str = "퀀트 채널",
) -> str:
    """워치 페이지의 뼈대 — 스크립트 태그 안에 거대한 JSON이 박힌 HTML."""
    details: dict[str, object] = {"videoId": VIDEO_ID, "title": title, "author": author}
    if description is not None:
        details["shortDescription"] = description
    player: dict[str, object] = {"videoDetails": details}
    if tracks is not None:
        player["captions"] = {"playerCaptionsTracklistRenderer": {"captionTracks": tracks}}
    blob = json.dumps(player, ensure_ascii=False)
    return (
        "<!DOCTYPE html><html><head><title>유튜브</title></head><body>"
        f"<script>var ytInitialPlayerResponse = {blob};</script>"
        "</body></html>"
    )


def _json3(lines: list[str]) -> dict[str, object]:
    return {
        "events": [
            {"tStartMs": 1000 * i, "dDurationMs": 900, "segs": [{"utf8": line}, {"utf8": "\n"}]}
            for i, line in enumerate(lines)
        ]
    }


def _client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _page_only(page: str) -> Callable[[httpx.Request], httpx.Response]:
    def handle(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/watch"
        return httpx.Response(200, html=page)

    return handle


# ── 주소 표 ──────────────────────────────────────────────────────────────────


def test_every_accepted_shape_yields_the_video_id() -> None:
    for url in ACCEPTED:
        assert youtube.parse_video_id(url) == VIDEO_ID, url


def test_everything_else_is_refused_in_korean() -> None:
    for url in REJECTED:
        with pytest.raises(youtube.BriefError) as caught:
            youtube.parse_video_id(url)
        assert caught.value.status == 422, url
        assert caught.value.message.strip(), url


# ── 자막 ─────────────────────────────────────────────────────────────────────


async def test_korean_track_wins_over_english_and_json3_drops_timestamps() -> None:
    page = _watch_page(
        tracks=[
            _track("en", "https://www.youtube.com/api/timedtext?lang=en"),
            _track("ko", "https://www.youtube.com/api/timedtext?lang=ko"),
        ]
    )
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/watch":
            return httpx.Response(200, html=page)
        seen.append(request.url.params.get("fmt", ""))
        if request.url.params.get("lang") == "ko":
            return httpx.Response(200, json=_json3(["첫 번째 원칙은", "손실을 줄이는 것이다"]))
        return httpx.Response(200, json=_json3(["english caption"]))

    async with _client(handle) as client:
        brief = await youtube.fetch_brief(f"https://youtu.be/{VIDEO_ID}", client=client)

    assert seen == ["json3"]  # baseUrl에 fmt=json3을 얹어서 요청했다
    assert brief["source"] == "captions"
    assert brief["language"] == "ko"
    assert brief["text"] == "첫 번째 원칙은 손실을 줄이는 것이다"
    assert brief["video_id"] == VIDEO_ID
    assert brief["title"] == "퀀트 투자 3원칙"
    assert brief["channel"] == "퀀트 채널"
    assert brief["truncated"] is False


async def test_human_korean_track_wins_over_auto_generated_korean() -> None:
    page = _watch_page(
        tracks=[
            _track("ko", "https://www.youtube.com/api/timedtext?lang=ko&kind=asr", kind="asr"),
            _track("ko-KR", "https://www.youtube.com/api/timedtext?lang=ko-KR"),
        ]
    )

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/watch":
            return httpx.Response(200, html=page)
        if request.url.params.get("kind") == "asr":
            return httpx.Response(200, json=_json3(["자동 생성"]))
        return httpx.Response(200, json=_json3(["사람이 단 자막"]))

    async with _client(handle) as client:
        brief = await youtube.fetch_brief(f"https://youtu.be/{VIDEO_ID}", client=client)

    assert brief["language"] == "ko-KR"
    assert brief["text"] == "사람이 단 자막"


async def test_xml_fallback_is_flattened_too() -> None:
    """fmt=json3을 얹어도 XML이 오는 트랙이 있다 — 그때도 평문으로 만든다."""
    page = _watch_page(tracks=[_track("ko", "https://www.youtube.com/api/timedtext?lang=ko")])
    xml = (
        '<?xml version="1.0" encoding="utf-8"?><transcript>'
        '<text start="0.5" dur="2.1">이동평균선이   교차하면</text>'
        '<text start="2.6" dur="1.9">그때 &amp;#39;매수&amp;#39;다</text>'
        "</transcript>"
    )

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/watch":
            return httpx.Response(200, html=page)
        return httpx.Response(200, text=xml)

    async with _client(handle) as client:
        brief = await youtube.fetch_brief(f"https://youtu.be/{VIDEO_ID}", client=client)

    assert brief["source"] == "captions"
    assert brief["text"] == "이동평균선이 교차하면 그때 '매수'다"


# ── 설명 폴백 · 없음 ─────────────────────────────────────────────────────────


async def test_description_is_the_fallback_when_there_is_no_caption_track() -> None:
    page = _watch_page(description="이 영상에서 다루는 전략:\n  20/60 이동평균 교차\n")

    async with _client(_page_only(page)) as client:
        brief = await youtube.fetch_brief(f"https://youtu.be/{VIDEO_ID}", client=client)

    assert brief["source"] == "description"
    assert brief["language"] == ""  # 설명의 언어는 페이지가 말해 주지 않는다
    assert brief["text"] == "이 영상에서 다루는 전략:\n20/60 이동평균 교차"


async def test_empty_caption_body_still_falls_back_to_the_description() -> None:
    """익명 요청이면 트랙 목록은 오는데 timedtext가 200에 빈 본문을 준다(2026-09-02
    실측). "자막이 있는데 브리프가 없다"로 끝내지 않는다."""
    page = _watch_page(
        tracks=[_track("ko", "https://www.youtube.com/api/timedtext?lang=ko")],
        description="20/60 이동평균 교차 전략",
    )

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/watch":
            return httpx.Response(200, html=page)
        return httpx.Response(200, text="")

    async with _client(handle) as client:
        brief = await youtube.fetch_brief(f"https://youtu.be/{VIDEO_ID}", client=client)

    assert brief["source"] == "description"
    assert brief["text"] == "20/60 이동평균 교차 전략"


async def test_neither_captions_nor_description_says_so_in_korean() -> None:
    async with _client(_page_only(_watch_page())) as client:
        with pytest.raises(youtube.BriefError) as caught:
            await youtube.fetch_brief(f"https://youtu.be/{VIDEO_ID}", client=client)

    assert caught.value.status == 422
    assert caught.value.message == "자막도 설명도 읽지 못했다"


async def test_long_text_is_truncated_and_says_so() -> None:
    page = _watch_page(description="가" * (youtube.MAX_TEXT_CHARS + 500))

    async with _client(_page_only(page)) as client:
        brief = await youtube.fetch_brief(f"https://youtu.be/{VIDEO_ID}", client=client)

    assert brief["truncated"] is True
    assert len(brief["text"]) == youtube.MAX_TEXT_CHARS


# ── 실패 — 어느 단계가 무너졌는지 이름을 댄다 ────────────────────────────────


async def test_watch_page_network_failure_is_502_naming_the_step() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host", request=request)

    async with _client(handle) as client:
        with pytest.raises(youtube.BriefError) as caught:
            await youtube.fetch_brief(f"https://youtu.be/{VIDEO_ID}", client=client)

    assert caught.value.status == 502
    assert "워치 페이지" in caught.value.message
    assert "Traceback" not in caught.value.message


async def test_caption_track_failure_names_the_caption_step() -> None:
    page = _watch_page(tracks=[_track("ko", "https://www.youtube.com/api/timedtext?lang=ko")])

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/watch":
            return httpx.Response(200, html=page)
        return httpx.Response(500, text="boom")

    async with _client(handle) as client:
        with pytest.raises(youtube.BriefError) as caught:
            await youtube.fetch_brief(f"https://youtu.be/{VIDEO_ID}", client=client)

    assert caught.value.status == 502
    assert "자막 트랙" in caught.value.message
    assert "500" in caught.value.message


async def test_watch_page_404_is_502_too() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, html="<html>없다</html>")

    async with _client(handle) as client:
        with pytest.raises(youtube.BriefError) as caught:
            await youtube.fetch_brief(f"https://youtu.be/{VIDEO_ID}", client=client)

    assert caught.value.status == 502
    assert "워치 페이지" in caught.value.message
