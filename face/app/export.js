// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 대화 내보내기(P18 2026-11-24 2차 시안 4번): 머리줄 단추 → 한글·워드·HTML 로 「다운로드」 폴더에 저장.
   질문과 답만(AI 가 일한 과정 뺌), 이름·번호 가리기 선택(privacy.js 와 같은 규칙). HTML 은 스크립트·바깥 연결 없이 한 파일. */
window.ChatExport = (() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let box = null, btn = null, opts = {}, fmt = 'hwpx', hide = true, busy = false, pairs = [];
  const isOpen = () => !!box && !box.hidden;
  /** 질문과 답만: 한 차례에서 마지막 답 + 긴 보고(300자 이상)는 남기고 짧은 중간 말은 뺀다. */
  function pick(items) {
    const out = []; let turn = [];
    const flush = () => { turn.forEach((x, i) => { if (i === turn.length - 1 || x.text.trim().length >= 300) out.push({ who: 'ai', text: x.text }); }); turn = []; };
    for (const it of items) { if (it.kind === 'user') { flush(); out.push({ who: 'me', text: it.text }); } else if (it.kind === 'assistant' && it.text?.trim()) turn.push(it); }
    flush(); return out;
  }
  /** 마크다운 → 안전한 HTML. 수식은 LaTeX 글로($…$), 그림·틀·스크립트·바깥 연결은 뺀다. */
  function body(text) {
    // 수식은 그리기 전에 빼 두었다가 LaTeX 글 그대로 되돌린다(그린 수식은 한글·워드에서 x² 가 x2 로 무너진다)
    const tex = []; const src = String(text).replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?=[^\s$])[^$\n]*?[^\s$]\$(?!\d)|\$[^\s$]\$(?!\d)/g, (m) => `\ue000${tex.push(m) - 1}\ue001`);
    const md = Transcript.md(src).replace(/\ue000(\d+)\ue001/g, (_, k) => esc(tex[+k]));
    const d = new DOMParser().parseFromString(`<div>${md}</div>`, 'text/html').body.firstChild;
    for (const x of d.querySelectorAll('script, style, iframe, img, svg, button, link, object, embed, form, input, video, audio')) x.remove();
    for (const x of d.querySelectorAll('*')) for (const a of [...x.attributes]) if (!(['colspan', 'rowspan'].includes(a.name) || (a.name === 'href' && /^https?:\/\//i.test(a.value)))) x.removeAttribute(a.name);
    return d.innerHTML;
  }
  function html(title, list, when) {
    const students = new Map(); const safe = (t) => (hide ? PrivacyCheck.mask(t, PrivacyCheck.scan(t, students), { students }) : t);
    if (hide) for (const p of list) PrivacyCheck.scan(p.text, students); // 이름표를 먼저 모아 앞뒤 글이 같은 [학생N] 이 되게
    const st = 'body{font-family:"맑은 고딕","Malgun Gothic",sans-serif;font-size:11pt;line-height:1.7;color:#222;max-width:760px;margin:30px auto;padding:0 16px}h1{font-size:19pt;margin:0 0 4px}.w{color:#777;font-size:9.5pt;margin:0 0 18px}h2{font-size:11pt;margin:20px 0 4px;color:#2f4f9d}pre{background:#f3f3f1;padding:10px;white-space:pre-wrap;font-size:9.5pt}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}blockquote{margin:0;padding-left:12px;border-left:3px solid #ccc;color:#555}';
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>${esc(safe(title))}</title><style>${st}</style></head><body><h1>${esc(safe(title))}</h1><p class="w">${esc(when)} · IRIS 대화</p>${list.map((p) => `<h2>${p.who === 'me' ? '나' : 'AI'}</h2>${body(safe(p.text))}`).join('\n')}</body></html>`;
  }
  async function save() {
    const s = opts.current(); if (!s || busy) return; busy = true; draw();
    try {
      const r = await fetch('/api/export', { method: 'POST', headers: { 'content-type': 'application/json', ...(opts.headers?.() || {}) }, body: JSON.stringify({ title: hide ? PrivacyCheck.mask(s.title || '대화') : s.title || '대화', format: fmt, html: html(s.title || '대화', pairs, new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })) }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || '저장하지 못했어요.');
      close(); const yes = await Dialog.confirm(`${j.note ? `${j.note}\n\n` : ''}다운로드 폴더에 저장했어요.\n${j.name}`, { okLabel: '열기', cancelLabel: '닫기' });
      if (yes) await fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: j.path }) });
    } catch (e) { Dialog.alert(e.message); } finally { busy = false; if (isOpen()) draw(); }
  }
  function draw() {
    const sample = pairs.slice(0, 2).map((p) => { const t = p.text.replace(/\s+/g, ' ').slice(0, 110); return `<p><b>${p.who === 'me' ? '나' : 'AI'}</b> ${esc(hide ? PrivacyCheck.mask(t) : t)}</p>`; }).join('');
    const n = pairs.length;
    box.innerHTML = `<div class="tl-head"><b>대화 내보내기</b><span class="cv-sp"></span><button type="button" class="icon-btn small" data-x="close" title="닫기 (Esc)">✕</button></div>
      <div class="tl-chips">${[['hwpx', '한글'], ['docx', '워드'], ['html', 'HTML']].map(([k, t]) => `<button type="button" class="cv-chip${fmt === k ? ' on' : ''}" data-f="${k}">${t}</button>`).join('')}<span class="cv-sp"></span><label class="ex-hide"><input type="checkbox"${hide ? ' checked' : ''}> 이름·번호 가리기</label></div>
      <div class="ex-prev">${n ? sample : '<p>내보낼 질문과 답이 없어요.</p>'}</div><p class="ex-note">질문과 답 ${n}개 · AI가 일한 과정과 그림은 빼요. 이름만 적힌 글은 가리지 못할 수 있어요.</p>
      <div class="tl-foot"><span class="cv-sp"></span><button type="button" class="text-btn accent" data-x="save"${!n || busy ? ' disabled' : ''}>${busy ? '만드는 중…' : '다운로드 폴더에 저장'}</button></div>`;
    const r = btn.getBoundingClientRect(); box.style.top = `${Math.round(r.bottom + 8)}px`; box.style.left = `${Math.round(Math.max(12, Math.min(innerWidth - box.offsetWidth - 12, r.right - box.offsetWidth)))}px`;
  }
  async function open() {
    const s = opts.current(); if (!s) return;
    if (!box) {
      box = document.createElement('div'); box.id = 'ex-pop'; box.className = 'tl-pop ex-pop'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '대화 내보내기'); document.body.appendChild(box);
      box.addEventListener('click', (e) => { const f = e.target.closest('[data-f]'); if (f) { fmt = f.dataset.f; return draw(); } const b = e.target.closest('[data-x]'); if (b) b.dataset.x === 'save' ? save() : close(); });
      box.addEventListener('change', (e) => { if (e.target.matches('input')) { hide = e.target.checked; draw(); } });
      document.addEventListener('pointerdown', (e) => { if (isOpen() && !busy && !e.target.closest('#ex-pop, #btn-more, .mnu-pop, #dlg')) close(); });
    }
    let items = []; try { items = (await (await fetch(`/api/sessions/${s.id}/transcript`, { headers: opts.headers?.() || {} })).json()).items || []; } catch {}
    if (opts.current()?.id !== s.id) return;
    pairs = pick(items); box.hidden = false; draw(); box.querySelector('[data-x=save]').focus();
  }
  function close() { if (!isOpen() || busy) return false; box.hidden = true; return true; }
  function init(o) { opts = o; btn = $('#btn-more') || $('#btn-export'); $('#btn-export')?.addEventListener('click', () => (isOpen() ? close() : open())); }
  return { init, open, close, isOpen, _pick: pick, _html: (t, l, h) => { hide = h; return html(t, l, '시험'); } };
})();
