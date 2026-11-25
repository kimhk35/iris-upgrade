// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 업데이트 뒤 「새로운 점」(P18 2026-11-25 4차 5번): 판이 바뀐 뒤 처음 켰을 때 오른쪽 아래에 한 번. 새로 설치한 PC 에는 띄우지 않는다(튜토리얼이 있음).
   새 판을 낼 때 RELEASE 와 ITEMS 를 바꾼다 — RELEASE 는 package.json iris.release 와 같아야 한다(check-round4 가 본다). */
window.WhatsNew = (() => {
  const RELEASE = '2.1.5';
  const ITEMS = [
    { t: '캔버스가 더 튼튼해졌어요', s: '엑셀·메모장 한글이 안 깨지고, 넓은 엑셀은 한 쪽에, 저장 기능이 있는 웹페이지도 그대로 움직여요.' },
    { t: '새 판은 저절로 받아 둬요', s: '켜면 확인해 뒤에서 받아 두고, 바꿀지만 물어봐요. 앞으로는 바뀐 부품만 받아요.', go: 'about' },
    { t: '빠른 찾기 Ctrl+K', s: '대화·폴더·설정·서식을 한 칸에서 찾아요.', go: 'palette' },
    { t: '쓰던 글은 대화마다 따로', s: '다른 대화로 옮겨도, 껐다 켜도 그대로 남아요.' },
    { t: '두 AI 답 나란히 견주기', s: '입력창 위 「견주기」를 누르면 같은 질문을 두 AI에 함께 물어요.', go: 'compare' },
    { t: 'IRIS 건강 점검 · 폴더별 묶기', s: '설정의 「업데이트·정보」와 「작업목록 ▾」에 있어요.', go: 'health' },
  ];
  const KEY = 'iris.release.seen';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let el = null, opts = {};
  function close() { if (!el) return false; el.remove(); el = null; return true; }
  function show() {
    close();
    el = document.createElement('aside'); el.className = 'wn'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '새로운 점');
    el.innerHTML = `<div class="wn-h"><b>${esc(RELEASE)} 새로운 점</b><button type="button" class="icon-btn small" data-x title="닫기">✕</button></div><ul>${ITEMS.map((x, i) => `<li><span><b>${esc(x.t)}</b><small>${esc(x.s)}</small></span>${x.go ? `<button type="button" class="text-btn outline" data-go="${i}">보러 가기</button>` : ''}</li>`).join('')}</ul>`;
    el.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) return void close(); const b = e.target.closest('[data-go]'); if (b) { const g = ITEMS[Number(b.dataset.go)].go; close(); opts.go?.(g); } });
    document.body.appendChild(el);
  }
  /** hello 때마다 불러도 한 번만. updated = 방금 업데이트됨, used = 이미 쓰던 PC(대화가 있음), busy = 튜토리얼이 떠 있음. */
  function maybe({ updated = false, used = false, busy = false } = {}) {
    let seen = null; try { seen = localStorage.getItem(KEY); } catch { return false; }
    if (seen === RELEASE || busy) return false;
    try { localStorage.setItem(KEY, RELEASE); } catch { return false; }
    if (!seen && !updated && !used) return false; // 새로 설치한 PC
    show(); return true;
  }
  return { init: (o) => { opts = o; }, maybe, show, close, release: RELEASE, count: ITEMS.length };
})();
