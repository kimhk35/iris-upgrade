"""워드 문서(.docx) 속 LaTeX($…$ · $$…$$)를 진짜 워드 수식으로 바꾼다 (P18 IRIS 고도화, 2026-11-17).

LaTeX → MathML(tex2mathml.cjs, KaTeX 동봉본) → 워드 수식 OMML(mml2omml.ps1, 오피스의 MML2OMML.XSL) → document.xml 의
그 문단에 갈아 끼운다. 파이썬 기본 기능만 쓴다(설치 없음). 원본은 덮지 않는다 — 결과는 out(기본: 원본이름-수식.docx).

문단 안이 글자 덩어리(w:r/w:t·탭·줄바꿈)뿐일 때만 다시 짠다 — 그림·하이퍼링크·필드가 섞인 문단은 건드리지 않고 missed 로 알린다.
글자 모양은 그 문단 첫 덩어리의 모양을 따른다. 문단 전체가 $$…$$ 하나면 가운데 수식(oMathPara).

쓰기: python docx_math.py 입력.docx [출력.docx]     (윈도 + Microsoft Office + node)
"""
from __future__ import annotations

import html
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
MATH_RE = re.compile(r"\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$0-9A-Za-z])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![0-9A-Za-z$])")  # hwp_math 와 같은 규칙(한글 조사는 붙어도 됨)
SIMPLE_CHILD = re.compile(r"^(?:<w:pPr\b.*?</w:pPr>|<w:pPr\b[^>]*/>|<w:r\b[^>]*>.*?</w:r>|<w:bookmark(?:Start|End)\b[^>]*/>|<w:proofErr\b[^>]*/>|\s)*$", re.S)
UNSAFE_IN_RUN = re.compile(r"<w:(drawing|pict|object|fldChar|instrText|footnoteReference|endnoteReference|commentReference)\b")


def node_exe() -> str:
    return os.environ.get("IRIS_NODE") or "node"


def to_omml(items: list[tuple[str, bool]]) -> list[str | None]:
    """[(LaTeX, 가운데?)] → [OMML 또는 None(변환 실패)]"""
    if not items:
        return []
    mml = subprocess.run([node_exe(), os.path.join(HERE, "tex2mathml.cjs")], input=json.dumps([{"tex": t, "display": d} for t, d in items]).encode("utf-8"),
                         capture_output=True, check=True).stdout.decode("utf-8")
    fd, tmp = tempfile.mkstemp(suffix=".json"); os.close(fd)
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(mml)
        r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", os.path.join(HERE, "mml2omml.ps1"), "-InFile", tmp], capture_output=True, check=True)
        out = json.loads(r.stdout.decode("utf-8-sig") or "[]")
    finally:
        os.remove(tmp)
    if isinstance(out, str) or out is None:  # 하나뿐이면 PowerShell 이 배열을 풀어 버린다
        out = [out]
    return [re.sub(r"<\?xml[^>]*\?>", "", o).strip() if o else None for o in out]


def _runs_text(p_xml: str) -> tuple[str, str]:
    """문단 → (이어 붙인 글자, 첫 덩어리 글자 모양 rPr)"""
    text = "".join(html.unescape(t) for t in re.findall(r"<w:t\b[^>]*>(.*?)</w:t>", p_xml, re.S))
    m = re.search(r"<w:r\b[^>]*>\s*(<w:rPr>.*?</w:rPr>)", p_xml, re.S)
    return text, (m.group(1) if m else "")


def _run(text: str, rpr: str) -> str:
    return f'<w:r>{rpr}<w:t xml:space="preserve">{html.escape(text, quote=False)}</w:t></w:r>' if text else ""


def convert(src: str, dst: str | None = None) -> dict:
    src = os.path.abspath(src)
    dst = os.path.abspath(dst) if dst else os.path.splitext(src)[0] + "-수식.docx"
    if os.path.normcase(dst) == os.path.normcase(src):
        raise ValueError("결과 파일이 원본과 같습니다 — 원본을 덮지 않도록 다른 이름을 주세요")
    zin = zipfile.ZipFile(src)
    doc = zin.read("word/document.xml").decode("utf-8")
    paras = list(re.finditer(r"<w:p\b[^>]*>.*?</w:p>", doc, re.S))
    plan, missed, jobs = [], [], []
    for m in paras:
        p = m.group(0)
        text, rpr = _runs_text(p)
        found = list(MATH_RE.finditer(text))
        if not found:
            continue
        inner = re.sub(r"^<w:p\b[^>]*>|</w:p>$", "", p)
        if not SIMPLE_CHILD.match(inner) or UNSAFE_IN_RUN.search(inner):
            missed += [f.group(0) for f in found]; continue
        segs, last = [], 0
        for f in found:
            tex = next(g for g in f.groups() if g is not None).strip()
            display = bool(f.group(1) or f.group(2))
            segs.append(("text", text[last:f.start()])); segs.append(("math", len(jobs))); jobs.append((tex, display)); last = f.end()
        segs.append(("text", text[last:]))
        alone = len(found) == 1 and not text[:found[0].start()].strip() and not text[found[0].end():].strip() and (found[0].group(1) or found[0].group(2))
        plan.append((m, segs, rpr, bool(alone)))
    omml = to_omml(jobs)
    out, pos, done, failed = [], 0, 0, []
    for m, segs, rpr, alone in plan:
        p = m.group(0)
        head = re.match(r"<w:p\b[^>]*>", p).group(0)
        ppr = (re.search(r"<w:pPr\b.*?</w:pPr>|<w:pPr\b[^>]*/>", p, re.S) or [""])[0] if re.search(r"<w:pPr\b", p) else ""
        body = []
        for kind, v in segs:
            if kind == "text":
                body.append(_run(v, rpr)); continue
            o = omml[v] if v < len(omml) else None
            if not o:
                failed.append(jobs[v][0]); body.append(_run(f"${jobs[v][0]}$", rpr)); continue
            done += 1
            # 변환표는 가운데 수식이면 이미 oMathPara 로 싸서 준다 — 두 번 싸면 워드가 '손상된 파일'로 본다
            inner_math = re.sub(r"^<m:oMathPara\b[^>]*>|</m:oMathPara>$", "", o)
            if inner_math != o:
                inner_math = inner_math.replace("<m:oMath>", f'<m:oMath xmlns:m="{M_NS}">', 1)
            body.append(f'<m:oMathPara xmlns:m="{M_NS}">{inner_math}</m:oMathPara>' if alone else inner_math)
        out.append(doc[pos:m.start()]); out.append(head + ppr + "".join(body) + "</w:p>"); pos = m.end()
    out.append(doc[pos:])
    new = "".join(out)
    if done and f'xmlns:m="{M_NS}"' not in new[:2000]:
        new = re.sub(r"<w:document\b", f'<w:document xmlns:m="{M_NS}"', new, count=1)
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, new.encode("utf-8") if item.filename == "word/document.xml" else zin.read(item.filename))
    return {"out": dst, "converted": done, "missed": missed, "failed": failed}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    print(json.dumps(convert(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None), ensure_ascii=False, indent=2))
