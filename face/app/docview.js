// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 캔버스의 문서 보기(P18 2026-11-24 사용자 확정 시안 = 바탕화면 IRIS\캔버스-문서보기-시안.html):
   PPT = 작은 슬라이드 목록 + 큰 슬라이드(앞·뒤·전체 화면) / 워드·한/글·엑셀 = 종이처럼 이어서(－·＋).
   그림은 데몬 /api/doc/page(docpages.mjs). 다시 그려도 보던 쪽·자리·크기를 지키고, 바뀐 쪽에 「바뀜」을 붙인다. iframe 을 쓰지 않아 글 쓰던 커서를 빼앗지 않는다. */
window.DocView = (() => {
  const memo = new Map(); // 문서 경로 → { page, zoom, top, hashes, changed:Set }
  const of = (p) => { if (!memo.has(p)) memo.set(p, { page: 1, zoom: 100, top: 0, hashes: null, changed: new Set() }); return memo.get(p); };
  let full = null;
  const url = (info, n) => `/api/doc/page?id=${info.id}&n=${n}`;
  const isSlides = (p) => /\.(pptx?|odp)$/i.test(p);

  /** view 안에 그린다. 이미 같은 문서가 있으면 자리를 지킨 채 갈아 끼운다. */
  function mount(view, p, info, { key = p, onPick = null, onCompare = null } = {}) {
    const st = of(key); st.key = key; st.page = Math.max(1, Math.min(info.n, st.page));
    const box = document.createElement('div'); box.className = `dv ${isSlides(p) ? 'dv-slides' : 'dv-paper'}`; box.tabIndex = 0;
    if (isSlides(p)) slides(box, st, info, onPick); else paper(box, st, info, onPick);
    if (onCompare) { const b = document.createElement('button'); b.type = 'button'; b.className = 'cv-chip dv-cmp'; b.textContent = '앞 판과 비교'; b.hidden = true; b.onclick = (e) => { e.stopPropagation(); onCompare(); }; box.querySelector('.dv-bar').appendChild(b); }
    // 보던 자리: 앞 화면의 목록 자리를 옮겨 온다
    const oldThumb = view.querySelector('.dv-thumbs')?.scrollTop || 0; const refocus = view.contains(document.activeElement);
    view.replaceChildren(box);
    const th = box.querySelector('.dv-thumbs'); if (th) th.scrollTop = oldThumb;
    const sc = box.querySelector('.dv-scroll'); if (sc) sc.scrollTop = st.top;
    if (refocus) box.focus({ preventScroll: true });
    if (full?.key === key) { full.info = info; full.show(st.page); }
    // 바뀐 쪽: 앞 판의 지문과 다른 쪽
    fetch(`/api/doc/hashes?id=${info.id}`).then((r) => r.ok ? r.json() : null).then((j) => {
      if (!j?.hashes) return;
      if (st.hashes && st.id !== info.id) { st.changed = new Set(); j.hashes.forEach((h, i) => { if (st.hashes[i] !== h) st.changed.add(i + 1); }); }
      st.hashes = j.hashes; st.id = info.id; mark(box, st);
    }).catch(() => {});
    mark(box, st);
  }
  function mark(box, st) { const cb = box.querySelector('.dv-cmp'); if (cb) cb.hidden = !st.changed.size; for (const el of box.querySelectorAll('[data-dvpage]')) el.classList.toggle('chg', st.changed.has(Number(el.dataset.dvpage))); }

  /** 쪽 그림에서 누른 자리 → { page, text, where } 를 알리고 그 줄에 테두리. 글자가 없는 곳(그림)은 자리 이름으로. */
  const WHERE = [['왼쪽 위', '위쪽 가운데', '오른쪽 위'], ['왼쪽', '가운데', '오른쪽'], ['왼쪽 아래', '아래쪽 가운데', '오른쪽 아래']];
  async function pickAt(e, img, info, page, unit, onPick) {
    const r = img.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    let lines = []; try { lines = (await (await fetch(`/api/doc/text?id=${info.id}&n=${page}`)).json()).lines || []; } catch {}
    const gap = (l) => Math.hypot(Math.max(l[0] - x, 0, x - l[2]), Math.max(l[1] - y, 0, y - l[3]) * (r.height / r.width));
    const best = lines.map((l) => [gap(l), l]).sort((a, b) => a[0] - b[0])[0]; const hit = best && best[0] < 0.02 ? best[1] : null;
    const holder = img.parentElement; holder.querySelector('.dv-pick')?.remove();
    const m = document.createElement('i'); m.className = 'dv-pick'; const b = hit || [x - 0.04, y - 0.04, x + 0.04, y + 0.04], h = holder.getBoundingClientRect(), pad = hit ? 4 : 0;
    Object.assign(m.style, { left: `${r.left - h.left + b[0] * r.width - pad}px`, top: `${r.top - h.top + b[1] * r.height - pad}px`, width: `${(b[2] - b[0]) * r.width + pad * 2}px`, height: `${(b[3] - b[1]) * r.height + pad * 2}px` });
    holder.appendChild(m);
    const where = hit ? '' : WHERE[Math.min(2, Math.floor(y * 3))][Math.min(2, Math.floor(x * 3))];
    onPick({ page, unit, label: `${page}${unit}${hit ? ` 「${hit[4].slice(0, 60)}」` : ` ${where}`}` });
  }
  function slides(box, st, info, onPick) {
    const ratio = (i) => `${info.sizes[i][0]} / ${info.sizes[i][1]}`;
    box.innerHTML = `<div class="dv-thumbs" role="listbox" aria-label="슬라이드 목록">${info.sizes.map((_, i) => `<button type="button" data-dvpage="${i + 1}" aria-label="${i + 1}번 슬라이드"><img loading="lazy" src="${url(info, i + 1)}" alt="" style="aspect-ratio:${ratio(i)}"><i>${i + 1}</i></button>`).join('')}</div>
      <div class="dv-stage"><div class="dv-slide"><img alt=""></div><div class="dv-bar"><button type="button" class="cv-chip" data-dv="prev">◀ 앞</button><span class="dv-no"></span><button type="button" class="cv-chip" data-dv="next">뒤 ▶</button><button type="button" class="cv-chip" data-dv="full">전체 화면</button></div></div>`;
    const img = box.querySelector('.dv-slide img'); let want = 0;
    const go = (n, scroll = true) => {
      n = Math.max(1, Math.min(info.n, n)); st.page = n; want = n;
      box.querySelector('.dv-no').textContent = `${n} / ${info.n}`;
      for (const b of box.querySelectorAll('.dv-thumbs button')) { const on = Number(b.dataset.dvpage) === n; b.classList.toggle('on', on); if (on && scroll) b.scrollIntoView({ block: 'nearest' }); }
      const pre = new Image(); pre.onload = () => { if (want === n) { img.src = pre.src; img.alt = `${n}번 슬라이드`; } }; pre.src = url(info, n);
      if (full?.key === st.key) full.show(n);
      box.querySelector('.dv-pick')?.remove();
    };
    box.addEventListener('click', (e) => {
      const th = e.target.closest('.dv-thumbs button'); if (th) { go(Number(th.dataset.dvpage)); onPick?.({ page: st.page, unit: '번 슬라이드', label: `${st.page}번 슬라이드` }); return; }
      if (onPick && e.target === img) return void pickAt(e, img, info, st.page, '번 슬라이드', onPick);
      const b = e.target.closest('[data-dv]'); if (!b) return;
      if (b.dataset.dv === 'prev') go(st.page - 1); else if (b.dataset.dv === 'next') go(st.page + 1); else openFull(info, st, go);
    });
    box.addEventListener('keydown', (e) => { if (keyTo(e, st, info, go)) { e.preventDefault(); e.stopPropagation(); } });
    go(st.page, false);
  }
  function keyTo(e, st, info, go) {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown') go(st.page + 1); else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') go(st.page - 1);
    else if (k === 'Home') go(1); else if (k === 'End') go(info.n); else return false;
    return true;
  }
  function openFull(info, st, go) {
    closeFull();
    const el = document.createElement('div'); el.className = 'dv-full'; el.tabIndex = 0; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '슬라이드 전체 화면');
    el.innerHTML = '<img alt=""><span class="dv-fno"></span><span class="dv-ftip">← → 넘기기 · Esc 닫기</span>';
    full = { el, info, key: st.key, show: (n) => { el.querySelector('img').src = url(full.info, n); el.querySelector('.dv-fno').textContent = `${n} / ${full.info.n}`; } };
    el.addEventListener('click', (e) => go(st.page + (e.clientX < innerWidth / 3 ? -1 : 1)));
    el.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); return go(st.page + 1); } if (keyTo(e, st, full.info, go)) { e.preventDefault(); e.stopPropagation(); } });
    document.body.appendChild(el); full.show(st.page); el.focus();
    el.requestFullscreen?.().catch(() => {});
  }
  // Esc 로 전체 화면만 닫힌 경우(브라우저가 먼저 처리)에도 덮개를 거둔다
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && full) closeFull(); });
  let closedAt = 0;
  function closeFull() { if (!full) return false; const el = full.el; full = null; closedAt = Date.now(); if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {}); el.remove(); return true; }
  /** Esc: 전체 화면을 닫았으면 true(작업 중단으로 새지 않게). 브라우저가 방금 먼저 닫은 경우도 같은 Esc 로 본다. */
  const escape = () => closeFull() || Date.now() - closedAt < 600;

  function paper(box, st, info, onPick) {
    box.innerHTML = `<div class="dv-scroll">${info.sizes.map((s, i) => `<div class="dv-page" data-dvpage="${i + 1}" style="aspect-ratio:${s[0]} / ${s[1]}"><img loading="lazy" src="${url(info, i + 1)}" alt="${i + 1}쪽"></div>`).join('')}</div>
      <div class="dv-bar"><button type="button" class="cv-chip" data-dv="-" aria-label="작게">－</button><span class="dv-no"></span><button type="button" class="cv-chip" data-dv="+" aria-label="크게">＋</button><button type="button" class="cv-chip" data-dv="fit">폭 맞춤</button></div>`;
    const sc = box.querySelector('.dv-scroll'); const pages = [...box.querySelectorAll('.dv-page')];
    const no = () => { const mid = sc.scrollTop + sc.clientHeight / 2; let n = 1; for (const [i, el] of pages.entries()) if (el.offsetTop - sc.offsetTop <= mid) n = i + 1; st.page = n; box.querySelector('.dv-no').textContent = `${n} / ${info.n}쪽 · ${st.zoom}%`; };
    const zoom = (z) => { const at = sc.scrollHeight ? sc.scrollTop / sc.scrollHeight : 0; st.zoom = Math.max(40, Math.min(250, z)); sc.style.setProperty('--dv-z', `${st.zoom}%`); sc.scrollTop = at * sc.scrollHeight; no(); };
    sc.addEventListener('scroll', () => { st.top = sc.scrollTop; no(); }, { passive: true });
    box.addEventListener('click', (e) => {
      const pg = onPick && e.target.closest('.dv-page'); if (pg) { for (const x of box.querySelectorAll('.dv-pick')) x.remove(); return void pickAt(e, pg.querySelector('img'), info, Number(pg.dataset.dvpage), '쪽', onPick); }
      const b = e.target.closest('[data-dv]'); if (!b) return; zoom(b.dataset.dv === 'fit' ? 100 : st.zoom + (b.dataset.dv === '+' ? 15 : -15)); });
    sc.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); zoom(st.zoom + (e.deltaY < 0 ? 10 : -10)); }, { passive: false });
    sc.style.setProperty('--dv-z', `${st.zoom}%`); requestAnimationFrame(no);
  }
  /** 대화 속 문서(P18 2026-11-24 선택 2번): 자리표시자 figure[data-docv] 를 화면에 들어올 때 변환해 같은 보기로. 실패하면 한 줄 안내. */
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }, { rootMargin: '300px' });
  async function load(fig) {
    const p = fig.dataset.docv, box = fig.querySelector('.dv-embed'); if (!box || fig.dataset.loading) return;
    fig.dataset.loading = '1'; fig.classList.remove('off'); box.innerHTML = '<div class="cv-wait">미리보기를 만드는 중…</div>';
    let j = {}, ok = false; try { const r = await fetch(`/api/doc?path=${encodeURIComponent(p)}&pages=1`); ok = r.ok; j = await r.json(); } catch {}
    delete fig.dataset.loading; if (!fig.isConnected) return;
    if (ok && j.n) { box.classList.toggle('slides', isSlides(p)); return mount(box, p, j, { key: `chat:${p}` }); }
    fig.classList.add('off'); box.textContent = '';
    if (ok) { fig.classList.remove('off'); const f = document.createElement('iframe'); f.dataset.born = Date.now(); f.src = `/api/doc?path=${encodeURIComponent(p)}#navpanes=0&view=FitH`; f.title = p; box.appendChild(f); return; } // 쪽 그림을 못 그리는 PC
    const s = document.createElement('span'); s.className = 'url-state off'; s.textContent = j.error || '미리보기를 만들지 못했어요.';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn small'; b.textContent = '↻'; b.title = '다시 시도'; b.onclick = () => load(fig);
    box.append(s, b);
  }
  const watch = (scope) => { if (scope.matches?.('figure[data-docv]')) io.observe(scope); for (const f of scope.querySelectorAll?.('figure[data-docv]') || []) io.observe(f); };
  return { mount, escape, isSlides, watch, _state: of };
})();
