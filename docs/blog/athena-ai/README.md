# ATHENA Engineering — 금융 도구와 투자 기억

[Page 1 디자인을 적용한 3편 미리보기](index.html) · [Paper 편집본](https://app.paper.design/file/01M22GG877DW4N96CGABTKJTAH/3-0) · [ATHENA WEBSITE Page 1](https://app.paper.design/file/01M22GG877DW4N96CGABTKJTAH/1-0)

ATHENA의 실제 알고리즘을 처음 보는 사람도 이해할 수 있도록 짧은 설명과 도식으로 구성한 기술 블로그입니다.

1. [ATHENA Tool Use](01-tool-selection.md) — Function Calling, Tool Routing, Schema Validation, First-valid Hedging
2. [Agentic Memory for ATHENA](02-investment-memory.md) — Structured Extraction, 지식 그래프, Provenance, 중복 정리
3. [RAG for ATHENA](03-graph-retrieval.md) — BM25 Entity Retrieval, Graph Retrieval, Evidence Grounding, LLM Labeling

## 표현 기준

- **현재 구현**: 2026.09.10 코드 검토로 확인한 ATHENA 동작
- **관련 연구·방법론**: ToolRerank의 Figure와 후보 검색·재정렬 구조를 기술 설명에 참고합니다. 2·3편은 출처·근거를 보존하는 ATHENA의 실제 기억·검색 알고리즘을 설명합니다.
- **글의 구성**: 적용 모드, 세 단계의 알고리즘 설명과 도식, 해결한 문제, 상세 용어 주석으로 구성합니다. 본문 섹션에는 카드 테두리를 사용하지 않습니다.
- **자체 도식**: 제목과 안내 캡션 없이 알고리즘을 보여주며, 웹에서는 흐름 애니메이션을 재생합니다. 움직임 줄이기 설정과 Paper에는 정지 도식을 사용합니다.

## 논문 Figure 사용

- `assets/toolrerank-figure-2-original.png`: Zheng et al., 2024, 「ToolRerank」, Figure 2, p. 16265(PDF 3쪽)를 내용 변경 없이 크롭한 이미지
- 저작권: © 2024 ELRA Language Resource Association
- 라이선스: [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) · [논문 원문](https://aclanthology.org/2024.lrec-main.1413/)
- 이 라이선스는 비영리 이용 조건을 포함합니다. 공개 회사 블로그나 상업적 사용에 해당하는지는 별도 검토가 필요하며, 필요한 경우 권리자 허락을 받아야 합니다.

미리보기는 ATHENA WEBSITE의 Paper Page 1을 기준으로 흰 배경, `#14171D` 본문, `#0E20B2` 브랜드 블루, Daki 계열 글꼴, 넓은 여백과 pill 버튼을 사용했습니다. 설명 흐름은 [OpenAI 엔지니어링 글](https://openai.com/index/continuous-voice-interaction-with-gpt-live/)의 문제 → 설계 → 동작 구성을 참고했으며 본문과 도식은 새로 작성했습니다.

## 검증 범위

- Paper 편집본: 3개 아트보드에 각각 4개 섹션과 용어 주석을 배치했습니다. 1편에는 ToolRerank 원본 Figure 2도 포함합니다. Paper 스크린샷으로 히어로와 적용 모드 배치를 확인했습니다.
- 원고·도식: 현재 사용하는 자체 도식 9개와 정지 버전의 SVG XML 검사를 통과했습니다. 이전 평가 계획 도식은 파일만 보존하고 본문에서 사용하지 않습니다.
- 웹 미리보기: 고유 ID, 내부 링크, 이미지 10개와 정지 도식 9개의 파일 존재 검사를 통과했습니다. 대표 SVG의 애니메이션 프레임 변화와 움직임 줄이기 설정의 정지 상태도 확인했습니다. 전체 페이지의 실제 브라우저 시각 검사는 로컬 파일 접근 정책에 막혀 수행하지 못했습니다.
- 이 검증은 문서의 구현 설명과 디자인에 관한 것이며, 서비스의 성능 개선을 측정한 결과가 아닙니다.
