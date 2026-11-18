"""한글 문서(.hwp/.hwpx) 속 LaTeX($…$ · $$…$$)를 진짜 한글 수식으로 바꾼다 (P18 IRIS 고도화, 2026-11-17).

한글 프로그램이 직접 수식을 만들게 한다(「수식 만들기」 EquationCreate) — HWPX 에 수식 XML 을 손으로 끼우면 한글이 크기를
다시 계산하지 않아 찌그러진다(2026-11-17 실측). 순서: 문서 글자를 읽어 수식 자리를 찾고(돈 표기 $5 는 제외) → 한글 「찾기」로
그 글자를 정확히 골라 → 지우고 → 번역한 한글 수식을 그 자리에 만든다. $$…$$ 는 그 문단을 가운데 정렬.
원본은 덮지 않는다 — 결과는 out 경로(기본: 원본이름-수식.hwpx).

쓰기: python hwp_math.py 입력.hwpx [출력.hwpx]      (한글이 설치된 윈도 PC, pyhwpx 필요)
"""
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from latex2hwp import to_hwp  # noqa: E402

# $$…$$ · \[…\] · \(…\) · $…$(돈 표기 제외). 앞뒤 금지 글자는 영문·숫자만 — 한글 조사는 바로 붙어도 된다("$x$는", "1$입니다":
# 한글 자동 고침이 '$ 입니다'의 빈칸을 지우기도 한다, 2026-11-17 실측).
MATH_RE = re.compile(r"\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$0-9A-Za-z])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![0-9A-Za-z$])")


def spans(text: str) -> list[tuple[str, str, bool]]:
    """문서 글자 → [(원래 글자, LaTeX, 가운데 정렬할까)] 순서대로.
    가운데 정렬은 $$…$$ 가 그 줄에 혼자 있을 때만 — '2. 정적분: $$…$$' 처럼 글이 앞에 있으면 줄 전체를 가운데로 옮기지 않는다."""
    out = []
    for m in MATH_RE.finditer(text):
        tex = next(g for g in m.groups() if g is not None)
        ls = max(text.rfind("\n", 0, m.start()), text.rfind("\r", 0, m.start())) + 1
        le = min([i for i in (text.find("\n", m.end()), text.find("\r", m.end())) if i >= 0] or [len(text)])
        alone = not text[ls:m.start()].strip() and not text[m.end():le].strip()
        out.append((m.group(0), tex.strip(), bool(m.group(1) or m.group(2)) and alone))
    return out


def convert(src: str, dst: str | None = None) -> dict:
    src = os.path.abspath(src)
    if not os.path.isfile(src):
        raise FileNotFoundError(src)
    dst = os.path.abspath(dst) if dst else os.path.splitext(src)[0] + "-수식.hwpx"
    if os.path.normcase(dst) == os.path.normcase(src):
        raise ValueError("결과 파일이 원본과 같습니다 — 원본을 덮지 않도록 다른 이름을 주세요")
    from pyhwpx import Hwp
    hwp = Hwp(new=True, visible=False)
    done, missed, warnings = [], [], []
    try:
        hwp.open(src)
        text = hwp.get_text_file("TEXT", "") or ""
        hwp.MovePos(2)  # 문서 맨 앞
        for raw, tex, display in spans(text):
            script, warn = to_hwp(tex)
            warnings += warn
            # 한 줄 안의 글자만 한글 찾기로 정확히 고를 수 있다(줄바꿈이 든 $$…$$ 는 첫 줄 기준 — 드묾)
            if "\n" in raw or "\r" in raw or not hwp.find(raw, direction="Forward", regex=False):
                missed.append(raw); continue
            hwp.HAction.Run("Delete")
            pset = hwp.HParameterSet.HEqEdit
            hwp.HAction.GetDefault("EquationCreate", pset.HSet)
            pset.string = script
            hwp.HAction.Execute("EquationCreate", pset.HSet)
            if display:
                hwp.HAction.Run("ParagraphShapeAlignCenter")
            done.append({"latex": tex, "hwp": script})
        hwp.save_as(dst, "HWPX" if dst.lower().endswith(".hwpx") else "HWP")
    finally:
        try:
            hwp.clear(1); hwp.quit()
        except Exception:
            pass
    return {"out": dst, "converted": len(done), "items": done, "missed": missed, "unknown_commands": sorted(set(warnings))}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    print(json.dumps(convert(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None), ensure_ascii=False, indent=2))
