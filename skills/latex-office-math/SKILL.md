---
name: latex-office-math
description: 한글(HWP/HWPX)·워드(DOCX) 문서에 수식을 넣을 때 쓴다. 문서 속 LaTeX($…$, $$…$$)를 진짜 한글 수식 / 워드 수식 개체로 바꾼다. 수학·과학 문서, 시험지, 논문·보고서를 한글이나 워드로 만들 때, 또는 사용자가 "수식 넣어줘", "LaTeX 를 한글 수식으로", "워드 수식으로 바꿔줘" 라고 할 때.
---

# LaTeX → 한글·워드 진짜 수식

문서에 수식을 글자(`x^2`)나 그림으로 넣지 않는다. **LaTeX 로 적어 두고 마지막에 이 스킬로 진짜 수식 개체로 바꾼다** —
그래야 받는 사람이 한글/워드 수식 편집기로 고칠 수 있다.

## 순서

1. 문서를 평소처럼 만든다(한글 MCP·python-docx 등). 수식 자리는 LaTeX 로 적는다.
   - 문장 속 수식: `$x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$`
   - 따로 한 줄(가운데) 수식: 문단 하나에 `$$\int_0^1 x^2\,dx = \frac{1}{3}$$` 만
   - 돈 표기 `$5` 는 수식으로 보지 않는다(여는 `$` 뒤·닫는 `$` 앞에 빈칸이 없어야 수식).
2. 문서를 저장한 뒤 바꾼다(원본은 그대로, 결과는 `원래이름-수식.hwpx` / `원래이름-수식.docx`):
   - 한글: `python scripts/hwp_math.py 입력.hwpx [출력.hwpx]` — 한글 프로그램이 직접 수식을 만든다(크기 자동).
     파이썬은 pyhwpx 가 있는 것(IRIS: `C:\IRIS\_agent\runtime\venvs\document-mcp\Scripts\python.exe`).
   - 워드: `python scripts/docx_math.py 입력.docx [출력.docx]` — 파이썬 기본 기능 + node + 오피스 변환표(MML2OMML.XSL).
3. 결과 JSON 을 사용자에게 알린다: 바꾼 수(`converted`), 못 바꾼 것(`missed` — 그림·필드가 섞인 문단, 줄바꿈 낀 수식),
   변환 실패(`failed`, 워드) / 모르는 명령(`unknown_commands`, 한글). 남은 것은 손으로 고치도록 위치를 알려 준다.
4. 확인: 한글은 `convert_hwpx_to_pdf`, 워드는 `word_export_pdf` 로 PDF 를 만들어 보여 준다.

## 지원 범위(학교·연구 수학)

분수 `\frac` · 루트 `\sqrt`, `\sqrt[n]` · 첨자 `^ _` · `\int \sum \prod \lim` · 그리스 문자 · `\le \ge \ne \approx \pm \times \cdot` ·
화살표 · 집합(`\in \subset \cup \cap \emptyset`) · `\left( \right)` · 행렬(`matrix pmatrix bmatrix vmatrix`) · `cases` ·
`\text{…}` · `\overline \vec \hat` · `\angle \perp \therefore` · `\mathrm \mathbf`.
한글 쪽은 `scripts/latex2hwp.py` 가 번역하므로 모르는 명령은 이름만 남기고 경고한다 — 경고가 나오면 번역표(SYMBOLS)에 한 줄 더하고 시험을 돌린다.

## 시험

`python -I tests/test_latex2hwp.py`(번역 20) · `tests/test_hwp_math.py`(한글 실물 8) · `tests/test_docx_math.py`(워드 실물 7).

## 주의

- 원본 파일을 덮지 않는다(같은 이름을 주면 거절한다).
- 한글 쪽은 한글 프로그램을 몰래(보이지 않게) 띄웠다 닫는다 — 사용자가 한글로 같은 파일을 열어 두었으면 먼저 닫아 달라고 한다.
- HWPX 에 수식 XML 을 손으로 끼우지 않는다 — 한글이 크기를 다시 계산하지 않아 찌그러진다(2026-11-17 실측).
