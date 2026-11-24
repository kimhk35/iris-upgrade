# IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
# -*- coding: utf-8 -*-
"""
doc2pdf.py — 문서(한/글·워드·엑셀·파워포인트)를 PDF로 변환한다.

IRIS-Face 데몬이 부르는 독립 실행 스크립트. 대화 안에 문서를 삽입하려고 원본을 PDF로
한 번 바꿔 캐시에 둔다. 원본은 절대 건드리지 않는다(읽기 전용으로 열고 새 PDF만 만든다).

사용:  python doc2pdf.py <원본경로> <PDF저장경로>
성공:  종료코드 0 + stdout 마지막 줄 "OK <PDF경로>"
실패:  종료코드 1 + stderr 에 사유([NOAPP] = 그 프로그램 없음, [LOCKED] = 파일이 잠김)
       종료코드 3 = 이 파이썬에 필요한 모듈이 없음(데몬이 다음 파이썬으로 다시 부른다)

인터프리터:
  - .hwp/.hwpx → pyhwpx 가 깔린 파이썬, 그 밖 → win32com 이 있는 파이썬(데몬이 골라 준다).

원본 보호(P18 2026-11-24): 원본을 임시 폴더에 베껴 그 사본을 연다 — 사용자가 같은 문서를 열어 두었을 때
그 창을 닫아 버리거나, 내려받은 문서의 「제한된 보기」에 막히지 않는다. 파워포인트는 하나만 뜨는 프로그램이라
사용자가 이미 쓰고 있으면 끄지 않는다.
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile

# 윈도 cp949 콘솔에서 한글 print 가 죽지 않도록 (R-010)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def _err(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _ensure_parent(path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)


class NoApp(RuntimeError):
    """그 문서를 여는 프로그램이 이 PC에 없다."""


# 클래스가 등록되지 않음 · 잘못된 클래스 문자열 · 라이브러리가 등록되지 않음
_NOT_INSTALLED = (-2147221164, -2147221005, -2147319779)


def _dispatch(progid: str):
    import win32com.client as win32

    try:
        return win32.DispatchEx(progid)
    except Exception as e:
        if getattr(e, "hresult", None) in _NOT_INSTALLED:
            raise NoApp(progid)
        raise


# ---------------------------------------------------------------- 한/글 --------
def _ensure_hwp_security() -> None:
    """한/글 보안승인모듈(FilePathChecker)을 HKCU 레지스트리에 선등록한다.

    없으면 한/글이 파일 입출력 때 팝업을 띄워 무인 변환이 멈춘다. pyhwpx 번들 DLL 을
    찾아 레지스트리 값만 써 둔다(이미 있으면 그대로). MCP 세션 코드와 같은 방식."""
    try:
        import winreg

        import pyhwpx

        dll = os.path.join(os.path.dirname(os.path.abspath(pyhwpx.__file__)),
                           "FilePathCheckerModule.dll")
        if not os.path.exists(dll):
            return
        for sub in (r"Software\HNC\HwpAutomation\Modules",
                    r"Software\Hnc\HwpUserAction\Modules"):
            try:
                key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, sub, 0, winreg.KEY_WRITE)
                winreg.SetValueEx(key, "FilePathCheckerModule", 0, winreg.REG_SZ, dll)
                winreg.CloseKey(key)
            except OSError:
                continue
    except Exception as e:  # 등록 실패해도 변환은 시도한다
        _err(f"[hwp] 보안모듈 등록 건너뜀: {e!r}")


def hwp_to_pdf(src: str, out: str) -> None:
    _ensure_hwp_security()
    try:
        from pyhwpx import Hwp
    except ModuleNotFoundError:
        raise
    except Exception as e:  # 한/글이 없으면 import 자체가 COM 형식 라이브러리를 찾다 실패한다
        raise NoApp(repr(e))

    hwp = Hwp(new=True, visible=False)
    try:
        if not hwp.open(src):
            raise RuntimeError(f"한/글 열기 실패: {src}")
        ok = hwp.save_as(out)  # 확장자 .pdf → 내부 PDF 액션
        if not ok or not os.path.exists(out):
            raise RuntimeError(f"PDF 저장 실패(반환={ok})")
    finally:
        try:
            hwp.clear()
        except Exception:
            pass
        try:
            hwp.quit()
        except Exception:
            pass


# --------------------------------------------------------------- 오피스 --------
def _office_to_pdf(src: str, out: str, ext: str) -> None:
    import pythoncom
    import win32com.client as win32

    pythoncom.CoInitialize()
    try:
        if ext in (".doc", ".docx", ".rtf", ".odt"):
            app = _dispatch("Word.Application")
            app.Visible = False
            app.DisplayAlerts = 0  # 안내 창이 떠서 무인 변환이 멈추지 않게
            app.AutomationSecurity = 3  # msoAutomationSecurityForceDisable — 미리보기용으로 여는 문서의 매크로는 절대 실행하지 않는다(P18)
            try:
                doc = app.Documents.Open(src, ReadOnly=True)
                doc.ExportAsFixedFormat(OutputFileName=out, ExportFormat=17)  # wdExportFormatPDF
                doc.Close(False)
            finally:
                app.Quit()
        elif ext in (".xls", ".xlsx", ".xlsm", ".ods"):
            app = _dispatch("Excel.Application")
            app.Visible = False
            app.DisplayAlerts = False
            app.AutomationSecurity = 3  # 매크로 실행 금지(P18)
            try:
                wb = app.Workbooks.Open(src, ReadOnly=True)
                wb.ExportAsFixedFormat(0, out)  # 0 = xlTypePDF, 시트 전체
                wb.Close(False)
            finally:
                app.Quit()
        elif ext in (".ppt", ".pptx", ".odp"):
            # 파워포인트는 하나만 뜬다 — DispatchEx 도 사용자가 쓰던 창에 붙는다. 그래서 아래에서 함부로 끄지 않는다.
            app = _dispatch("PowerPoint.Application")
            prev = None  # 사용자가 쓰던 창에 붙었을 수 있으니 매크로 설정은 끝나고 되돌린다
            try:
                prev = app.AutomationSecurity
                app.AutomationSecurity = 3  # 매크로 실행 금지(P18)
            except Exception:
                pass  # 아주 옛 판 파워포인트는 이 속성이 없을 수 있다 — 변환은 계속
            try:
                # msoTrue(-1)/msoFalse(0) — 차례: 파일, 읽기 전용, 제목 없음, 창
                pres = app.Presentations.Open(src, -1, 0, 0)
                try:
                    pres.SaveAs(out, 32)  # 32 = ppSaveAsPDF
                finally:
                    pres.Close()
            finally:
                # 화면에 보이거나(사용자가 쓰는 창) 열린 문서가 있으면 끄지 않는다
                try:
                    if prev is not None:
                        app.AutomationSecurity = prev
                    if app.Presentations.Count == 0 and not app.Visible:
                        app.Quit()
                except Exception:
                    pass
        else:
            raise RuntimeError(f"지원하지 않는 오피스 형식: {ext}")
    finally:
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass
    if not os.path.exists(out):
        raise RuntimeError("PDF가 생성되지 않았습니다.")


# ----------------------------------------------------------------- main --------
def main() -> int:
    if len(sys.argv) != 3:
        _err("사용법: python doc2pdf.py <원본> <PDF저장경로>")
        return 2
    src, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    if not os.path.exists(src):
        _err(f"원본을 찾을 수 없습니다: {src}")
        return 1
    _ensure_parent(out)
    ext = os.path.splitext(src)[1].lower()
    work = tempfile.mkdtemp(prefix="iris-doc-")
    try:
        copy = os.path.join(work, "doc" + ext)  # 짧은 영문 이름 — 긴 경로·특수문자에도 안전
        try:
            shutil.copyfile(src, copy)
        except PermissionError as e:
            _err(f"[LOCKED] {e!r}")
            return 1
        if ext in (".hwp", ".hwpx"):
            hwp_to_pdf(copy, out)
        else:
            _office_to_pdf(copy, out, ext)
    except ModuleNotFoundError as e:
        _err(f"[NOMODULE] {e!r}")
        return 3
    except NoApp as e:
        _err(f"[NOAPP] {e!r}")
        return 1
    except Exception as e:
        _err(f"변환 실패({ext}): {e!r}")
        return 1
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"OK {out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
