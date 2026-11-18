"""hwp_math 실제 시험 — 한글로 시험 문서를 임시 폴더에 만들고 바꾼 뒤 HWPX 속 수식을 확인한다(한글 설치 PC 만).
python tests\\test_hwp_math.py"""
import os, re, sys, tempfile, zipfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from hwp_math import convert, spans  # noqa: E402

ok = bad = 0
def check(c, n):
    global ok, bad
    ok, bad = (ok + 1, bad) if c else (ok, bad + 1)
    print(("PASS " if c else "FAIL ") + n)

check([s[1] for s in spans("가격 $5 와 $3, 근 $x=1$ 과 $$\\frac{1}{2}$$")] == ["x=1", "\\frac{1}{2}"], "자리 찾기: 돈 표기 제외 · 가운데 수식")
check([s[1] for s in spans("극한은 $\\lim x = 1$입니다. 값 $y$는 $5짜리와 $3짜리")] == ["\\lim x = 1", "y"], "한글 조사가 바로 붙어도 수식 · 돈 표기는 그대로")
check([s[2] for s in spans("2. 정적분: $$a$$\n$$b$$")] == [False, True], "가운데 정렬은 $$ 가 줄에 혼자일 때만")

tmp = tempfile.mkdtemp(prefix="hwpmath-")
src = os.path.join(tmp, "시험.hwpx")
from pyhwpx import Hwp
h = Hwp(new=True, visible=False)
try:
    h.insert_text("근의 공식은 $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$ 입니다. 가격은 $5 입니다.")
    h.BreakPara()
    h.insert_text("$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$")
    h.save_as(src, "HWPX")
finally:
    try: h.clear(1); h.quit()
    except Exception: pass

before = open(src, "rb").read()
r = convert(src)
check(r["converted"] == 2 and not r["missed"], f"수식 2개 바꿈 (바꿈 {r['converted']}, 못 찾음 {r['missed']})")
check(open(src, "rb").read() == before, "원본은 그대로")
xml = zipfile.ZipFile(r["out"]).read("Contents/section0.xml").decode("utf-8")
eqs = re.findall(r'<hp:equation.*?<hp:sz width="(\d+)"[^>]*height="(\d+)".*?<hp:script>(.*?)</hp:script>', xml, re.S)
check(len(eqs) == 2, f"결과 문서에 한글 수식 2개 ({len(eqs)})")
check(all(int(w) > 2000 and int(hh) > 500 for w, hh, _ in eqs), f"수식 크기는 한글이 계산 ({[(w, hh) for w, hh, _ in eqs]})")
check("over" in eqs[0][2] and "sqrt" in eqs[0][2] and "int" in eqs[1][2], "수식 내용 = 번역된 한글 수식")
plain = re.sub(r"<[^>]+>", "", re.sub(r"<hp:equation.*?</hp:equation>", "", xml, flags=re.S))
check("$5" in plain and "\\frac" not in plain and "\\int" not in plain, "돈 표기($5)는 글자 그대로 · LaTeX 글자는 남지 않음")  # 한글 자동 고침이 '$5 입니다'의 빈칸을 뺄 수 있어 빈칸은 보지 않는다
check('horizontal="CENTER"' in zipfile.ZipFile(r["out"]).read("Contents/header.xml").decode("utf-8"), "$$ 문단 = 가운데 정렬 모양이 생김")
import shutil
shutil.rmtree(tmp, ignore_errors=True)  # 시험 문서·결과는 남기지 않는다
print(f"\n{ok} PASS / {bad} FAIL")
sys.exit(1 if bad else 0)
