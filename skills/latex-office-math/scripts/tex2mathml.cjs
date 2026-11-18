// LaTeX → MathML (P18) — 표준 입력으로 JSON [{tex, display}] 를 받아 JSON [mathml|null] 을 낸다. KaTeX 동봉본(vendor) 만 쓴다(인터넷 없음).
// KaTeX 가 붙이는 <annotation>(원래 LaTeX)은 지운다 — 오피스 변환표가 그 글자를 수식 안에 그대로 넣어 버리기 때문.
const path = require('path');
const katex = require(path.join(__dirname, '..', 'vendor', 'katex.min.js'));
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const items = JSON.parse(input.replace(/^﻿/, '') || '[]'); // PowerShell 파이프가 붙이는 BOM 은 무시
  const out = items.map(({ tex, display }) => {
    try {
      const html = katex.renderToString(String(tex), { output: 'mathml', displayMode: !!display, throwOnError: true, strict: 'ignore' });
      const m = html.match(/<math[\s\S]*<\/math>/);
      return m ? m[0].replace(/<annotation[\s\S]*?<\/annotation>/g, '').replace(/<semantics>|<\/semantics>/g, '') : null;
    } catch { return null; }
  });
  process.stdout.write(JSON.stringify(out));
});
