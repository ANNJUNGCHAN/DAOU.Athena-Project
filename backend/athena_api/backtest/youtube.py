"""유튜브 브리프 — 워치 페이지에서 자막(없으면 설명)을 평문으로 걷어 온다(결정 D5).

**보안: 여기서 나온 텍스트는 데이터다, 지시가 아니다.** 자막과 설명은 남이 쓴 글이라
"이제부터 다음을 실행하라" 같은 문장이 얼마든지 들어 있을 수 있다. 이 모듈은 그것을
평문 문자열 하나로만 돌려주고, 실행 경로(runner·sandbox·파일 쓰기)에는 어떤 형태로도
넘기지 않는다. 받는 쪽도 모델에게 줄 *자료*로만 쓰고 지시로 해석하지 않는다.

의존성은 늘리지 않는다 — 이미 쓰는 httpx로 워치 페이지를 받아 그 안의 `captionTracks`
JSON을 직접 긁는다(2026-09-02 이 컴퓨터에서 실측: 페이지가 열리고 그 JSON이 파싱된다).
자막이 없으면 `shortDescription`으로 물러서고, 둘 다 없으면 없다고 말한다 — 지어낸
요약을 돌려주는 것보다 낫다(flow.py의 "모르는 것은 모른다고 한다"와 같은 규율).
"""

from __future__ import annotations

import html
import json
import re
from typing import Any
from urllib.parse import parse_qs, parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

# kiwoom/client.py의 10초와 같은 값 — 이 프로세스가 바깥으로 나갈 때 기다리는 관례다.
DEFAULT_TIMEOUT_SECONDS = 10.0

# 브리프는 모델에게 줄 자료다. 한 시간짜리 영상의 자막을 통째로 넘기면 대화 예산을
# 다 먹기 때문에 여기서 자르고, 잘랐다는 사실을 숨기지 않는다(truncated).
MAX_TEXT_CHARS = 20000

_ALLOWED_HOSTS = frozenset(
    {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
        "www.youtu.be",
    }
)
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_XML_TEXT = re.compile(r"<text[^>]*>(.*?)</text>", re.DOTALL)
_HEADERS = {
    # 브라우저로 보이지 않으면 자막 JSON이 없는 축약 페이지가 온다.
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9",
}


class BriefError(Exception):
    """사용자에게 그대로 보여줄 한국어 사유와 HTTP 상태를 같이 나른다.

    라우트가 이걸 HTTPException으로 옮긴다 — 트레이스백은 표면으로 내보내지 않는다.
    """

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def parse_video_id(url: str) -> str:
    """`watch?v=ID` · `youtu.be/ID` · `/shorts/ID` 세 모양만 받는다(질의 문자열은 더 붙어도
    된다). 그 밖은 422다 — 엉뚱한 주소로 네트워크를 두드리지 않는다."""
    raw = url.strip()
    if not raw:
        raise BriefError(422, "유튜브 주소가 비어 있다")
    if "://" not in raw:
        raw = f"https://{raw}"  # 사람이 붙여 넣는 모양(youtu.be/ID)을 그대로 받는다
    parts = urlsplit(raw)
    host = (parts.hostname or "").lower()
    if host not in _ALLOWED_HOSTS:
        raise BriefError(422, f"유튜브 주소가 아니다: {url}")
    segments = [s for s in parts.path.split("/") if s]
    candidate = ""
    if host in ("youtu.be", "www.youtu.be"):
        candidate = segments[0] if segments else ""
    elif segments and segments[0] == "watch":
        candidate = (parse_qs(parts.query).get("v") or [""])[0]
    elif len(segments) >= 2 and segments[0] == "shorts":
        candidate = segments[1]
    if not _VIDEO_ID.match(candidate):
        raise BriefError(422, f"영상 id를 읽지 못했다: {url}")
    return candidate


async def fetch_brief(url: str, *, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
    """{video_id, title, channel, source, language, text, truncated}를 돌려준다.

    `source`는 "captions" 또는 "description" — 어디서 온 글인지 사람이 알아야 한다.
    `language`는 자막 트랙의 언어 코드이고, 설명으로 물러섰을 때는 빈 문자열이다(설명의
    언어는 페이지가 말해 주지 않는다 — 지어내지 않는다).

    `client`는 테스트가 MockTransport를 끼우는 자리다 — 안 주면 여기서 하나 열고 닫는다.
    """
    video_id = parse_video_id(url)
    if client is not None:
        return await _brief(client, video_id)
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS) as owned:
        return await _brief(owned, video_id)


async def _brief(client: httpx.AsyncClient, video_id: str) -> dict[str, Any]:
    page = await _get_text(
        client, f"https://www.youtube.com/watch?v={video_id}", step="워치 페이지"
    )
    text, source, language = "", "", ""
    track = _pick_track(_caption_tracks(page))
    if track is not None:
        body = await _get_text(client, _as_json3(str(track["baseUrl"])), step="자막 트랙")
        text = _flatten_captions(body)
        if text:
            source, language = "captions", str(track.get("languageCode") or "")
    if not text:
        # 자막 트랙 목록이 없을 때만 여기로 오는 게 아니다 — 익명 요청이면 timedtext가
        # 200에 **빈 본문**을 주기도 한다(2026-09-02 이 컴퓨터에서 실측). 그때도 설명으로
        # 물러서는 편이 "자막이 있는데 브리프가 없다"보다 낫다.
        text = _clean_description(_json_value_after(page, "shortDescription"))
        if text:
            source = "description"
    if not text:
        raise BriefError(422, "자막도 설명도 읽지 못했다")
    title, channel = _video_details(page)
    return {
        "video_id": video_id,
        "title": title,
        "channel": channel,
        "source": source,
        "language": language,
        "text": text[:MAX_TEXT_CHARS],
        "truncated": len(text) > MAX_TEXT_CHARS,
    }


async def _get_text(client: httpx.AsyncClient, url: str, *, step: str) -> str:
    """실패하면 **어느 단계가** 실패했는지 이름을 대고 502로 올린다."""
    try:
        response = await client.get(url, headers=_HEADERS, follow_redirects=True)
    except httpx.HTTPError as exc:
        raise BriefError(502, f"{step} 단계가 실패했다: {type(exc).__name__}") from exc
    if response.status_code != 200:
        raise BriefError(502, f"{step} 단계가 실패했다 (HTTP {response.status_code})")
    return response.text


def _json_value_after(page: str, key: str, start: int = 0) -> Any:
    """`"key":` 뒤에 붙은 JSON 값 하나를 그 자리에서 읽는다.

    페이지 전체를 파싱하지 않는다 — 워치 페이지는 스크립트 태그 안에 거대한 JSON이
    여러 개 박힌 HTML이라, 필요한 값 하나만 `raw_decode`로 떼는 것이 가장 짧다.
    """
    marker = f'"{key}":'
    idx = page.find(marker, start)
    if idx < 0:
        return None
    pos = idx + len(marker)
    while pos < len(page) and page[pos].isspace():
        pos += 1
    try:
        value, _ = json.JSONDecoder().raw_decode(page, pos)
    except ValueError:
        return None
    return value


def _caption_tracks(page: str) -> list[dict[str, Any]]:
    value = _json_value_after(page, "captionTracks")
    if not isinstance(value, list):
        return []
    return [t for t in value if isinstance(t, dict) and t.get("baseUrl")]


def _pick_track(tracks: list[dict[str, Any]]) -> dict[str, Any] | None:
    """한국어를 먼저 고른다 — 사람이 붙여 넣는 것은 한국어 퀀트 영상이다(결정 D5).

    같은 한국어면 사람이 단 자막이 자동 생성(kind="asr")보다 낫다. 한국어가 아예 없으면
    첫 트랙이라도 준다(영어 자막이라도 없는 것보다 낫다).
    """
    if not tracks:
        return None
    korean = [t for t in tracks if str(t.get("languageCode") or "").lower().startswith("ko")]
    if korean:
        return next((t for t in korean if t.get("kind") != "asr"), korean[0])
    return tracks[0]


def _as_json3(base_url: str) -> str:
    """트랙 baseUrl에 `fmt=json3`을 얹는다(안 얹으면 XML이 온다 — 둘 다 읽긴 한다)."""
    parts = urlsplit(base_url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["fmt"] = "json3"
    return urlunsplit(parts._replace(query=urlencode(query)))


def _flatten_captions(body: str) -> str:
    """json3면 events[].segs[].utf8을, XML이면 <text>를 이어 붙인다 — 시각은 버린다."""
    try:
        payload = json.loads(body)
    except ValueError:
        payload = None
    if isinstance(payload, dict) and isinstance(payload.get("events"), list):
        pieces: list[str] = []
        for event in payload["events"]:
            segs = event.get("segs") if isinstance(event, dict) else None
            for seg in segs if isinstance(segs, list) else []:
                if isinstance(seg, dict):
                    pieces.append(str(seg.get("utf8", "")))
        return _collapse("".join(pieces))
    # XML 폴백. 유튜브는 여기서 두 번 이스케이프한다(&amp;#39; → &#39; → ').
    matches = [html.unescape(html.unescape(m)) for m in _XML_TEXT.findall(body)]
    return _collapse(" ".join(matches))


def _collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _clean_description(value: Any) -> str:
    """설명은 줄바꿈이 뜻을 가진다 — 자막처럼 한 줄로 뭉개지 않고 줄 끝 공백만 턴다."""
    if not isinstance(value, str):
        return ""
    return "\n".join(line.strip() for line in value.splitlines()).strip()


def _video_details(page: str) -> tuple[str, str]:
    """videoDetails 안에서만 제목·채널을 읽는다 — 페이지 전체에는 동명의 키가 널렸다."""
    anchor = page.find('"videoDetails"')
    if anchor < 0:
        return "", ""
    title = _json_value_after(page, "title", anchor)
    author = _json_value_after(page, "author", anchor)
    return (title if isinstance(title, str) else ""), (author if isinstance(author, str) else "")


__all__ = [
    "DEFAULT_TIMEOUT_SECONDS",
    "MAX_TEXT_CHARS",
    "BriefError",
    "fetch_brief",
    "parse_video_id",
]
