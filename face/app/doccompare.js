// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 앞 판과 비교 · 되돌리기(P18 2026-11-24 2차 시안 1번). 판 보관 = 데몬 docversions.mjs. 쪽 그림을 나란히, 달라진 글 줄에 표시.
   쪽은 같은 번호끼리 견준다(쪽이 끼어들면 뒤쪽이 모두 다르게 보일 수 있음 — 화면에 적음). */
window.DocCompare = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const when = (t) => { const d = new Date(t), today = d.toDateString() === new Date().toDateString(); return `${today ? '오늘' : `${d.getMonth() + 1}월 ${d.getDate()}일`} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}`; };
  const get = async (u) => { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `오류 ${r.status}`); return j; };
  const versions = async (p) => { try { return (await get(`/api/doc/versions?path=${encodeURIComponent(p)}`)).list || []; } catch { return []; } };
  let no = 0;
  async function open(view, p, { page = 1, onClose, onRestored } = {}) {
    const my = ++no; const list = (await versions(p)).filter((v) => !v.cur); if (my !== no) return;
    const box = document.createElement('div'); box.className = 'dc'; box.tabIndex = 0; view.replaceChildren(box);
    if (!list.length) { box.innerHTML = '<div class="cv-empty cv-err"><span>아직 보관한 앞 판이 없어요. AI가 이 문서를 고치면 그때부터 생겨요.</span><span class="cv-errbtns"><button type="button" class="cv-chip" data-c="close">돌아가기</button></span></div>'; box.onclick = (e) => { if (e.target.closest('[data-c]')) onClose?.(); }; return; }
    const st = { v: list.at(-1).v, page, now: null, old: null, diff: [] };
    const wait = (t) => { const b = box.querySelector('.dc-pair'); if (b) b.innerHTML = `<div class="cv-wait">${t}</div>`; };
    box.innerHTML = `<div class="dc-top"><span class="dc-vs">${list.map((x) => `<button type="button" class="cv-chip" data-v="${x.v}">${when(x.mtime)}</button>`).join('')}</span><button type="button" class="cv-chip" data-c="close">비교 닫기</button></div><div class="dc-pair"></div>
      <div class="dv-bar"><button type="button" class="cv-chip" data-c="prev">◀ 앞 바뀐 쪽</button><span class="dv-no"></span><button type="button" class="cv-chip" data-c="next">뒤 바뀐 쪽 ▶</button><button type="button" class="cv-chip on" data-c="restore">이 판으로 되돌리기</button></div>`;
    async function load() {
      for (const b of box.querySelectorAll('[data-v]')) b.classList.toggle('on', b.dataset.v === st.v);
      wait('두 판을 견주는 중…'); const v = st.v, ok = () => my === no && v === st.v && box.isConnected;
      try {
        const e = encodeURIComponent(p); st.now ||= await get(`/api/doc?path=${e}&pages=1`); const old = await get(`/api/doc/version?path=${e}&v=${v}`); if (!ok()) return; st.old = old;
        if (!st.now.n || !old.n) throw new Error('이 PC에서는 쪽 그림을 만들 수 없어 견주지 못해요.');
        const [a, b] = await Promise.all([get(`/api/doc/hashes?id=${old.id}`), get(`/api/doc/hashes?id=${st.now.id}`)]); if (!ok()) return;
        st.diff = []; for (let i = 0; i < Math.max(old.n, st.now.n); i++) if (a.hashes[i] !== b.hashes[i]) st.diff.push(i + 1);
        if (!st.diff.includes(st.page)) st.page = st.diff.find((x) => x >= st.page) || st.diff[0] || 1;
        show();
      } catch (err) { if (ok()) box.querySelector('.dc-pair').innerHTML = `<div class="cv-empty">${esc(err.message)}</div>`; }
    }
    async function show() {
      const n = st.page, pair = box.querySelector('.dc-pair');
      const pane = (info, cap) => `<figure><figcaption>${esc(cap)}</figcaption><div class="dc-pg">${n <= info.n ? `<img src="/api/doc/page?id=${info.id}&n=${n}" alt="${esc(cap)} ${n}쪽">` : '<span class="cv-empty">이 판에는 이 쪽이 없어요</span>'}</div></figure>`;
      pair.innerHTML = pane(st.old, `앞 판 · ${when(list.find((x) => x.v === st.v).mtime)}`) + pane(st.now, '지금');
      box.querySelector('.dv-no').textContent = st.diff.length ? `${n}쪽 · 바뀐 쪽 ${Math.max(1, st.diff.indexOf(n) + 1)}/${st.diff.length}` : '바뀐 쪽이 없어요';
      const lines = async (info) => (n <= info.n ? (await get(`/api/doc/text?id=${info.id}&n=${n}`)).lines || [] : []);
      try {
        const [a, b] = await Promise.all([lines(st.old), lines(st.now)]); if (my !== no || n !== st.page) return;
        const A = new Set(a.map((l) => l[4])), B = new Set(b.map((l) => l[4])); const pg = pair.querySelectorAll('.dc-pg');
        const put = (host, ls, cls) => { const im = host.querySelector('img'); if (!im) return; const w = document.createElement('div'); w.className = 'dc-im'; im.replaceWith(w); w.appendChild(im); for (const l of ls) { const i = document.createElement('i'); i.className = cls; Object.assign(i.style, { left: `${l[0] * 100}%`, top: `${l[1] * 100}%`, width: `${(l[2] - l[0]) * 100}%`, height: `${(l[3] - l[1]) * 100}%` }); w.appendChild(i); } };
        put(pg[0], a.filter((l) => !B.has(l[4])), 'dc-del'); put(pg[1], b.filter((l) => !A.has(l[4])), 'dc-add');
      } catch {}
    }
    const step = (d) => { const i = st.diff.indexOf(st.page); if (!st.diff.length) return; st.page = st.diff[(Math.max(0, i) + d + st.diff.length) % st.diff.length]; show(); };
    box.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); else return; e.preventDefault(); e.stopPropagation(); });
    box.onclick = async (e) => {
      const v = e.target.closest('[data-v]'); if (v) { st.v = v.dataset.v; return load(); }
      const c = e.target.closest('[data-c]')?.dataset.c; if (!c) return;
      if (c === 'close') return onClose?.(); if (c === 'prev') return step(-1); if (c === 'next') return step(1);
      const name = String(p).split(/[\\/]/).pop();
      if (!(await Dialog.confirm(`「${name}」을 ${when(list.find((x) => x.v === st.v).mtime)} 판으로 되돌릴까요?\n지금 판도 보관하므로 다시 돌아올 수 있어요.`, { okLabel: '되돌리기' }))) return;
      try { const r = await fetch('/api/doc/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: p, v: st.v }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); onRestored?.(); }
      catch (err) { Dialog.alert(err.message); }
    };
    load(); box.focus({ preventScroll: true });
  }
  return { open, versions, stop: () => { no++; } };
})();
