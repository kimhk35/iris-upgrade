// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 지난 대화 검색(P18 2026-11-24 사용자 선택 3번): 작업목록 머리의 돋보기 · Ctrl+Shift+F.
   찾기는 데몬(/api/search, daemon/search.mjs)이 이 PC 의 기록에서만 한다. 잠긴 개인 공간의 대화는 나오지 않는다. 결과를 누르면 그 대화의 그 자리로. */
window.Search = (() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const AG = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
  let box = null, agent = '', timer = 0, seq = 0, stale = false, opts = {}, prev = null, data = [];
  const isOpen = () => !!box && !box.hidden;
  const when = (t) => { const d = new Date(t || 0); if (!t || isNaN(d)) return ''; const now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : `${d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}년 `}${d.getMonth() + 1}월 ${d.getDate()}일`; };
  /** 찾은 낱말 표시(글자는 먼저 안전하게 바꾼 뒤) */
  function marked(text, words) {
    const low = text.toLowerCase(); const cut = [];
    for (const w of words) for (let k = low.indexOf(w); w && k >= 0; k = low.indexOf(w, k + w.length)) cut.push([k, k + w.length]);
    cut.sort((a, b) => a[0] - b[0]); let out = '', at = 0;
    for (const [a, b] of cut) { if (a < at) continue; out += `${esc(text.slice(at, a))}<mark>${esc(text.slice(a, b))}</mark>`; at = b; }
    return out + esc(text.slice(at));
  }
  function build() {
    box = document.createElement('div'); box.id = 'search'; box.className = 'srch'; box.hidden = true;
    box.innerHTML = `<div class="srch-box" role="dialog" aria-modal="true" aria-label="지난 대화 검색">
      <div class="srch-top"><input type="search" class="srch-in" placeholder="지난 대화에서 찾을 말" spellcheck="false" aria-label="찾을 말"><button type="button" class="icon-btn" data-s="close" title="닫기 (Esc)">✕</button></div>
      <div class="srch-ag">${[['', '전체'], ...Object.entries(AG)].map(([k, n]) => `<button type="button" class="cv-chip" data-ag="${k}">${n}</button>`).join('')}<span class="srch-n"></span></div>
      <div class="srch-list"></div></div>`;
    document.body.appendChild(box);
    box.addEventListener('click', (e) => {
      if (e.target === box || e.target.closest('[data-s="close"]')) return close();
      const a = e.target.closest('[data-ag]'); if (a) { agent = a.dataset.ag; draw(); return run(); }
      const h = e.target.closest('[data-id]'); if (h) go(h);
    });
    const inp = box.querySelector('.srch-in');
    inp.addEventListener('input', () => { stale = true; clearTimeout(timer); timer = setTimeout(run, 220); });
    box.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      const rows = [...box.querySelectorAll('[data-id]')], k = rows.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (rows[k + 1] || rows[0])?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); k <= 0 ? inp.focus() : rows[k - 1].focus(); }
      else if (e.key === 'Enter' && e.target === inp) { e.preventDefault(); const first = () => { const r = box.querySelector('[data-id]'); if (r && isOpen()) go(r); }; if (stale) { clearTimeout(timer); run().then(() => { if (!stale) first(); }); } else first(); } // 치자마자 Enter = 새 결과를 기다렸다가
      if (e.key !== 'Escape') e.stopPropagation(); // 뒤 화면 단축키로 새지 않게(Esc 는 onEscape 한 길)
    });
  }
  function go(el) { const { id, i } = el.dataset; close(); opts.onPick?.(id, i ? Number(i) : null); }
  function draw() { for (const b of box.querySelectorAll('[data-ag]')) { const on = b.dataset.ag === agent; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); } }
  async function run() {
    const q = box.querySelector('.srch-in').value.trim(), list = box.querySelector('.srch-list'), n = box.querySelector('.srch-n'), my = ++seq; stale = true;
    if (q.length < 2) { data = []; stale = false; n.textContent = ''; list.innerHTML = '<p class="srch-empty">두 글자 이상 적어 주세요. 여러 낱말을 띄어 쓰면 모두 들어 있는 글만 찾아요.</p>'; return; }
    let j; try { const r = await fetch(`/api/search?q=${encodeURIComponent(q)}${agent ? `&agent=${agent}` : ''}`, { headers: opts.headers?.() || {} }); j = await r.json(); if (!r.ok) throw new Error(j.error); }
    catch { if (my === seq) list.innerHTML = '<p class="srch-empty">찾지 못했어요. IRIS 와 연결이 끊겼는지 확인해 주세요.</p>'; return; }
    if (my !== seq) return; // 늦게 온 앞 결과는 버린다
    stale = false; data = j.sessions || []; const words = q.toLowerCase().split(/\s+/);
    n.textContent = data.length ? `대화 ${j.total}개` : '';
    list.innerHTML = data.length ? data.map((s) => `<section class="srch-s"><button type="button" class="srch-t" data-id="${esc(s.id)}"><b>${marked(s.title || '이름 없는 대화', words)}</b><small>${AG[s.agent] || esc(s.agent)} · ${esc(s.folder)} · ${when(s.t)}</small></button>${s.hits.map((h) => `<button type="button" class="srch-h" data-id="${esc(s.id)}" data-i="${h.i}"><i>${h.kind === 'user' ? '나' : 'AI'}</i><span>${marked(h.text, words)}</span></button>`).join('')}${s.more ? `<p class="srch-more">이 대화에 ${s.more}곳 더 있어요</p>` : ''}</section>`).join('')
      + (j.total > data.length ? `<p class="srch-empty">가까운 것부터 ${data.length}개만 보여요. 낱말을 더 적으면 좁혀져요.</p>` : '') : '<p class="srch-empty">찾은 대화가 없어요.</p>';
    list.scrollTop = 0;
  }
  function open() { if (!box) build(); prev = document.activeElement; box.hidden = false; draw(); const inp = box.querySelector('.srch-in'); inp.focus(); inp.select(); run(); }
  function close() { if (!isOpen()) return false; box.hidden = true; seq++; (prev?.isConnected ? prev : $('#composer-text'))?.focus?.(); return true; }
  function init(o) {
    opts = o || {};
    $('#btn-search')?.addEventListener('click', open);
    document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); isOpen() ? close() : open(); } });
  }
  return { init, open, close, isOpen };
})();
