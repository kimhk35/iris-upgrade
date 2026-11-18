// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 개인 공간(P18 조각 C, 2026-11-12): 같은 PC 를 여러 선생님이 번갈아 쓸 때 「내 세션」을 이름+PIN 으로 가린다.
   · 머리줄 칩 = 「공용」(잠김) 또는 「○○ 공간」. 누르면 공간 고르기·PIN·새 공간 만들기·잠그기.
   · 잠금을 푼 동안 만든 세션은 그 공간 것(데몬이 owner 로 적음) — 다른 공간·공용 화면에는 목록에도 안 보이고 기록·보내기 길도 막힌다.
   · 열쇠(token)는 이 창의 메모리에만(새로 고치거나 창을 다시 열면 잠김). 10분 동안 손대지 않으면 저절로 잠금.
   · 한계는 창에 적는다: IRIS 화면 안의 잠금이며, 탐색기로 기록 폴더를 직접 열면 볼 수 있다. */
window.Profile = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const IDLE_MS = 10 * 60 * 1000;
  let token = null, me = null, list = [], chip = null, modal = null, onChange = () => {}, idleT = 0, lockedCount = 0;

  async function call(p, body) {
    const r = await fetch(p, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-iris-profile': token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
  }
  async function refresh() { try { const j = await call('/api/profiles'); list = j.list || []; } catch {} drawChip(); }
  function drawChip() {
    if (!chip) return;
    chip.classList.toggle('mine', !!me);
    chip.querySelector('span').textContent = me ? `${me.name} 공간` : '공용';
    chip.title = me ? `${me.name} 공간 사용 중 — 누르면 잠그기 · 10분 동안 손대지 않으면 저절로 잠깁니다` : `공용 화면${lockedCount ? ` · 잠긴 세션 ${lockedCount}개` : ''} — 누르면 내 공간 열기·만들기`;
  }
  function set(t, who) { token = t; me = who; drawChip(); armIdle(); onChange(); }
  async function lock() { if (!token) return; try { await call('/api/profiles/lock', {}); } catch {} set(null, null); }
  function armIdle() { clearTimeout(idleT); if (token) idleT = setTimeout(() => lock(), IDLE_MS); }

  // ── 창 ──
  function close() { if (modal) modal.hidden = true; }
  function open() {
    if (!modal) {
      modal = document.createElement('div'); modal.id = 'pf-modal'; modal.className = 'dlg pf-modal'; modal.hidden = true;
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); const b = e.target.closest('[data-pf]'); if (b) act(b.dataset.pf, b.dataset.id); });
      modal.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter') { const go = modal.querySelector('[data-pf-enter]'); if (go) { e.preventDefault(); act(go.dataset.pf, go.dataset.id); } } });
    }
    view(me ? 'mine' : 'pick'); modal.hidden = false;
  }
  let pickId = null, err = '';
  function view(v, id) {
    pickId = id ?? pickId;
    const note = '<p class="pf-note">IRIS 화면 안의 잠금입니다. 컴퓨터를 잘 아는 사람이 탐색기로 기록 폴더를 직접 열면 볼 수 있어요. 공용 PC 에서 아주 민감한 내용은 다루지 마세요.</p>';
    const er = err ? `<p class="pf-err">${esc(err)}</p>` : ''; err = '';
    let html = '';
    if (v === 'mine') html = `<h3>${esc(me.name)} 공간 사용 중</h3><p>지금 만드는 세션은 이 공간에만 보입니다. 자리를 비울 때는 꼭 잠가 주세요(10분 뒤 저절로 잠김).</p>${er}<div class="pf-acts"><button class="text-btn accent" data-pf="lock" data-pf-enter>잠그기</button><button class="text-btn" data-pf="close">닫기</button><span class="pf-sp"></span><button class="text-btn danger" data-pf="askremove">이 공간 지우기</button></div>${note}`;
    else if (v === 'pick') html = `<h3>내 공간 열기</h3><p>이름을 고르고 PIN 을 넣으세요. 공용 세션은 누구에게나 보이고, 공간에서 만든 세션은 그 공간에만 보입니다.</p>${list.length ? `<div class="pf-list">${list.map((p) => `<button class="pf-who${p.id === pickId ? ' cur' : ''}" data-pf="pick" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>` : '<p class="pf-empty">아직 만든 공간이 없습니다.</p>'}${pickId ? `<div class="pf-row"><input id="pf-pin" type="password" inputmode="numeric" maxlength="8" placeholder="PIN (숫자 4~8자리)" autocomplete="off"><button class="text-btn accent" data-pf="unlock" data-id="${esc(pickId)}" data-pf-enter>열기</button></div>` : ''}${er}<div class="pf-acts"><button class="text-btn" data-pf="new">새 공간 만들기</button><span class="pf-sp"></span><button class="text-btn" data-pf="close">닫기</button></div>${note}`;
    else if (v === 'new') html = `<h3>새 공간 만들기</h3><div class="pf-form"><input id="pf-name" type="text" maxlength="20" placeholder="이름 (예: 김선생)" autocomplete="off"><input id="pf-pin" type="password" inputmode="numeric" maxlength="8" placeholder="PIN 숫자 4~8자리" autocomplete="off"><input id="pf-pin2" type="password" inputmode="numeric" maxlength="8" placeholder="PIN 한 번 더" autocomplete="off"></div>${er}<div class="pf-acts"><button class="text-btn accent" data-pf="create" data-pf-enter>만들고 열기</button><button class="text-btn" data-pf="back">뒤로</button></div><p class="pf-note">PIN 을 잊으면 되찾을 수 없습니다(그 공간의 세션은 남지만 열 수 없음).</p>`;
    else if (v === 'remove') html = `<h3>${esc(me.name)} 공간 지우기</h3><p>공간만 지우고, 이 공간에서 만든 세션은 지우지 않습니다(누구도 열 수 없게 남습니다). PIN 을 넣어 확인하세요.</p><div class="pf-row"><input id="pf-pin" type="password" inputmode="numeric" maxlength="8" placeholder="PIN" autocomplete="off"><button class="text-btn danger" data-pf="remove" data-pf-enter>지우기</button></div>${er}<div class="pf-acts"><button class="text-btn" data-pf="mineback">뒤로</button></div>`;
    modal.innerHTML = `<div class="dlg-box pf-box" role="dialog" aria-modal="true">${html}</div>`;
    (modal.querySelector('#pf-pin, #pf-name') || modal.querySelector('[data-pf-enter]'))?.focus();
  }
  async function act(a, id) {
    const pin = modal.querySelector('#pf-pin')?.value || '';
    try {
      if (a === 'close') return close();
      if (a === 'pick') return view('pick', id);
      if (a === 'new') return view('new');
      if (a === 'back') return view('pick');
      if (a === 'mineback') return view('mine');
      if (a === 'askremove') return view('remove');
      if (a === 'lock') { await lock(); return close(); }
      if (a === 'unlock') { const r = await call('/api/profiles/unlock', { id, pin }); set(r.token, { id: r.id, name: r.name }); return close(); }
      if (a === 'create') {
        const name = modal.querySelector('#pf-name').value.trim(), p2 = modal.querySelector('#pf-pin2').value;
        if (pin !== p2) throw new Error('PIN 두 번이 서로 다릅니다');
        const r = await call('/api/profiles/create', { name, pin }); await refresh(); set(r.token, { id: r.id, name: r.name }); return close();
      }
      if (a === 'remove') { await call('/api/profiles/remove', { id: me.id, pin }); set(null, null); await refresh(); return close(); }
    } catch (e) { err = e.message; view(a === 'create' ? 'new' : a === 'remove' ? 'remove' : me ? 'mine' : 'pick'); }
  }

  function init(o = {}) {
    onChange = o.onChange || onChange;
    const anchor = $('#local-usage') || $('#limits');
    chip = document.createElement('button'); chip.type = 'button'; chip.id = 'profile-chip'; chip.className = 'pf-chip';
    chip.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span>공용</span>';
    chip.addEventListener('click', () => (me ? view && open() : open()));
    anchor?.parentElement?.insertBefore(chip, anchor);
    for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, armIdle, { passive: true, capture: true });
    refresh();
  }
  return { init, token: () => token, me: () => me, lock, setLockedCount: (n) => { lockedCount = n; drawChip(); }, headers: () => (token ? { 'x-iris-profile': token } : {}) };
})();
