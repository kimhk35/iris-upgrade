"""문서 → 글자 (P18 표절 점검). txt·md·docx·hwpx·pdf 는 파이썬만으로, hwp 는 한글 프로그램이 있으면(pyhwpx) 읽는다.
문단은 줄바꿈 하나로 이어 돌려준다. 읽을 수 없으면 ValueError(이유)."""
from __future__ import annotations

import html
import os
import re
import zipfile

SUPPORTED = (".txt", ".md", ".docx", ".hwpx", ".pdf", ".hwp")


def _xml_paras(xml: str, p_tag: str, t_tag: str) -> list[str]:
    out = []
    for p in re.findall(rf"<{p_tag}\b[^>]*>.*?</{p_tag}>", xml, re.S):
        out.append("".join(html.unescape(t) for t in re.findall(rf"<{t_tag}\b[^>]*>(.*?)</{t_tag}>", p, re.S)))
    return out


def read_text(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext in (".txt", ".md"):
        raw = open(path, "rb").read()
        for enc in ("utf-8-sig", "cp949"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                pass
        return raw.decode("utf-8", "replace")
    if ext == ".docx":
        z = zipfile.ZipFile(path)
        parts = ["word/document.xml"] + sorted(n for n in z.namelist() if re.match(r"word/(footnotes|endnotes)\.xml$", n))
        return "\n".join(p for name in parts if name in z.namelist() for p in _xml_paras(z.read(name).decode("utf-8"), "w:p", "w:t"))
    if ext == ".hwpx":
        z = zipfile.ZipFile(path)
        secs = sorted((n for n in z.namelist() if re.match(r"Contents/section\d+\.xml$", n)), key=lambda n: int(re.findall(r"\d+", n)[-1]))
        out = []
        for s in secs:
            xml = re.sub(r"<hp:equation\b.*?</hp:equation>", "", z.read(s).decode("utf-8"), flags=re.S)  # 수식 스크립트는 본문 글자가 아님
            out += _xml_paras(xml, "hp:p", "hp:t")
        return "\n".join(out)
    if ext == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as e:
            raise ValueError("PDF 를 읽으려면 pypdf 가 필요합니다") from e
        r = PdfReader(path)
        if r.is_encrypted:
            raise ValueError("암호가 걸린 PDF 입니다")
        return "\n".join((pg.extract_text() or "") for pg in r.pages)
    if ext == ".hwp":
        try:
            from pyhwpx import Hwp
        except ImportError as e:
            raise ValueError(".hwp 는 한글 프로그램(pyhwpx)이 있어야 읽습니다 — .hwpx 로 저장해 주세요") from e
        h = Hwp(new=True, visible=False)
        try:
            h.open(os.path.abspath(path))
            return h.get_text_file("TEXT", "") or ""
        finally:
            try:
                h.clear(1); h.quit()
            except Exception:
                pass
    raise ValueError(f"지원하지 않는 형식: {ext}")
