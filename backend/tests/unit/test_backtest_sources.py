"""sources.py — 아무 주소나 글로 옮기는 계약(유튜브·네이버 블로그·PDF·일반 웹페이지).

네트워크는 한 번도 나가지 않는다: 응답을 여기서 만들고 `httpx.MockTransport`로 받아친다
(tests/unit/test_backtest_youtube.py와 같은 방식). PDF도 파일을 두지 않고 이 파일이
바이트를 직접 짓는다 — 픽스처가 코드 옆에 있어야 무엇을 고정하는지 읽힌다.

이 파일이 못 박는 것: 주소별 갈래, 네이버의 iframe 우회(PostView)와 에디터 두 모양,
PDF 쪽·바이트 상한, 일반 페이지의 본문 고르기(메뉴·꼬리말 제외), 20000자 예산,
그리고 실패가 422(못 읽었다)와 502(어느 단계가 무너졌다)로 갈리는 자리.
"""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest

from athena_api.backtest import sources

NAVER_URL = "https://blog.naver.com/quantkim/223456789"


def _client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _pdf_bytes(pages: list[str]) -> bytes:
    """텍스트가 든 최소 PDF. 글꼴이 Helvetica(WinAnsi)라 픽스처 문장은 영문이다 —
    한글을 넣으려면 CID 글꼴을 심어야 하는데, 여기서 고정하려는 것은 한글이 아니라
    '쪽에서 글자가 나온다'와 '쪽 상한에서 잘린다'이다."""
    count = len(pages)
    font = 3 + 2 * count
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(count))
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {count} >>".encode(),
    ]
    for index, text in enumerate(pages):
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("latin-1")
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                f"/Resources << /Font << /F1 {font} 0 R >> >> "
                f"/Contents {4 + 2 * index} 0 R >>"
            ).encode()
        )
        objects.append(
            b"<< /Length "
            + str(len(stream)).encode()
            + b" >>\nstream\n"
            + stream
            + b"\nendstream"
        )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    start = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode() + b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{start}\n%%EOF\n"
    ).encode()
    return bytes(out)


def _watch_page(*, description: str) -> str:
    """유튜브 워치 페이지의 뼈대 — 자막 없이 설명만 있는 가장 짧은 모양."""
    player = {
        "videoDetails": {
            "videoId": "dQw4w9WgXcQ",
            "title": "퀀트 투자 3원칙",
            "author": "퀀트 채널",
            "shortDescription": description,
        }
    }
    blob = json.dumps(player, ensure_ascii=False)
    return f"<html><body><script>var r = {blob};</script></body></html>"


# ── 주소 표 — 어디로 갈지는 주소가 정한다 ────────────────────────────────────


@pytest.mark.parametrize(
    ("url", "kind"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"),
        ("https://youtu.be/dQw4w9WgXcQ", "youtube"),
        ("youtube.com/shorts/dQw4w9WgXcQ", "youtube"),
        ("https://blog.naver.com/quantkim/223456789", "naver_blog"),
        ("https://m.blog.naver.com/quantkim/223456789", "naver_blog"),
        ("https://blog.naver.com/PostView.naver?blogId=quantkim&logNo=223456789", "naver_blog"),
        ("https://papers.example.ac.kr/2026/momentum.pdf", "pdf"),
        ("https://papers.example.ac.kr/2026/MOMENTUM.PDF?download=1", "pdf"),
        ("https://www.hankyung.com/article/2026090112345", "html"),
        ("news.example.com/quant", "html"),
    ],
)
def test_url_dispatch_table(url: str, kind: str) -> None:
    assert sources.source_kind(url) == kind


@pytest.mark.parametrize("url", ["", "   ", "그냥 글자", "ftp://example.com/a.pdf", "https:///x"])
def test_unreadable_addresses_are_422_in_korean(url: str) -> None:
    with pytest.raises(sources.BriefError) as caught:
        sources.source_kind(url)
    assert caught.value.status == 422, url
    assert caught.value.message.strip(), url


# ── 유튜브 — youtube.py에 넘긴다(규칙을 두 번 적지 않는다) ───────────────────


async def test_youtube_is_delegated_and_wears_the_same_brief_shape() -> None:
    page = _watch_page(description="20/60 이동평균 교차 전략")

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/watch"
        return httpx.Response(200, html=page)

    async with _client(handle) as client:
        brief = await sources.brief_from_url("https://youtu.be/dQw4w9WgXcQ", client=client)

    assert brief["source_kind"] == "youtube"
    assert brief["title"] == "퀀트 투자 3원칙"
    assert brief["text"] == "20/60 이동평균 교차 전략"
    assert brief["truncated"] is False
    # 설명으로 물러섰을 때 youtube.py는 ""를 준다 — 모르는 것은 None으로 말한다.
    assert brief["language"] is None
    assert set(brief) == {"source_kind", "url", "title", "text", "truncated", "language"}


# ── 네이버 블로그 — 본문은 iframe 안에 있다 ─────────────────────────────────


def _se_post(body: str, *, title: str = "20일선 전략") -> str:
    return (
        "<html><head>"
        f'<meta property="og:title" content="{title}">'
        "<title>네이버 블로그</title></head><body>"
        '<div class="blog-header"><nav>이웃 새글 안부글</nav></div>'
        '<div class="se-main-container">'
        f"<div class=\"se-component\"><p>{body}</p></div>"
        "</div>"
        "<div class=\"comment\">댓글 3</div>"
        "</body></html>"
    )


def _old_post(body: str) -> str:
    return (
        "<html><head><title>네이버 블로그</title></head><body>"
        f'<div id="postViewArea"><p>{body}</p></div>'
        "</body></html>"
    )


async def test_naver_hops_to_postview_because_the_post_lives_in_an_iframe() -> None:
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        assert request.url.path == "/PostView.naver"
        assert request.url.params["blogId"] == "quantkim"
        assert request.url.params["logNo"] == "223456789"
        return httpx.Response(200, html=_se_post("20일선이 60일선을 위로 뚫으면 산다."))

    async with _client(handle) as client:
        brief = await sources.brief_from_url(NAVER_URL, client=client)

    assert len(seen) == 1  # 겉 페이지는 아예 받지 않는다 — 거기엔 글이 없다
    assert seen[0].startswith("https://blog.naver.com/PostView.naver")
    assert brief["source_kind"] == "naver_blog"
    assert brief["url"] == NAVER_URL
    assert brief["title"] == "20일선 전략"
    assert brief["text"] == "20일선이 60일선을 위로 뚫으면 산다."
    assert "이웃 새글" not in brief["text"] and "댓글" not in brief["text"]


async def test_naver_old_editor_container_is_read_too() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, html=_old_post("RSI 30 아래에서 분할 매수한다."))

    async with _client(handle) as client:
        brief = await sources.brief_from_url(NAVER_URL, client=client)

    assert brief["text"] == "RSI 30 아래에서 분할 매수한다."
    assert brief["title"] == "네이버 블로그"  # og:title이 없으면 <title>


@pytest.mark.parametrize(
    "url",
    [
        "https://m.blog.naver.com/quantkim/223456789",
        "https://blog.naver.com/PostView.naver?blogId=quantkim&logNo=223456789",
        "blog.naver.com/quantkim/223456789?fromRss=true",
    ],
)
async def test_every_naver_shape_resolves_to_the_same_post(url: str) -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        assert request.url.params["blogId"] == "quantkim"
        assert request.url.params["logNo"] == "223456789"
        return httpx.Response(200, html=_se_post("같은 글이다."))

    async with _client(handle) as client:
        brief = await sources.brief_from_url(url, client=client)

    assert brief["text"] == "같은 글이다."


async def test_naver_falls_back_to_mobile_when_the_desktop_hop_fails() -> None:
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.host)
        if request.url.host == "blog.naver.com":
            return httpx.Response(500, text="boom")
        return httpx.Response(200, html=_se_post("모바일에서 읽었다."))

    async with _client(handle) as client:
        brief = await sources.brief_from_url(NAVER_URL, client=client)

    assert seen == ["blog.naver.com", "m.blog.naver.com"]
    assert brief["text"] == "모바일에서 읽었다."


async def test_naver_without_a_known_container_is_422() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, html="<html><body><div>비공개 글입니다</div></body></html>")

    async with _client(handle) as client:
        with pytest.raises(sources.BriefError) as caught:
            await sources.brief_from_url(NAVER_URL, client=client)

    assert caught.value.status == 422
    assert "본문을 찾지 못했다" in caught.value.message


async def test_both_naver_hops_down_is_502_naming_the_step() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host", request=request)

    async with _client(handle) as client:
        with pytest.raises(sources.BriefError) as caught:
            await sources.brief_from_url(NAVER_URL, client=client)

    assert caught.value.status == 502
    assert "네이버 블로그" in caught.value.message
    assert "Traceback" not in caught.value.message


async def test_a_naver_address_without_a_post_number_is_422() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        raise AssertionError("읽을 수 없는 주소로 네트워크를 두드렸다")

    async with _client(handle) as client:
        with pytest.raises(sources.BriefError) as caught:
            await sources.brief_from_url("https://blog.naver.com/quantkim", client=client)

    assert caught.value.status == 422
    assert "네이버 블로그 글 주소" in caught.value.message


# ── PDF ──────────────────────────────────────────────────────────────────────


def _pdf_response(data: bytes) -> Callable[[httpx.Request], httpx.Response]:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=data, headers={"content-type": "application/pdf"})

    return handle


async def test_pdf_text_is_extracted_page_by_page() -> None:
    data = _pdf_bytes(["Momentum returns are persistent.", "Value premium is thinner."])

    async with _client(_pdf_response(data)) as client:
        brief = await sources.brief_from_url(
            "https://papers.example.ac.kr/2026/momentum.pdf", client=client
        )

    assert brief["source_kind"] == "pdf"
    assert "Momentum returns are persistent." in brief["text"]
    assert "Value premium is thinner." in brief["text"]
    assert brief["truncated"] is False
    assert brief["title"] == "momentum.pdf"  # 메타데이터에 제목이 없으면 파일 이름
    assert brief["language"] is None


async def test_content_type_alone_is_enough_to_read_a_pdf() -> None:
    """주소에 .pdf가 없어도 응답이 PDF라고 말하면 PDF로 읽는다(다운로드 링크가 흔하다)."""
    data = _pdf_bytes(["Carry trades unwind fast."])

    async with _client(_pdf_response(data)) as client:
        brief = await sources.brief_from_url(
            "https://papers.example.ac.kr/download?id=77", client=client
        )

    assert brief["source_kind"] == "pdf"
    assert "Carry trades unwind fast." in brief["text"]


async def test_pdf_over_the_page_cap_is_cut_and_says_so() -> None:
    pages = [f"Page {i} of the appendix." for i in range(sources.MAX_PDF_PAGES + 1)]
    data = _pdf_bytes(pages)

    async with _client(_pdf_response(data)) as client:
        brief = await sources.brief_from_url("https://example.ac.kr/long.pdf", client=client)

    assert brief["truncated"] is True
    assert f"Page {sources.MAX_PDF_PAGES - 1} of the appendix." in brief["text"]
    assert f"Page {sources.MAX_PDF_PAGES} of the appendix." not in brief["text"]


async def test_pdf_over_the_byte_cap_is_not_parsed_at_all(monkeypatch) -> None:
    monkeypatch.setattr(sources, "MAX_PDF_BYTES", 1024 * 1024)
    data = _pdf_bytes(["short"]) + b"%" * (1024 * 1024)

    async with _client(_pdf_response(data)) as client:
        with pytest.raises(sources.BriefError) as caught:
            await sources.brief_from_url("https://example.ac.kr/huge.pdf", client=client)

    assert caught.value.status == 422
    assert "너무 크다" in caught.value.message


async def test_a_pdf_we_cannot_parse_is_422_not_a_traceback() -> None:
    fake = "%PDF-1.4 그러나 사실은 아니다".encode()
    async with _client(_pdf_response(fake)) as client:
        with pytest.raises(sources.BriefError) as caught:
            await sources.brief_from_url("https://example.ac.kr/broken.pdf", client=client)

    assert caught.value.status == 422
    assert "PDF" in caught.value.message
    assert "Traceback" not in caught.value.message


# ── 일반 HTML — 본문은 가장 큰 덩어리다 ──────────────────────────────────────


ARTICLE_PAGE = (
    "<!DOCTYPE html><html><head><title>탭에 뜨는 제목</title>"
    '<meta property="og:title" content="20일 이동평균 전략">'
    "</head><body>"
    "<nav>홈 시황 종목 로그인 회원가입 뉴스레터 구독</nav>"
    "<header>가상 경제신문 2026년 9월 2일자</header>"
    '<div class="wrap">'
    "<aside>많이 본 기사 1 많이 본 기사 2 많이 본 기사 3 광고 문의</aside>"
    "<article><p>20일 이동평균이 60일 이동평균을 위로 뚫으면 산다.</p>"
    "<p>반대로 아래로 뚫으면 판다.</p></article>"
    "</div>"
    "<footer>저작권 안내 · 이메일 주소 · 광고 문의 · 제휴 문의</footer>"
    "</body></html>"
)


async def _html_brief(html: str, url: str = "https://news.example.com/a") -> dict:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, html=html)

    async with _client(handle) as client:
        return await sources.brief_from_url(url, client=client)


async def test_generic_page_keeps_the_article_and_drops_the_chrome() -> None:
    brief = await _html_brief(ARTICLE_PAGE)

    assert brief["source_kind"] == "html"
    assert brief["title"] == "20일 이동평균 전략"  # og:title이 <title>을 이긴다
    assert brief["text"] == (
        "20일 이동평균이 60일 이동평균을 위로 뚫으면 산다.\n반대로 아래로 뚫으면 판다."
    )
    for chrome in ("로그인", "가상 경제신문", "많이 본 기사", "저작권 안내"):
        assert chrome not in brief["text"]


async def test_without_a_semantic_tag_the_biggest_block_wins() -> None:
    page = (
        "<html><head><title>제목만 있다</title></head><body>"
        "<nav>메뉴</nav>"
        '<div id="side">관련 글</div>'
        '<div id="body"><p>이동평균 교차로 사고판다.</p>'
        "<p>손절은 5퍼센트에 둔다.</p></div>"
        "<footer>꼬리말</footer></body></html>"
    )

    brief = await _html_brief(page)

    assert brief["title"] == "제목만 있다"
    assert brief["text"] == "이동평균 교차로 사고판다.\n손절은 5퍼센트에 둔다."
    assert "관련 글" not in brief["text"]


async def test_inline_tags_do_not_glue_words_together() -> None:
    page = "<html><body><article><p><b>골든</b> <i>크로스</i>에서 산다</p></article></body></html>"

    brief = await _html_brief(page)

    assert brief["text"] == "골든 크로스에서 산다"


async def test_long_page_is_truncated_and_says_so() -> None:
    body = "가" * (sources.MAX_TEXT_CHARS + 500)
    brief = await _html_brief(f"<html><body><article><p>{body}</p></article></body></html>")

    assert brief["truncated"] is True
    assert len(brief["text"]) == sources.MAX_TEXT_CHARS


async def test_a_page_with_no_text_is_422() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, html="<html><head><script>var a=1;</script></head></html>")

    async with _client(handle) as client:
        with pytest.raises(sources.BriefError) as caught:
            await sources.brief_from_url("https://news.example.com/a", client=client)

    assert caught.value.status == 422
    assert "본문 글을 찾지 못했다" in caught.value.message


@pytest.mark.parametrize("status", [403, 404, 500])
async def test_a_page_that_will_not_open_is_502_naming_the_step(status: int) -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, html="<html>없다</html>")

    async with _client(handle) as client:
        with pytest.raises(sources.BriefError) as caught:
            await sources.brief_from_url("https://news.example.com/a", client=client)

    assert caught.value.status == 502
    assert "페이지 단계가 실패했다" in caught.value.message
    assert str(status) in caught.value.message


async def test_a_network_error_is_502_without_a_traceback() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    async with _client(handle) as client:
        with pytest.raises(sources.BriefError) as caught:
            await sources.brief_from_url("https://news.example.com/a", client=client)

    assert caught.value.status == 502
    assert "페이지 단계가 실패했다" in caught.value.message
    assert "ConnectTimeout" in caught.value.message
