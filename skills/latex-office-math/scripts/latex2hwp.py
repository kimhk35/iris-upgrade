"""LaTeX → 한글(HWP) 수식 편집기 문법 번역기 (P18 IRIS 고도화, 2026-11-17).

한글 수식 편집기는 LaTeX 가 아니라 자기 문법을 쓴다(예: \\frac{a}{b} → {a} over {b}, \\sqrt{x} → sqrt {x}).
학교·연구에서 자주 쓰는 범위를 옮긴다: 분수·루트(n제곱근)·첨자·적분·합·곱·극한·그리스 문자·관계·화살표·집합 기호·
괄호(\\left \\right)·행렬(matrix/pmatrix/bmatrix/vmatrix)·cases·\\text·윗줄·벡터·모자·각도 등.
모르는 명령은 \\ 를 뗀 이름 그대로 두고 경고 목록에 담는다(한글이 아는 이름이면 그대로 맞고, 아니면 사람이 고친다).

쓰기:  from latex2hwp import to_hwp;  script, warnings = to_hwp(r"\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}")
명령줄: python latex2hwp.py "\\frac{1}{2}"
"""
from __future__ import annotations

import re
import sys

# 기호 → 한글 수식 낱말(앞뒤 빈칸을 붙여 이웃 글자와 붙지 않게 한다)
SYMBOLS = {
    # 그리스 문자(대문자는 한글 수식에서 대문자 낱말)
    **{g: g for g in "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega".split()},
    "varepsilon": "epsilon", "vartheta": "vartheta", "varphi": "varphi", "varpi": "varpi", "varrho": "varrho", "varsigma": "varsigma",
    **{G: G.upper() for G in "Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega".split()},
    # 연산·관계
    "cdot": "cdot", "times": "times", "div": "div", "pm": "+-", "mp": "-+", "ast": "*", "star": "star", "circ": "circ", "bullet": "bullet",
    "le": "<=", "leq": "<=", "ge": ">=", "geq": ">=", "ne": "!=", "neq": "!=", "approx": "approx", "equiv": "equiv", "sim": "sim", "simeq": "simeq",
    "cong": "cong", "propto": "propto", "ll": "<<", "gg": ">>", "doteq": "doteq",
    # 화살표
    "to": "->", "rightarrow": "->", "leftarrow": "<-", "leftrightarrow": "<->", "Rightarrow": "=>", "Leftarrow": "<=", "Leftrightarrow": "<=>",
    "iff": "<=>", "implies": "=>", "mapsto": "mapsto", "uparrow": "uparrow", "downarrow": "downarrow",
    # 집합·논리
    "in": "in", "notin": "notin", "ni": "owns", "subset": "subset", "supset": "supset", "subseteq": "subseteq", "supseteq": "supseteq",
    "cup": "cup", "cap": "cap", "emptyset": "emptyset", "varnothing": "emptyset", "forall": "forall", "exists": "exist", "neg": "lnot",
    "land": "wedge", "lor": "vee", "wedge": "wedge", "vee": "vee", "setminus": "setminus",
    # 기하·기타
    "angle": "angle", "triangle": "triangle", "perp": "bot", "parallel": "parallel", "therefore": "therefore", "because": "because",
    "infty": "inf", "partial": "partial", "nabla": "nabla", "prime": "prime", "degree": "deg", "hbar": "hbar", "ell": "ell",
    "cdots": "cdots", "ldots": "ldots", "dots": "ldots", "vdots": "vdots", "ddots": "ddots",
    # 큰 연산자·함수(한글이 바로체로 바꾼다)
    "int": "int", "iint": "dint", "iiint": "tint", "oint": "oint", "sum": "sum", "prod": "prod", "coprod": "coprod", "lim": "lim",
    "bigcup": "bigcup", "bigcap": "bigcap",
    **{f: f for f in "sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln exp max min sup inf det gcd lcm mod deg dim ker arg".split()},
    # 괄호 기호
    "{": "lbrace", "}": "rbrace", "lbrace": "lbrace", "rbrace": "rbrace", "langle": "langle", "rangle": "rangle", "lfloor": "lfloor", "rfloor": "rfloor",
    "lceil": "lceil", "rceil": "rceil", "|": "||", "vert": "|", "Vert": "||",
    # 빈칸
    ",": "`", ":": "`", ";": "~", "quad": "~~", "qquad": "~~~~", " ": "~", "!": "",
}
ACCENTS = {"overline": "bar", "bar": "bar", "vec": "vec", "hat": "hat", "widehat": "hat", "tilde": "tilde", "widetilde": "tilde", "dot": "dot", "ddot": "ddot",
           "underline": "under", "overrightarrow": "vec"}
FONTS = {"mathrm": "rm", "mathbf": "bold", "mathit": "it", "boldsymbol": "bold", "operatorname": "rm", "mathsf": "rm", "mathbb": "bold", "mathcal": "it"}
MATRIX = {"matrix": "matrix", "pmatrix": "pmatrix", "bmatrix": "bmatrix", "vmatrix": "dmatrix", "Vmatrix": "dmatrix", "smallmatrix": "matrix",
          "cases": "cases", "array": "matrix", "aligned": "matrix", "align": "matrix", "align*": "matrix", "gathered": "matrix", "split": "matrix"}


class _Parser:
    def __init__(self, s: str):
        self.s, self.i, self.warn = s, 0, []

    def peek(self):
        return self.s[self.i] if self.i < len(self.s) else ""

    def group(self) -> str:
        """다음 한 덩어리(중괄호 묶음 · 명령 하나 · 글자 하나)를 번역해 돌려준다."""
        self.skip_space()
        c = self.peek()
        if c == "{":
            self.i += 1
            out = self.seq(stop="}")
            self.i += 1
            return "{" + out + "}"
        if c == "\\":
            return "{" + self.command() + "}"
        if c:
            self.i += 1
            return "{" + c + "}"  # 글자 하나도 묶는다 — x^12 를 ^{1}2 로(묶지 않으면 한글이 ^12 로 읽을 수 있다)
        return "{}"

    def opt(self) -> str | None:
        """[n] 같은 선택 인자"""
        self.skip_space()
        if self.peek() != "[":
            return None
        j = self.s.find("]", self.i)
        if j < 0:
            return None
        inner = self.s[self.i + 1:j]
        self.i = j + 1
        return to_hwp(inner, _warn=self.warn)[0]

    def skip_space(self):
        while self.peek() in (" ", "\t", "\n"):
            self.i += 1

    def name(self) -> str:
        """\\ 다음 명령 이름(글자 여럿 또는 기호 하나)"""
        self.i += 1
        m = re.match(r"[A-Za-z]+\*?", self.s[self.i:])
        if m:
            self.i += len(m.group(0))
            return m.group(0)
        c = self.peek(); self.i += 1
        return c

    def env(self, which: str) -> str:
        """\\begin{…} … \\end{…} — 줄(\\\\)은 #, 칸(&)은 & 로"""
        end = "\\end{" + which + "}"
        j = self.s.find(end, self.i)
        body = self.s[self.i:j if j >= 0 else len(self.s)]
        self.i = (j + len(end)) if j >= 0 else len(self.s)
        if which == "array":
            body = re.sub(r"^\s*\{[^}]*\}", "", body)  # 열 맞춤 표시 {cc} 는 버림
        rows = [r for r in re.split(r"\\\\", body)]
        # 한글은 칸 사이를 거의 띄우지 않는다(1 2, -x x<0 처럼 붙어 보임, 2026-11-17 실측) — 칸 사이에 작은 빈칸(~)을 넣는다
        gap = " &~~~ " if which == "cases" else " ~&~ "
        cells = [gap.join(to_hwp(c.strip(), _warn=self.warn)[0] for c in r.split("&")) for r in rows if r.strip()]
        return f"{MATRIX.get(which, 'matrix')}{{{' # '.join(cells)}}}"

    def command(self) -> str:
        n = self.name()
        if n == "frac" or n == "dfrac" or n == "tfrac":
            a = self.group(); b = self.group()
            return f"{a} over {b}"
        if n == "binom":
            a = self.group(); b = self.group()
            return f"left ( matrix{{{a[1:-1] if a.startswith('{') else a} # {b[1:-1] if b.startswith('{') else b}}} right )"
        if n == "sqrt":
            k = self.opt(); x = self.group()
            return f"root {{{k}}} of {x}" if k else f"sqrt {x}"
        if n in ACCENTS:
            return f"{ACCENTS[n]}{self.group()}"
        if n in FONTS:
            return f"{FONTS[n]}{self.group()}"
        if n == "text" or n == "textrm" or n == "mbox" or n == "textbf":
            self.skip_space()
            if self.peek() == "{":
                j, depth = self.i + 1, 1
                while j < len(self.s) and depth:
                    depth += {"{": 1, "}": -1}.get(self.s[j], 0); j += 1
                txt = self.s[self.i + 1:j - 1]; self.i = j
                return '"' + txt.replace('"', "'") + '"'
            return ""
        if n == "left" or n == "right" or n in ("bigl", "bigr", "Bigl", "Bigr", "big", "Big", "biggl", "biggr"):
            self.skip_space()
            c = self.peek()
            if c == "\\":
                d = self.name(); d = SYMBOLS.get(d, d)
            else:
                self.i += 1; d = c
            d = {"{": "lbrace", "}": "rbrace", ".": "", "(": "(", ")": ")", "[": "[", "]": "]", "|": "|"}.get(d, d)
            kw = "left" if n in ("left", "bigl", "Bigl", "biggl") else "right" if n in ("right", "bigr", "Bigr", "biggr") else ""
            return f"{kw} {d}".strip() if kw else d
        if n == "begin":
            self.skip_space()
            j = self.s.find("}", self.i); which = self.s[self.i + 1:j]; self.i = j + 1
            return self.env(which)
        if n in ("displaystyle", "textstyle", "limits", "nolimits", "notag", "nonumber", "label", "tag"):
            if n in ("label", "tag"):
                self.group()
            return ""
        if n in SYMBOLS:
            return SYMBOLS[n]
        self.warn.append("\\" + n)
        return n

    def seq(self, stop: str = "") -> str:
        out = []
        while self.i < len(self.s):
            c = self.peek()
            if stop and c == stop:
                break
            if c == "\\":
                out.append(" " + self.command() + " ")
            elif c == "{":
                out.append(self.group())
            elif c in "^_":
                self.i += 1
                out.append(f" {c}{self.group()} ")
            elif c == "~":
                self.i += 1; out.append(" ~ ")
            elif c == "&":
                self.i += 1; out.append(" & ")
            else:
                self.i += 1; out.append(c)
        return "".join(out)


def to_hwp(latex: str, _warn: list | None = None) -> tuple[str, list[str]]:
    """LaTeX 한 덩어리 → (한글 수식 문장, 모르는 명령 목록)"""
    p = _Parser(str(latex).strip())
    if _warn is not None:
        p.warn = _warn
    out = p.seq()
    out = re.sub(r"\s+", " ", out).strip()
    out = re.sub(r"\{\s+", "{", out); out = re.sub(r"\s+\}", "}", out)
    return out, sorted(set(p.warn))


if __name__ == "__main__":
    s, w = to_hwp(sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read())
    print(s)
    if w:
        print("모르는 명령:", ", ".join(w), file=sys.stderr)
