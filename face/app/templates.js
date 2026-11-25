// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 자주 쓰는 요청 서식함(P18 2026-11-24 2차 시안 3번): 입력창 옆 단추 → 서식을 고르고 빈칸({이름})을 채워 입력창에 넣는다. 보내기는 사용자.
   저장 = 데몬 state\templates.json(이 PC 에만). 고치기 · 지우기 · 지금 글을 서식으로. */
window.Templates = (() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const BLANK = /\{([^{}\r\n]{1,24})\}/g;
  let box = null, list = [], k = 0, edit = null, vals = {}, composer = null, btn = null;
  const isOpen = () => !!box && !box.hidden;
  const blanks = (t) => [...new Set([...String(t).matchAll(BLANK)].map((m) => m[1].trim()))].filter(Boolean);
  const filled = (t) => String(t).replace(BLANK, (m, n) => vals[n.trim()]?.trim() || m);
  async function load() { try { list = (await (await fetch('/api/templates')).json()).list || []; } catch { list = []; } k = Math.min(k, Math.max(0, list.length - 1)); }
  async function store(next) {
    try { const r = await fetch('/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ list: next }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); list = j.list; return true; }
    catch { Dialog.alert('서식을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.'); return false; }
  }
  function draw() {
    const t = list[k];
    const chips = list.map((x, i) => `<button type="button" class="cv-chip${i === k && !edit ? ' on' : ''}" data-tk="${i}">${esc(x.name)}</button>`).join('');
    let body = '<p class="tl-none">서식이 없어요. 입력창에 글을 쓰고 「지금 글을 서식으로」를 눌러 보세요.</p>';
    if (edit) body = `<label class="tl-l">이름<input class="tl-in" data-e="name" maxlength="40" value="${esc(edit.name)}"></label><label class="tl-l">내용 <small>빈칸은 {이름} 처럼 중괄호로</small><textarea class="tl-in" data-e="text" rows="6" maxlength="4000">${esc(edit.text)}</textarea></label>
      <div class="tl-foot">${edit.i == null ? '' : '<button type="button" class="text-btn danger" data-t="del">지우기</button>'}<span class="cv-sp"></span><button type="button" class="text-btn" data-t="cancel">취소</button><button type="button" class="text-btn accent" data-t="save">저장</button></div>`;
    else if (t) body = `<div class="tl-f">${blanks(t.text).map((b) => `<label class="tl-l">${esc(b)}<input class="tl-in" data-b="${esc(b)}" value="${esc(vals[b] || '')}"></label>`).join('')}</div><div class="tl-prev"></div>
      <div class="tl-foot"><button type="button" class="text-btn" data-t="edit">고치기</button><span class="cv-sp"></span><button type="button" class="text-btn accent" data-t="use">입력창에 넣기</button></div>`;
    box.innerHTML = `<div class="tl-head"><b>자주 쓰는 요청</b><span class="cv-sp"></span><button type="button" class="icon-btn small" data-t="close" title="닫기 (Esc)">✕</button></div><div class="tl-chips">${chips}<button type="button" class="cv-chip" data-t="new">＋ 지금 글을 서식으로</button></div>${body}`;
    preview(); place();
  }
  function preview() { const p = box.querySelector('.tl-prev'); if (p && list[k]) p.innerHTML = esc(list[k].text).replace(/\{([^{}\r\n]{1,24})\}/g, (m, n) => `<mark>${esc(vals[n.trim()] || '') || m}</mark>`); }
  function place() {
    const r = btn.getBoundingClientRect(); box.style.left = `${Math.round(Math.max(12, Math.min(innerWidth - box.offsetWidth - 12, r.right - box.offsetWidth)))}px`;
    box.style.top = `${Math.round(Math.max(12, r.top - box.offsetHeight - 14))}px`;
  }
  async function act(a) {
    if (a === 'close') return close();
    if (a === 'new') { edit = { i: null, name: '', text: composer.value.trim() }; draw(); return box.querySelector('[data-e=name]').focus(); }
    if (a === 'edit') { edit = { i: k, ...list[k] }; draw(); return box.querySelector('[data-e=text]').focus(); }
    if (a === 'cancel') { edit = null; return draw(); }
    if (a === 'save') {
      const name = box.querySelector('[data-e=name]').value.trim(), text = box.querySelector('[data-e=text]').value.trim();
      if (!name || !text) return box.querySelector(name ? '[data-e=text]' : '[data-e=name]').focus();
      const next = list.map((x) => ({ ...x })); if (edit.i == null) next.push({ name, text }); else next[edit.i] = { name, text };
      const at = edit.i ?? next.length - 1; if (await store(next)) { edit = null; k = at; draw(); } return;
    }
    if (a === 'del') { const i = edit.i; if (!(await Dialog.confirm(`서식 「${list[i].name}」을 지울까요?`, { okLabel: '지우기', danger: true }))) return; if (await store(list.filter((_, x) => x !== i))) { edit = null; k = Math.max(0, i - 1); draw(); } return; }
    if (a === 'use') {
      const text = filled(list[k].text), v = composer.value.trimEnd(); composer.value = v ? `${v}\n\n${text}` : text;
      composer.dispatchEvent(new Event('input', { bubbles: true })); close(); composer.focus();
      const at = composer.value.search(BLANK); BLANK.lastIndex = 0; // 안 채운 빈칸이 있으면 거기를 골라 둔다
      if (at >= 0) { const end = composer.value.indexOf('}', at) + 1; composer.setSelectionRange(at, end); } else composer.setSelectionRange(composer.value.length, composer.value.length);
    }
  }
  async function open() {
    if (!box) {
      box = document.createElement('div'); box.id = 'tpl-pop'; box.className = 'tl-pop'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '자주 쓰는 요청'); document.body.appendChild(box);
      box.addEventListener('click', (e) => { const c = e.target.closest('[data-tk]'); if (c) { k = Number(c.dataset.tk); edit = null; return draw(); } const b = e.target.closest('[data-t]'); if (b) act(b.dataset.t); });
      box.addEventListener('input', (e) => { const b = e.target.dataset.b; if (b != null) { vals[b] = e.target.value; preview(); place(); } });
      box.addEventListener('keydown', (e) => { if (e.key === 'Escape') return; e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing && e.target.matches('input')) { e.preventDefault(); act(edit ? 'save' : 'use'); } });
      document.addEventListener('pointerdown', (e) => { if (isOpen() && !edit && !e.target.closest('#tpl-pop, #btn-tpl, #dlg')) close(); });
    }
    await load(); edit = null; box.hidden = false; draw(); btn.setAttribute('aria-expanded', 'true'); (box.querySelector('[data-b]') || box.querySelector('[data-tk]'))?.focus();
  }
  /** 빠른 찾기(Ctrl+K)에서 고른 서식을 바로 펼친다. */
  async function openAt(i) { await open(); if (list[i]) { k = i; draw(); (box.querySelector('[data-b]') || box.querySelector('[data-t=use]'))?.focus(); } }
  function close() { if (!isOpen()) return false; box.hidden = true; edit = null; btn.setAttribute('aria-expanded', 'false'); composer.focus(); return true; }
  function init(o) { composer = o.composer; btn = $('#btn-tpl'); btn?.addEventListener('click', () => (isOpen() ? close() : open())); }
  return { init, open, openAt, close, isOpen, _filled: (t, v) => { vals = v; return filled(t); } };
})();
