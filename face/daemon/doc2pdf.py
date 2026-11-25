# IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
# -*- coding: utf-8 -*-
"""
doc2pdf.py — 문서(한/글·워드·엑셀·파워포인트)를 PDF로 변환한다.

IRIS-Face 데몬이 부르는 독립 실행 스크립트. 대화 안에 문서를 삽입하려고 원본을 PDF로
한 번 바꿔 캐시에 둔다. 원본은 절대 건드리지 않는다(읽기 전용으로 열고 새 PDF만 만든다).

사용:  python doc2pdf.py <원본경로> <PDF저장경로>
성공:  종료코드 0 + stdout 마지막 줄 "OK <PDF경로>"
실패:  종료코드 1 + stderr 에 사유([NOAPP] = 그 프로그램 없음, [LOCKED] = 파일이 잠김, [PASSWORD] = 암호 문서, [EMPTY] = 빈 엑셀)
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


class Locked(RuntimeError):
    """암호가 걸린 문서. 열면 숨은 암호 창에서 멈추고, 그 뒤의 문서까지 막힌다(P18 2026-11-25 점검)."""


class Empty(RuntimeError):
    """인쇄할 것이 없는 엑셀."""


def encrypted(path: str, ext: str) -> bool:
    """암호 문서인가 — 프로그램을 띄우기 전에 파일 머리만 보고 안다. 모르면 아니라고 본다."""
    try:
        if os.path.getsize(path) > 300 * 1024 * 1024:
            return False
        with open(path, "rb") as f:
            d = f.read()
        ole = d[:4] == b"\xd0\xcf\x11\xe0"
        if ext == ".hwpx":
            import zipfile

            with zipfile.ZipFile(path) as z:
                return b"encryption-data" in z.read("META-INF/manifest.xml")
        if not ole:
            return False
        if "EncryptedPackage".encode("utf-16-le") in d:  # 새 형식(docx·xlsx·pptx)의 암호
            return True
        if ext == ".hwp":
            i = d.find(b"HWP Document File")
            return i >= 0 and bool(int.from_bytes(d[i + 36:i + 40], "little") & 2)
        for at in range(512, min(len(d), 64 * 1024 * 1024), 512):
            if ext in (".doc", ".rtf") and d[at:at + 4] == b"\xec\xa5\xc1\x00":
                return bool(int.from_bytes(d[at + 10:at + 12], "little") & 0x0100)
            if ext == ".xls" and d[at:at + 8] == b"\x09\x08\x10\x00\x00\x06\x05\x00":
                return d[at + 20:at + 22] == b"\x2f\x00"
        return ext == ".ppt" and b"\xdf\xc4\xd1\xf3" in d
    except Exception:
        return False


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


def _pids(exe: str) -> set:
    """지금 떠 있는 그 프로그램의 번호들. 모르면 None. (tasklist 는 느린 PC 에서 2초씩 걸려 윈도에 바로 묻는다)"""
    try:
        import ctypes
        from ctypes import wintypes as w

        class Entry(ctypes.Structure):
            _fields_ = [("dwSize", w.DWORD), ("cntUsage", w.DWORD), ("pid", w.DWORD), ("heap", ctypes.c_size_t), ("mod", w.DWORD),
                        ("threads", w.DWORD), ("ppid", w.DWORD), ("pri", w.LONG), ("flags", w.DWORD), ("exe", w.WCHAR * 260)]

        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.CreateToolhelp32Snapshot.restype = w.HANDLE
        k.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
        k.Process32FirstW.argtypes = k.Process32NextW.argtypes = [w.HANDLE, ctypes.POINTER(Entry)]
        k.CloseHandle.argtypes = [w.HANDLE]
        h = k.CreateToolhelp32Snapshot(2, 0)
        if h in (None, w.HANDLE(-1).value):
            return None
        try:
            e, out = Entry(), set()
            e.dwSize = ctypes.sizeof(Entry)
            go = k.Process32FirstW(h, ctypes.byref(e))
            while go:
                if e.exe.lower() == exe.lower():
                    out.add(int(e.pid))
                go = k.Process32NextW(h, ctypes.byref(e))
            return out
        finally:
            k.CloseHandle(h)
    except Exception:
        return None


def _shown(pids: set) -> bool:
    """그 프로그램들 가운데 화면에 보이는 창을 가진 것이 있나(= 사용자가 쓰는 중). 모르면 그렇다고 본다."""
    try:
        import win32gui
        import win32process

        hit = []

        def cb(h, _):
            if win32gui.IsWindowVisible(h) and win32process.GetWindowThreadProcessId(h)[1] in pids:
                hit.append(h)

        win32gui.EnumWindows(cb, None)
        return bool(hit)
    except Exception:
        return True


# 우리가 띄운 숨은 프로그램의 번호 + 시작 시각. 도중에 이 파이썬이 끊기면 다음 변환이 이것만 보고 치운다(남의 프로그램은 건드리지 않는다).
OWN = os.path.join(tempfile.gettempdir(), "iris-doc-own.json")


def _born(pid: int) -> str:
    """그 번호 프로그램의 시작 시각(번호가 다시 쓰였는지 가리려고). 없으면 빈 글자."""
    try:
        import win32api
        import win32process

        h = win32api.OpenProcess(0x1000, False, pid)
        try:
            if win32process.GetExitCodeProcess(h) != 259:  # STILL_ACTIVE
                return ""
            return str(win32process.GetProcessTimes(h)["CreationTime"])
        finally:
            win32api.CloseHandle(h)
    except Exception:
        return ""


def _kill(pids) -> None:
    """화면에 보이지 않는 것만, 번호로만 끈다."""
    import subprocess

    for p in pids:
        if not _shown({p}):
            subprocess.run(["taskkill", "/PID", str(p), "/T", "/F"], capture_output=True, creationflags=0x08000000)


def _claim(pids: set) -> None:
    import json

    try:
        with open(OWN, "w", encoding="utf-8") as f:
            json.dump({str(p): _born(p) for p in pids}, f)
    except Exception:
        pass


def _sweep() -> None:
    """지난 변환이 끊기며 남긴 숨은 프로그램 치우기 — 번호와 시작 시각이 모두 같을 때만."""
    import json

    try:
        with open(OWN, encoding="utf-8") as f:
            old = json.load(f)
        _kill([int(p) for p, born in old.items() if born and _born(int(p)) == born])
    except Exception:
        pass
    try:
        os.remove(OWN)
    except Exception:
        pass


class _Mine:
    """프로그램을 띄우기 앞뒤로 감싼다: 새로 뜬 번호 = 우리 것. 멈추면 2분 뒤 그것만 끈다."""

    def __init__(self, exe: str):
        self.exe = exe
        self.before = _pids(exe)
        self.pids: set = set()
        self.timer = None

    def started(self) -> None:
        now = _pids(self.exe)
        new = now - self.before if now is not None and self.before is not None else set()
        self.pids = new if len(new) == 1 else set()  # 하나로 딱 떨어질 때만 우리 것 — 같은 때 다른 프로그램이 띄운 것과 헷갈리지 않게
        if self.pids and self.exe not in ("POWERPNT.EXE", "HShow.exe"):  # 이 둘은 하나만 떠서 다른 프로그램과 나눠 쓸 수 있다 — 나중에 치우지 않는다
            _claim(self.pids)
        if self.timer is None:
            self.timer = _watchdog(self)

    def done(self) -> None:
        """여기서 기다리지 않는다 — 이 파이썬이 끝나며 참조를 놓으면 프로그램이 스스로 닫힌다. 그래도 남으면 다음 변환이 OWN 을 보고 치운다."""
        if self.timer:
            self.timer.cancel()


def _watchdog(mine, seconds: int = 120):
    """이 변환이 띄운 프로그램이 멈추면 그 번호만 끄고 끝낸다(숨은 프로그램이 남지 않게)."""
    import threading

    def stop():
        _kill(mine.pids)
        _err("[TIMEOUT] 프로그램이 멈춤")
        os._exit(1)

    t = threading.Timer(seconds, stop)
    t.daemon = True
    t.start()
    return t


def _office_or_hancom(ms: str, hc: str, exe: str):
    """오피스가 없으면 한컴(한쇼·한셀)으로 → (앱, 한컴인가, 이미 떠 있었나). 둘 다 없으면 NoApp. (P18 2026-11-24 고도화 13번)"""
    if os.environ.get("IRIS_DOC_HANCOM") != "1":  # 시험용: 1 이면 오피스를 건너뛴다
        try:
            return _dispatch(ms), False, False
        except NoApp:
            pass
    import time

    before = _pids(exe)
    for _ in range(20):  # 앞 변환이 쓰던 숨은 프로그램이 꺼지는 중이면 기다린다(거기 붙으면 같이 멈춘다)
        if not before or _shown(before):
            break
        time.sleep(0.5)
        before = _pids(exe)
    was = before is None or bool(before and _shown(before))  # 화면에 보이는 창 = 사용자가 쓰는 중
    app = _dispatch(hc)
    if not was:  # 우리가 띄운 것: 확인 창에 저절로 「확인」(사본을 읽기 전용으로 열 뿐이다)
        try:
            app.SetMessageBoxMode(0x111111)
        except Exception:
            pass
    return app, True, was


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

    mine = _Mine("Hwp.exe")
    mine.started()  # 띄우다 멈춰도 2분 뒤 끝나게
    hwp = Hwp(new=True, visible=False)
    mine.started()
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
        mine.done()


# --------------------------------------------------------------- 오피스 --------
def _fit_sheets(app, wb) -> None:
    """엑셀 사본을 보기 좋게: 종이보다 넓은 시트는 가로로 눕혀 폭을 한 쪽에 맞춘다(안 맞추면 열이 여러 쪽으로 쪼개진다, P18 2026-11-25 점검).
    사람이 이미 「한 쪽에 맞춤」을 정했거나 인쇄 영역을 둔 시트는 그대로 둔다. 실패해도 변환은 계속한다."""
    seen = 0
    for ws in wb.Worksheets:
        try:
            if ws.Visible != -1:  # 숨긴 시트는 어차피 안 나온다
                continue
            used = ws.UsedRange
            filled = app.WorksheetFunction.CountA(used) > 0 or ws.Shapes.Count > 0
            seen += bool(filled)
            if not filled:
                continue
            right = used.Left + used.Width
            for k in range(1, min(ws.Shapes.Count, 40) + 1):
                sh = ws.Shapes(k)
                right = max(right, sh.Left + sh.Width)
            ps = ws.PageSetup
            if used.Borders.LineStyle == -4142:  # 테두리가 하나도 없는 표 = 눈금선을 보여 준다
                ps.PrintGridlines = True
            if ps.Zoom is False or ps.PrintArea:
                continue
            page = 842 if ps.Orientation == 2 else 595
            if right <= page - ps.LeftMargin - ps.RightMargin:
                continue
            ps.Orientation = 2
            if right > 1500:
                try:
                    ps.PaperSize = 8  # A3
                except Exception:
                    pass
            ps.LeftMargin = ps.RightMargin = 18
            ps.TopMargin = ps.BottomMargin = 24
            ps.Zoom = False
            ps.FitToPagesWide = 1
            ps.FitToPagesTall = False
        except Exception as e:
            _err(f"[excel] 폭 맞추기 건너뜀: {e!r}")
            seen += 1
    if not seen and wb.Charts.Count == 0:
        raise Empty()


def _office_to_pdf(src: str, out: str, ext: str) -> None:
    import pythoncom
    import win32com.client as win32

    pythoncom.CoInitialize()
    kind = "WINWORD.EXE" if ext in (".doc", ".docx", ".rtf", ".odt") else "EXCEL.EXE" if ext in (".xls", ".xlsx", ".xlsm", ".ods") else "POWERPNT.EXE"
    # 오피스가 없는 PC 는 한셀·한쇼가 뜬다 — 그쪽도 함께 본다
    mines = [_Mine(x) for x in ((kind,) if kind == "WINWORD.EXE" else (kind, "HCell.exe" if kind == "EXCEL.EXE" else "HShow.exe"))]

    def started():
        for m in mines:
            m.started()

    started()
    try:
        if ext in (".doc", ".docx", ".rtf", ".odt"):
            app = _dispatch("Word.Application")
            started()
            app.Visible = False
            app.DisplayAlerts = 0  # 안내 창이 떠서 무인 변환이 멈추지 않게
            app.AutomationSecurity = 3  # msoAutomationSecurityForceDisable — 미리보기용으로 여는 문서의 매크로는 절대 실행하지 않는다(P18)
            try:
                doc = app.Documents.Open(src, ReadOnly=True, PasswordDocument="?")  # 암호 창 대신 바로 오류
                doc.ExportAsFixedFormat(OutputFileName=out, ExportFormat=17)  # wdExportFormatPDF
                doc.Close(False)
            finally:
                app.Quit()
        elif ext in (".xls", ".xlsx", ".xlsm", ".ods"):
            app, hancom, was = _office_or_hancom("Excel.Application", "HCell.Application", "HCell.exe")
            started()
            try:
                app.Visible = False
                app.DisplayAlerts = False
                app.AutomationSecurity = 3  # 매크로 실행 금지(P18)
            except Exception:
                if not hancom:
                    app.Quit()
                    raise  # 엑셀에서는 매크로를 막지 못하면 열지 않는다
            try:
                wb = app.Workbooks.Open(src) if hancom else app.Workbooks.Open(src, ReadOnly=True, Password="?")
                try:
                    if not hancom:
                        _fit_sheets(app, wb)
                    wb.ExportAsFixedFormat(0, out)  # 0 = xlTypePDF, 시트 전체
                finally:
                    wb.Close(False)
            finally:
                if not (hancom and was):
                    app.Quit()
        elif ext in (".ppt", ".pptx", ".odp"):
            # 파워포인트는 하나만 뜬다 — DispatchEx 도 사용자가 쓰던 창에 붙는다. 그래서 아래에서 함부로 끄지 않는다.
            app, hancom, was = _office_or_hancom("PowerPoint.Application", "HShow.Application", "HShow.exe")
            started()
            prev = None  # 사용자가 쓰던 창에 붙었을 수 있으니 매크로 설정은 끝나고 되돌린다
            try:
                prev = app.AutomationSecurity
                app.AutomationSecurity = 3  # 매크로 실행 금지(P18)
            except Exception:
                pass  # 아주 옛 판 파워포인트·한쇼는 이 속성이 없을 수 있다 — 변환은 계속
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
                    if app.Presentations.Count == 0 and not (was if hancom else app.Visible):
                        app.Quit()
                except Exception:
                    pass
        else:
            raise RuntimeError(f"지원하지 않는 오피스 형식: {ext}")
    finally:
        for m in mines:
            m.done()
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
        if encrypted(copy, ext):
            raise Locked()
        _sweep()
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
    except Locked:
        _err("[PASSWORD] 암호 문서")
        return 1
    except Empty:
        _err("[EMPTY] 빈 문서")
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
