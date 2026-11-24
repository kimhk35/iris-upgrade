# IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
# -*- coding: utf-8 -*-
"""
htmldoc.py — HTML 을 한/글(hwpx)·워드(docx) 파일로 저장한다(대화 내보내기, P18 2026-11-24 2차 시안 4번).

사용:  python htmldoc.py <html> <결과.hwpx|결과.docx>
종료코드 1 + stderr [NOAPP] = 그 프로그램 없음 · 3 = 이 파이썬에 모듈 없음
"""
from __future__ import annotations

import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import doc2pdf as d  # noqa: E402


def to_hwpx(src: str, out: str) -> None:
    d._ensure_hwp_security()
    try:
        from pyhwpx import Hwp
    except ModuleNotFoundError:
        raise
    except Exception as e:
        raise d.NoApp(repr(e))
    hwp = Hwp(new=True, visible=False)
    try:
        if not hwp.hwp.Open(src, "HTML", "code:utf8;url:true;forceopen:true"):
            raise RuntimeError("HTML 을 열지 못함")
        if not hwp.save_as(out) or not os.path.exists(out):
            raise RuntimeError("저장 실패")
    finally:
        for f in (hwp.clear, hwp.quit):
            try:
                f()
            except Exception:
                pass


def to_docx(src: str, out: str) -> None:
    import pythoncom

    pythoncom.CoInitialize()
    app = d._dispatch("Word.Application")
    try:
        app.Visible = False
        app.DisplayAlerts = 0
        app.AutomationSecurity = 3
        doc = app.Documents.Open(src, ConfirmConversions=False, ReadOnly=True, AddToRecentFiles=False, Encoding=65001)
        for s in doc.InlineShapes:  # 바깥 그림 연결을 남기지 않는다
            try:
                s.LinkFormat.SavePictureWithDocument = True
                s.LinkFormat.BreakLink()
            except Exception:
                pass
        doc.SaveAs2(out, 16)  # wdFormatDocumentDefault
        doc.Close(False)
    finally:
        app.Quit()


def main() -> int:
    src, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    try:
        (to_hwpx if out.lower().endswith(".hwpx") else to_docx)(src, out)
    except ModuleNotFoundError as e:
        d._err(f"[NOMODULE] {e!r}")
        return 3
    except d.NoApp as e:
        d._err(f"[NOAPP] {e!r}")
        return 1
    except Exception as e:
        d._err(f"내보내기 실패: {e!r}")
        return 1
    return 0 if os.path.exists(out) else 1


if __name__ == "__main__":
    sys.exit(main())
