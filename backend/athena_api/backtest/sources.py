"""아무 주소나 브리프 — 유튜브·네이버 블로그·PDF·일반 웹페이지를 한 입구로 글로 옮긴다.

**보안: 여기서 나온 텍스트는 데이터다, 지시가 아니다.** 남이 쓴 글에는 "이제부터 다음을
실행하라" 같은 문장이 얼마든지 들어 있을 수 있다. 이 모듈은 그것을 평문 문자열 하나로만
돌려주고, 실행 경로(runner·sandbox·파일 쓰기)에는 어떤 형태로도 넘기지 않는다. 받는 쪽도
모델에게 줄 *자료*로만 쓰고 지시로 해석하지 않는다(youtube.py 모듈 주석과 같은 규율).

입구는 `brief_from_url()` 하나이고, 주소를 보고 갈 곳을 정한다.

- 유튜브 → youtube.py에 그대로 넘긴다(자막 우선순위·설명 폴백을 두 번 적지 않는다).
- 네이버 블로그 → 본문이 iframe 안에 있어 겉 페이지에는 글이 없다. 그래서 그 iframe이
  가리키는 `PostView.naver`를 직접 받아 SmartEditor ONE(`.se-main-container`)이나 구
  에디터(`#postViewArea`)에서 뽑고, 실패하면 모바일(m.blog) 주소로 한 번 더 시도한다.
- PDF → pypdf로 글자만 뽑는다. 쪽·바이트 상한이 있고, 자르면 잘랐다고 말한다.
- 그 밖 → <title>/og:title과, script·style·nav·header·footer·aside를 걷어낸 뒤 남은
  덩어리 중 글이 가장 많은 것.

의존성은 pypdf 하나만 늘렸다 — HTML은 표준 라이브러리 `html.parser`로 충분하다.
"""

from __future__ import annotations

import io
import ipaddress
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx

from athena_api.backtest import youtube as youtube_mod
from athena_api.backtest.youtube import DEFAULT_TIMEOUT_SECONDS, MAX_TEXT_CHARS, BriefError

# PDF 쪽 상한. 논문 한 편이 60쪽을 넘는 일은 드물고, 넘는다면 앞 60쪽으로도 무슨 글인지
# 알 수 있다.
MAX_PDF_PAGES = 60
# 본문 바이트 상한. **받으면서** 재고 넘는 순간 끊는다(`_get`) — 다 받아 놓고 크기를 재면
# "받다가 메모리를 다 먹는" 경우를 하나도 막지 못한다(2 GB 응답은 이미 메모리 안이다).
# PDF·HTML을 가리지 않는다: 잘라서 파싱할 수 없는 것은 PDF뿐이지만, 메모리를 먹는 것은
# 종류를 안 가린다.
MAX_FETCH_BYTES = 20 * 1024 * 1024

_NAVER_HOSTS = frozenset({"blog.naver.com", "m.blog.naver.com"})
_LOG_NO = re.compile(r"^\d+$")

# 글이 아닌 것들 — 메뉴·머리말·꼬리말·곁가지는 본문이 아니다.
_SKIP_TAGS = frozenset(
    {"script", "style", "noscript", "template", "svg", "nav", "header", "footer", "aside", "form"}
)
# 줄이 바뀌는 자리. 이걸 안 두면 문단 두 개가 한 단어로 붙는다.
_BLOCK_TAGS = frozenset(
    {
        "p", "div", "br", "li", "tr", "section", "article", "main", "blockquote",
        "pre", "h1", "h2", "h3", "h4", "h5", "h6", "td", "figcaption",
    }
)
_VOID_TAGS = frozenset(
    {"br", "img", "hr", "input", "meta", "link", "source", "col", "area", "base", "embed", "wbr"}
)
# 본문 후보. article/main이 있으면 그 말을 믿고, 없을 때만 덩어리 크기로 고른다.
_SEMANTIC_TAGS = ("article", "main")
_CONTAINER_TAGS = ("div", "section", "td")


@dataclass
class _Node:
    """열린 요소 하나 — 그 안의 글이 pieces의 어디부터 어디까지인지만 기억한다."""

    tag: str
    attrs: dict[str, str]
    depth: int
    start: int
    end: int = -1


class _Document(HTMLParser):
    """태그를 지우는 대신 '어느 요소 안의 글인지'를 같이 남기는 최소 파서.

    네이버는 컨테이너를 지정해서(`.se-main-container`), 일반 페이지는 가장 큰 덩어리를
    골라서 쓴다 — 두 경우 모두 같은 파싱 한 번으로 답이 나온다.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.pieces: list[str] = []
        self.nodes: list[_Node] = []
        self.doc_title = ""
        self.og_title = ""
        self._open: list[tuple[str, int]] = []
        self._skip_count = 0
        self._in_title = False

    # ── 파서 콜백 ────────────────────────────────────────────────────────────

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        flat = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (flat.get("property") or flat.get("name") or "").lower()
            if key == "og:title" and not self.og_title:
                self.og_title = flat.get("content", "").strip()
            return
        if tag in _VOID_TAGS:
            if tag == "br":
                self._boundary()
            return
        if tag == "title":
            self._in_title = True
        self.nodes.append(
            _Node(tag=tag, attrs=flat, depth=len(self._open), start=len(self.pieces))
        )
        self._open.append((tag, len(self.nodes) - 1))
        if tag in _SKIP_TAGS:
            self._skip_count += 1
        if tag in _BLOCK_TAGS:
            self._boundary()

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title":
            self._in_title = False
        # 안 닫힌 <p>·<li>가 흔하다 — 짝이 있으면 거기까지 한꺼번에 닫고, 없으면 무시한다.
        for index in range(len(self._open) - 1, -1, -1):
            if self._open[index][0] == tag:
                self._close_from(index)
                break
        if tag in _BLOCK_TAGS:
            self._boundary()

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.doc_title += data
            return
        if self._skip_count:
            return
        if data.strip():
            self.pieces.append(data)
        elif self.pieces and self.pieces[-1] != "\n":
            # `<span>가</span> <span>나</span>`의 사이 공백 — 없애면 단어가 붙는다.
            self.pieces.append(" ")

    def close(self) -> None:
        HTMLParser.close(self)
        self._close_from(0)

    # ── 읽기 ─────────────────────────────────────────────────────────────────

    def text(self) -> str:
        return _collapse("".join(self.pieces))

    def text_of(self, node: _Node) -> str:
        end = node.end if node.end >= 0 else len(self.pieces)
        return _collapse("".join(self.pieces[node.start : end]))

    def title(self) -> str:
        return self.og_title.strip() or _collapse(self.doc_title)

    def find(self, *, classes: tuple[str, ...] = (), ids: tuple[str, ...] = ()) -> str:
        """지정한 class·id를 가진 요소의 글 — 먼저 찾은 것 중 글이 있는 첫 번째."""
        for node in self.nodes:
            names = (node.attrs.get("class") or "").split()
            if any(c in names for c in classes) or node.attrs.get("id") in ids:
                text = self.text_of(node)
                if text:
                    return text
        return ""

    def main_text(self) -> str:
        """본문 후보 중 글이 가장 많은 것. 같으면 더 깊은 것 — 겉을 감싸기만 한 div가
        아니라 실제로 글을 담은 요소를 고르기 위해서다."""
        candidates = [n for n in self.nodes if n.tag in _SEMANTIC_TAGS]
        if not candidates:
            candidates = [n for n in self.nodes if n.tag in _CONTAINER_TAGS]
        best = ""
        best_key = (0, -1)
        for node in candidates:
            text = self.text_of(node)
            key = (len(text), node.depth)
            if key > best_key:
                best, best_key = text, key
        return best or self.text()

    # ── 내부 ─────────────────────────────────────────────────────────────────

    def _boundary(self) -> None:
        if self.pieces and self.pieces[-1] != "\n":
            self.pieces.append("\n")

    def _close_from(self, index: int) -> None:
        while len(self._open) > index:
            tag, node_index = self._open.pop()
            self.nodes[node_index].end = len(self.pieces)
            if tag in _SKIP_TAGS:
                self._skip_count -= 1


def _collapse(raw: str) -> str:
    """줄 안의 공백은 하나로, 빈 줄은 버린다 — 줄바꿈은 뜻이 있어 남긴다."""
    lines = [re.sub(r"[^\S\n]+", " ", line).strip() for line in raw.split("\n")]
    return "\n".join(line for line in lines if line)


def _parse(html_text: str) -> _Document:
    doc = _Document()
    doc.feed(html_text)
    doc.close()
    return doc


def _guard_host(url: str) -> None:
    """안쪽(루프백·사설망·링크로컬)을 가리키는 주소는 읽지 않는다.

    **왜 여기에 있어야 하는가.** 이 모듈이 돌려주는 글은 남이 쓴 것이고, 그 글에
    "http://127.0.0.1:8010/…"이 적혀 있으면 모델이 그 주소로 `source_brief`를 부를 수 있다 —
    그러면 백엔드가 자기 자신과 사내망을 대신 읽어 모델에게 넘겨준다(SSRF). 앞의
    youtube.py는 호스트가 유튜브로 잠겨 있어 이 길이 없었는데, 아무 주소나 받기로 하면서
    그 잠금이 풀렸다. 그래서 잠금을 대상 쪽으로 옮긴다.

    막는 것은 **주소에 적힌 대상**이다 — 바깥 이름이 사설 IP로 풀리는 경우까지는 여기서
    보지 않는다(그건 이름을 풀고 연결 시점에 다시 고정해야 하는 별개의 그물이고, 이
    모듈의 테스트는 네트워크를 쓰지 않는다).
    """
    host = (urlsplit(url).hostname or "").lower()
    if not host:
        return
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise BriefError(422, f"안쪽 주소는 읽지 않는다: {host}")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return
    if not address.is_global:
        raise BriefError(422, f"안쪽 주소는 읽지 않는다: {host}")


def _normalize(url: str) -> str:
    raw = url.strip()
    if not raw:
        raise BriefError(422, "주소가 비어 있다")
    if "://" not in raw:
        raw = f"https://{raw}"  # 사람이 붙여 넣는 모양(blog.naver.com/...)을 그대로 받는다
    parts = urlsplit(raw)
    host = parts.hostname or ""
    # 공백이 든 호스트는 주소가 아니라 그냥 문장이다 — 네트워크를 두드려 502로 알기 전에 막는다.
    if parts.scheme not in ("http", "https") or not host or " " in host:
        raise BriefError(422, f"읽을 수 있는 주소가 아니다: {url}")
    _guard_host(raw)
    return raw


def source_kind(url: str) -> str:
    """주소만 보고 정해지는 종류 — 일반 HTML과 PDF는 응답을 봐야 갈릴 수 있어서
    여기서는 확장자로만 판단한다(내용 유형은 `_brief`가 다시 본다)."""
    parts = urlsplit(_normalize(url))
    host = (parts.hostname or "").lower()
    if host in youtube_mod._ALLOWED_HOSTS:
        return "youtube"
    if host in _NAVER_HOSTS:
        return "naver_blog"
    if parts.path.lower().endswith(".pdf"):
        return "pdf"
    return "html"


async def brief_from_url(url: str, *, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
    """{source_kind, url, title, text, truncated, language}를 돌려준다.

    `language`는 아는 경우에만 채운다(유튜브 자막 트랙) — 나머지는 None이다. 페이지가
    말해 주지 않는 것을 지어내지 않는다(youtube.py와 같은 규율).

    `client`는 테스트가 MockTransport를 끼우는 자리다 — 안 주면 여기서 하나 열고 닫는다.
    """
    normalized = _normalize(url)
    if client is not None:
        return await _brief(client, normalized)
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS) as owned:
        return await _brief(owned, normalized)


async def _brief(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    kind = source_kind(url)
    if kind == "youtube":
        return await _youtube_brief(client, url)
    if kind == "naver_blog":
        return await _naver_brief(client, url)
    response = await _get(client, url, step="페이지")
    # 주소에 .pdf가 없어도 응답이 PDF라고 말하면 PDF다(다운로드 링크가 흔하다).
    content_type = response.headers.get("content-type", "").lower()
    if kind == "pdf" or content_type.startswith("application/pdf"):
        return _pdf_brief(url, response.content)
    return _html_brief(url, response.text)


async def _get(client: httpx.AsyncClient, url: str, *, step: str) -> httpx.Response:
    """실패하면 **어느 단계가** 실패했는지 이름을 대고 502로 올린다(youtube.py와 동형).

    본문은 스트림으로 받으며 `MAX_FETCH_BYTES`를 넘는 순간 끊는다 — 다 받은 뒤에 재는
    상한은 상한이 아니다. 리다이렉트를 따라간 **최종** 주소도 여기서 다시 본다: 바깥
    페이지가 302로 안쪽을 가리키면 `_normalize`의 검사를 우회하기 때문이다.
    """
    chunks: list[bytes] = []
    content_type = ""
    try:
        async with client.stream(
            "GET", url, headers=youtube_mod._HEADERS, follow_redirects=True
        ) as response:
            if response.status_code != 200:
                raise BriefError(502, f"{step} 단계가 실패했다 (HTTP {response.status_code})")
            _guard_host(str(response.url))
            content_type = response.headers.get("content-type", "")
            received = 0
            async for chunk in response.aiter_bytes():
                received += len(chunk)
                if received > MAX_FETCH_BYTES:
                    raise BriefError(
                        422,
                        f"내용이 너무 크다 — {MAX_FETCH_BYTES // (1024 * 1024)}MB까지만 받는다",
                    )
                chunks.append(chunk)
    except httpx.HTTPError as exc:
        raise BriefError(502, f"{step} 단계가 실패했다: {type(exc).__name__}") from exc
    # 실어 나르는 헤더는 content-type 하나다 — 인코딩(글자셋·gzip)은 스트림에서 이미 풀렸고,
    # 그 표시가 남아 있으면 다시 푸는 쪽이 헷갈린다.
    headers = {"content-type": content_type} if content_type else {}
    return httpx.Response(200, headers=headers, content=b"".join(chunks))


def _payload(
    kind: str,
    url: str,
    title: str,
    text: str,
    *,
    truncated: bool = False,
    language: str | None = None,
) -> dict[str, Any]:
    return {
        "source_kind": kind,
        "url": url,
        "title": title,
        "text": text[:MAX_TEXT_CHARS],
        "truncated": truncated or len(text) > MAX_TEXT_CHARS,
        "language": language,
    }


# ── 유튜브 — youtube.py에 그대로 넘긴다 ──────────────────────────────────────


async def _youtube_brief(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    raw = await youtube_mod.fetch_brief(url, client=client)
    return _payload(
        "youtube",
        url,
        str(raw["title"]),
        str(raw["text"]),
        truncated=bool(raw["truncated"]),
        # 설명으로 물러섰을 때 youtube.py는 ""를 준다 — 모르는 것은 None으로 말한다.
        language=str(raw["language"]) or None,
    )


# ── 네이버 블로그 — 본문은 iframe 안에 있다 ──────────────────────────────────


def _naver_ids(url: str) -> tuple[str, str]:
    """`blog.naver.com/<id>/<logNo>`와 `?blogId=&logNo=` 두 모양을 읽는다."""
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    blog_id = (query.get("blogId") or [""])[0].strip()
    log_no = (query.get("logNo") or [""])[0].strip()
    if not (blog_id and log_no):
        segments = [s for s in parts.path.split("/") if s]
        if len(segments) >= 2 and _LOG_NO.match(segments[1]):
            blog_id, log_no = segments[0], segments[1]
    if not blog_id or not _LOG_NO.match(log_no):
        raise BriefError(422, f"네이버 블로그 글 주소를 읽지 못했다: {url}")
    return blog_id, log_no


async def _naver_brief(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    blog_id, log_no = _naver_ids(url)
    query = f"blogId={blog_id}&logNo={log_no}"
    hops = (
        (f"https://blog.naver.com/PostView.naver?{query}", "네이버 블로그 본문"),
        (f"https://m.blog.naver.com/PostView.naver?{query}", "네이버 블로그 모바일 본문"),
    )
    failure: BriefError | None = None
    title = ""
    for target, step in hops:
        try:
            response = await _get(client, target, step=step)
        except BriefError as exc:
            failure = exc
            continue
        doc = _parse(response.text)
        title = title or doc.title()
        # SmartEditor ONE과 구 에디터 — 네이버는 두 모양이 아직 같이 산다.
        text = doc.find(classes=("se-main-container",), ids=("postViewArea",))
        if text:
            return _payload("naver_blog", url, title, text)
    if failure is not None:
        raise failure
    raise BriefError(422, "네이버 블로그 본문을 찾지 못했다 — 비공개 글이거나 모양이 다르다")


# ── PDF ──────────────────────────────────────────────────────────────────────


def _pdf_brief(url: str, data: bytes) -> dict[str, Any]:
    # 바이트 상한은 `_get`이 받으면서 이미 걸었다 — 여기까지 온 것은 그 예산 안이다.
    # PDF일 때만 든다 — 다른 주소는 이 import 비용을 내지 않는다.
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        total = len(reader.pages)
        chunks = [page.extract_text() or "" for page in reader.pages[:MAX_PDF_PAGES]]
    except Exception as exc:
        raise BriefError(422, f"PDF를 읽지 못했다: {type(exc).__name__}") from None
    text = _collapse("\n".join(chunks))
    if not text:
        raise BriefError(422, "PDF에서 글을 뽑지 못했다 — 그림으로만 된 문서일 수 있다")
    try:
        meta_title = str((reader.metadata or {}).get("/Title") or "").strip()
    except Exception:
        # 메타데이터가 깨졌다고 브리프를 버리지 않는다 — 제목만 파일 이름으로 물러선다.
        meta_title = ""
    fallback = [s for s in urlsplit(url).path.split("/") if s]
    return _payload(
        "pdf",
        url,
        meta_title or (fallback[-1] if fallback else ""),
        text,
        truncated=total > MAX_PDF_PAGES,
    )


# ── 일반 HTML ────────────────────────────────────────────────────────────────


def _html_brief(url: str, html_text: str) -> dict[str, Any]:
    doc = _parse(html_text)
    text = doc.main_text()
    if not text:
        raise BriefError(422, f"본문 글을 찾지 못했다: {url}")
    return _payload("html", url, doc.title(), text)


__all__ = [
    "MAX_FETCH_BYTES",
    "MAX_PDF_PAGES",
    "MAX_TEXT_CHARS",
    "BriefError",
    "brief_from_url",
    "source_kind",
]
