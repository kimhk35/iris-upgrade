"""tests/safety_checks.py — 쓰기 안전장치 검사(P18 점검, 2026-11-11).

원본 덮어쓰기 거절 · 시스템 폴더 거절 · PDF_MCP_ROOTS 밖 거절 · 권한 암호 자동 생성 · AES 만 허용.
실행: python tests\\safety_checks.py   (임시 폴더만 씀)
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from pypdf import PdfReader, PdfWriter  # noqa: E402

from engine import assemble, secure  # noqa: E402
from engine.common import begin_call  # noqa: E402

ok_n = fail_n = 0


def ok(cond, name):
    global ok_n, fail_n
    if cond:
        ok_n += 1
        print(f"PASS {name}")
    else:
        fail_n += 1
        print(f"FAIL {name}")


def raises(fn, needle):
    try:
        fn()
    except ValueError as e:
        return needle in str(e)
    return False


tmp = tempfile.mkdtemp(prefix="pdf-safety-")
src = os.path.join(tmp, "원본.pdf")
w = PdfWriter()
for _ in range(3):
    w.add_blank_page(width=200, height=200)
with open(src, "wb") as f:
    w.write(f)
before = open(src, "rb").read()

begin_call()
ok(raises(lambda: assemble.pages_op(src, out_path=src, op="rotate", degrees=90), "원본 파일과 같습니다"), "원본과 같은 결과 경로 = 거절")
ok(open(src, "rb").read() == before, "거절된 뒤 원본 그대로")
begin_call()
ok(raises(lambda: assemble.pages_op(src, out_path=os.path.join(tmp, ".", "원본.pdf"), op="rotate", degrees=90), "원본 파일과 같습니다"), "다르게 적은 같은 경로도 거절")
begin_call()
r = assemble.pages_op(src, out_path=os.path.join(tmp, "회전.pdf"), op="rotate", degrees=90)
ok(os.path.isfile(r["out_path"]), "다른 이름이면 정상 저장")
begin_call()
ok(raises(lambda: assemble.pages_op(src, out_path=r"C:\Windows\Temp\iris-x.pdf", op="rotate", degrees=90), "시스템 폴더"), "시스템 폴더 = 거절")

os.environ["PDF_MCP_ROOTS"] = os.path.join(tmp, "허용")
begin_call()
ok(raises(lambda: assemble.pages_op(src, out_path=os.path.join(tmp, "밖.pdf"), op="rotate", degrees=90), "허용된 폴더"), "PDF_MCP_ROOTS 밖 = 거절")
begin_call()
r2 = assemble.pages_op(src, out_path=os.path.join(tmp, "허용", "안.pdf"), op="rotate", degrees=90)
ok(os.path.isfile(r2["out_path"]), "PDF_MCP_ROOTS 안 = 저장")
del os.environ["PDF_MCP_ROOTS"]

begin_call()
e1 = secure.encrypt(src, os.path.join(tmp, "잠금.pdf"), user_password="1234", allow_printing=False)
ok(e1.get("owner_password") and e1["owner_password"] != "1234", "인쇄 금지 + 권한 암호 생략 = 무작위 권한 암호 생성")
rd = PdfReader(e1["out_path"])
ok(rd.decrypt("1234") == 1 and rd.decrypt(e1["owner_password"]) == 2, "열람 암호=사용자, 생성 암호=권한(owner)")
begin_call()
e2 = secure.encrypt(src, os.path.join(tmp, "잠금2.pdf"), user_password="1234")
ok("owner_password" not in e2, "제한 없으면 예전처럼(권한 암호 생성 안 함)")
begin_call()
ok(raises(lambda: secure.encrypt(src, os.path.join(tmp, "약함.pdf"), user_password="1", algorithm="RC4-40"), "AES"), "RC4 = 거절")

print(f"\n{ok_n} PASS / {fail_n} FAIL")
sys.exit(1 if fail_n else 0)
