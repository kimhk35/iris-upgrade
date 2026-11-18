"""latex2hwp 번역 검사 — python -I tests\\test_latex2hwp.py"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from latex2hwp import to_hwp  # noqa: E402

CASES = [
    (r"\frac{a}{b}", "{a} over {b}"),
    (r"x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}", "x = {-b +- sqrt {b ^{2} -4ac}} over {2a}"),
    (r"\sqrt[3]{x}", "root {3} of {x}"),
    (r"\int_0^1 x^2\,dx = \frac{1}{3}", "int _{0} ^{1} x ^{2} ` dx = {1} over {3}"),
    (r"\sum_{k=1}^{n} k = \frac{n(n+1)}{2}", "sum _{k=1} ^{n} k = {n(n+1)} over {2}"),
    (r"\lim_{x \to 0} \frac{\sin x}{x} = 1", "lim _{x -> 0} {sin x} over {x} = 1"),
    (r"\alpha + \beta = \Gamma", "alpha + beta = GAMMA"),
    (r"a \le b \ne c \ge d", "a <= b != c >= d"),
    (r"\left( \frac{1}{2} \right)", "left ( {1} over {2} right )"),
    (r"\left\{ x \right\}", "left lbrace x right rbrace"),
    (r"\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}", "pmatrix{1 ~&~ 2 # 3 ~&~ 4}"),
    (r"f(x)=\begin{cases} x & x \ge 0 \\ -x & x<0 \end{cases}", "f(x)=cases{x &~~~ x >= 0 # -x &~~~ x<0}"),
    (r"\overline{AB} \perp \vec{v}", "bar{AB} bot vec{v}"),
    (r"\angle ABC = 90^\circ", "angle ABC = 90 ^{circ}"),
    (r"\text{넓이} = \pi r^2", '"넓이" = pi r ^{2}'),
    (r"A \cup B \subseteq C", "A cup B subseteq C"),
    (r"\therefore x = 3", "therefore x = 3"),
]
CASES += [
    (r"x^12", "x ^{1} 2"),          # LaTeX 는 첨자 한 글자만 — 한글에서도 1 만 위로
    (r"e^{i\pi}+1=0", "e ^{i pi} +1=0"),
]
sq = lambda s: "".join(s.split())  # 빈칸 차이는 한글에서 뜻이 같으므로 무시하고 비교
ok = bad = 0
for src, want in CASES:
    got, warn = to_hwp(src)
    if sq(got) == sq(want) and not warn:
        ok += 1; print("PASS", src)
    else:
        bad += 1; print(f"FAIL {src}\n     want: {want}\n     got:  {got}  warn={warn}")
got, warn = to_hwp(r"\foo{x}")
if warn == ["\\foo"]:
    ok += 1; print("PASS 모르는 명령은 경고 목록에")
else:
    bad += 1; print("FAIL 모르는 명령 경고", warn)
print(f"\n{ok} PASS / {bad} FAIL")
sys.exit(1 if bad else 0)
