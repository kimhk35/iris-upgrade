"""engine/common.py — 공통 헬퍼: 경로 검증, 페이지 지정 파싱, 암호화 PDF 열기.

페이지 지정 문자열(pages spec)은 사용자 눈높이의 1-기반 표기를 받는다:
  "3"      → 3쪽
  "1-3,5"  → 1,2,3,5쪽
  "4-"     → 4쪽부터 끝까지
  "-2"     → 처음부터 2쪽까지
내부적으로는 0-기반 인덱스 목록으로 변환해 쓴다. None이면 전체 페이지.
"""
from __future__ import annotations

import os
import re
import threading
from typing import Optional

from pypdf import PdfReader

# ---- 쓰기 안전장치(P18 점검, 2026-11-11) ----
# ① 원본 보존: 이번 도구 호출에서 연 입력 파일과 같은 곳에는 결과를 쓰지 않는다("원본은 보존" 약속).
#    server.py 의 _bg 가 호출마다 begin_call() 로 목록을 비운다(작업 스레드별 기록).
# ② 시스템 폴더(Windows·Program Files·ProgramData)에는 쓰지 않는다.
# ③ 환경 변수 PDF_MCP_ROOTS(; 로 구분)를 주면 결과는 그 폴더들 안에만 쓴다(기본은 제한 없음).
_tl = threading.local()
_SYSTEM_RE = re.compile(r"^[A-Za-z]:\\(windows|program files|program files \(x86\)|programdata)(\\|$)", re.I)


def _key(p: str) -> str:
    return os.path.normcase(os.path.realpath(p))


def begin_call() -> None:
    """도구 호출 하나의 시작 — 원본 목록을 비운다."""
    _tl.sources = set()


def _check_out(p: str) -> None:
    if _key(p) in getattr(_tl, "sources", set()):
        raise ValueError(f"결과 경로가 원본 파일과 같습니다 — 원본을 덮어쓰지 않도록 다른 이름을 주세요: {p}")
    if _SYSTEM_RE.match(p):
        raise ValueError(f"시스템 폴더에는 결과를 쓸 수 없습니다: {p}")
    roots = [r for r in os.environ.get("PDF_MCP_ROOTS", "").split(";") if r.strip()]
    if roots and not any(_key(p).startswith(_key(r).rstrip("\\/") + os.sep) for r in roots):
        raise ValueError(f"허용된 폴더(PDF_MCP_ROOTS) 밖에는 쓸 수 없습니다: {p}")


def check_src(path: str) -> str:
    """입력 파일 존재를 확인하고 절대경로를 돌려준다(이번 호출의 원본 목록에 적는다)."""
    p = os.path.abspath(path)
    if not os.path.isfile(p):
        raise FileNotFoundError(f"입력 파일이 없습니다: {p}")
    if not hasattr(_tl, "sources"):
        _tl.sources = set()
    _tl.sources.add(_key(p))
    return p


def ensure_parent(path: str) -> str:
    """출력 파일의 부모 폴더를 만들고 절대경로를 돌려준다(원본·시스템 폴더·허용 폴더 밖이면 거절)."""
    p = os.path.abspath(path)
    _check_out(p)
    parent = os.path.dirname(p)
    if parent:
        os.makedirs(parent, exist_ok=True)
    return p


def ensure_dir(path: str) -> str:
    """출력 폴더를 만들고 절대경로를 돌려준다(시스템 폴더·허용 폴더 밖이면 거절)."""
    p = os.path.abspath(path)
    _check_out(os.path.join(p, "_"))
    os.makedirs(p, exist_ok=True)
    return p


def open_reader(path: str, password: Optional[str] = None) -> PdfReader:
    """PDF를 열어 PdfReader를 돌려준다. 암호화 문서는 password로 해제(빈 암호도 시도)."""
    reader = PdfReader(check_src(path))
    if reader.is_encrypted:
        pw = password if password is not None else ""
        if not reader.decrypt(pw):
            raise ValueError(
                "암호화된 PDF입니다 — 올바른 password 인자를 함께 주세요." if password is None
                else "암호가 틀렸습니다."
            )
    return reader


def parse_pages(spec: Optional[str], total: int) -> list[int]:
    """1-기반 페이지 지정 문자열 → 0-기반 인덱스 목록. spec이 None이면 전체."""
    if total <= 0:
        raise ValueError("페이지가 없는 PDF입니다.")
    if spec is None or str(spec).strip() == "":
        return list(range(total))
    out: list[int] = []
    for raw in str(spec).split(","):
        token = raw.strip()
        if not token:
            continue
        if "-" in token:
            a, _, b = token.partition("-")
            start = int(a) if a.strip() else 1
            end = int(b) if b.strip() else total
        else:
            start = end = int(token)
        if start < 1 or end > total or start > end:
            raise ValueError(f"페이지 범위가 잘못됐습니다: '{token}' (문서는 1~{total}쪽)")
        out.extend(range(start - 1, end))
    if not out:
        raise ValueError(f"페이지 지정이 비었습니다: '{spec}'")
    return out


def stem_of(path: str) -> str:
    return os.path.splitext(os.path.basename(path))[0]
