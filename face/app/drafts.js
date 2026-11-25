// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 쓰던 글을 대화마다 따로(P18 2026-11-25 4차 3번): 입력칸은 하나지만 글과 첨부는 대화마다 지킨다 — A 에 쓰던 글이 B 로 옮겨도 남아 엉뚱한 대화(특히 로컬 AI 에
   쓰던 글이 다른 AI)로 가던 것. 껐다 켜도 남는다(localStorage). 잠금을 푼 개인 공간에서 쓰던 글은 디스크에 남기지 않고 그 공간 것으로만 기억한다. */
window.Drafts = (() => {
  const KEY = 'iris.drafts', MAX = 120, LIMIT = 100_000;
  let ta = null, files = [], opts = {}, cur = null, timer = 0;
  let disk = {}; try { const j = JSON.parse(localStorage.getItem(KEY) || '{}'); if (j && typeof j === 'object') disk = j; } catch {}
  const mem = new Map(); // 개인 공간 것 — 이 창이 켜져 있는 동안만
  const me = () => opts.profile?.() || '';
  const keyOf = (id) => `${me()}|${id || '~home'}`;
  const priv = (k) => !k.startsWith('|');
  const get = (k) => (priv(k) ? mem.get(k) : disk[k]) || null;
  const flush = () => { clearTimeout(timer); timer = 0; try { localStorage.setItem(KEY, JSON.stringify(disk)); } catch {} };
  function put(k, text, list) {
    const empty = !text.trim() && !list.length;
    if (priv(k)) { if (empty) mem.delete(k); else mem.set(k, { t: text, f: list }); return; }
    if (empty) { if (!disk[k]) return; delete disk[k]; }
    else { delete disk[k]; disk[k] = { t: text.slice(0, LIMIT), f: list, at: Date.now() }; } // 다시 넣어 맨 뒤(최근)로
    const ks = Object.keys(disk); for (const x of ks.slice(0, Math.max(0, ks.length - MAX))) delete disk[x];
    if (!timer) timer = setTimeout(flush, 300);
  }
  const stash = () => { if (cur != null) put(cur, ta.value, files.map((f) => ({ ...f }))); };
  function load() { const d = get(cur); ta.value = d?.t || ''; files.splice(0, files.length, ...(d?.f || [])); opts.onLoad?.(); }
  /** 보는 대화가 바뀌었으면 앞의 글을 넣어 두고 그 대화의 글을 꺼낸다(render 때마다 불러도 된다). */
  function sync(id) { const k = keyOf(id); if (k === cur) return; stash(); cur = k; load(); }
  /** 지금 글을 다른 자리로 옮긴다(대화에서 폴더를 새로 골라 새 요청으로 바꿀 때). 쓰던 글이 없으면 그 자리의 글을 꺼낸다. */
  function carry(id) { const t = ta.value, f = files.slice(); if (!t.trim() && !f.length) return sync(id); if (cur != null) put(cur, '', []); cur = keyOf(id); put(cur, t, f); }
  /** 보낸 글 지우기. 보내는 사이 다른 대화로 옮겼으면 그 대화의 글은 건드리지 않는다. */
  function sent(k) { put(k, '', []); if (k === cur) load(); }
  function forget(id) { const k = keyOf(id); if (k !== cur) put(k, '', []); }
  const has = (id) => { const k = keyOf(id); return k === cur ? !!(ta.value.trim() || files.length) : !!get(k); };
  function init(o) {
    opts = o; ta = o.textarea; files = o.files;
    ta.addEventListener('input', stash);
    addEventListener('pagehide', () => { stash(); flush(); });
    cur = keyOf(null); load();
  }
  return { init, sync, carry, sent, forget, has, stash, key: () => cur };
})();
