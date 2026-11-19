// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 꾸미기 후보 목록: 헤더 마크 · 글자체 · 테마 · 중앙 애니메이션. 설정 패널이 이 목록으로 미리보기를 그리고, 고른 것만 실제로 돈다. */
window.Registry = (() => {
  // 그라디언트도 테마 변수(--mk-1/--mk-2)를 따른다(밝은 테마에서 파랑이 남지 않게)
  const G = (id, a = 'var(--mk-1)', b = 'var(--mk-2)') => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`;
  // svg: 24×24 뷰박스 내용. css: 해당 마크에만 적용되는 애니메이션(.mark.mk-<id> 접두는 적용 시 자동으로 붙는다)
  // v2.54(2026-09-13, 사용자 결정): 헤더 마크·글자체는 고정(회전 육각 · Segoe Script). 후보 목록은 git 이력(v2.53 이전)에.
  const MARKS = [
    { id: 'cube', name: '회전 육각', svg: `<g class="a1"><path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9Z" fill="none" stroke="var(--mk-1)" stroke-width="1.3"/><path d="M12 3v9m0 0l7.8 4.5M12 12l-7.8 4.5" stroke="var(--mk-2)" stroke-width="1" opacity=".7"/></g>`, css: `.a1{animation:mk-spin 16s linear infinite}` },
  ];
  const MARK_KEYFRAMES = `
@keyframes mk-spin{to{transform:rotate(360deg)}}
@keyframes mk-core{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.35);opacity:1}}
@keyframes mk-blink{0%,88%,100%{transform:scaleY(1)}93%{transform:scaleY(.08)}}
@keyframes mk-pupil{0%,100%{r:2.2}50%{r:3.4}}
@keyframes mk-ripple{0%{r:3;opacity:.9}100%{r:11;opacity:0}}
@keyframes mk-breathe{0%,100%{transform:scale(.92);filter:brightness(.9)}50%{transform:scale(1.06);filter:brightness(1.25)}}
@keyframes mk-dash{to{stroke-dashoffset:-56}}
@keyframes mk-twinkle{0%,100%{transform:scale(1) rotate(0);opacity:.8}50%{transform:scale(1.25) rotate(45deg);opacity:1}}
@keyframes mk-aperture{0%,100%{transform:rotate(0) scale(1)}50%{transform:rotate(60deg) scale(.82)}}
@keyframes mk-blob{0%,100%{d:path("M12 3c4 0 7 3 7 7 0 5-3 11-7 11S5 15 5 10c0-4 3-7 7-7Z")}50%{d:path("M12 3c5 0 8 4 8 8 0 4-4 10-8 10S4 15 4 11c0-4 3-8 8-8Z")}}
@keyframes mk-fade{0%,100%{opacity:.35}50%{opacity:1}}
@keyframes mk-hue{to{filter:hue-rotate(360deg)}}
@keyframes mk-swing{0%,100%{transform:rotate(-28deg)}50%{transform:rotate(28deg)}}
@keyframes mk-draw{0%{stroke-dashoffset:60;opacity:0}15%{opacity:1}80%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
@keyframes mk-flip{0%{transform:rotateY(0)}100%{transform:rotateY(360deg)}}
@keyframes mk-slide{to{transform:translateX(24px)}}
@keyframes mk-shine{0%,100%{filter:brightness(.85)}50%{filter:brightness(1.4)}}
.mark *{transform-origin:12px 12px;transform-box:view-box}
@media (prefers-reduced-motion: reduce){.mark *{animation:none!important}}`;

  const FONTS = [
    { id: 'segoe-script', name: 'Segoe Script', css: `font-family:"Segoe Script",cursive;font-weight:700;letter-spacing:.06em;font-size:17px` },
  ];

  // 테마 = CSS 변수 묶음(성능 비용 0). 마크 색(--mk-*)도 함께.
  const THEMES = [
    { id: 'indigo', name: '남색 밤(기본)', vars: { '--base': '#0a0c14', '--surface': '#10131d', '--raised': '#171b28', '--overlay': '#1d2233', '--ink': '#e9ecf5', '--ink-2': '#a6adbf', '--ink-3': '#6e7689', '--iris': '#8fa8ff', '--iris-2': '#c9b8ff', '--iris-soft': 'rgba(143,168,255,.16)', '--mk-1': '#8fa8ff', '--mk-2': '#c9b8ff', '--mk-core': '#e9ecf5', '--mk-dim': '#2a3260', '--star-a': '232,236,255', '--star-b': '160,178,255', '--star-c': '206,190,255', '--glow': '122,140,255' } },
    { id: 'black', name: '순검정', vars: { '--base': '#050506', '--surface': '#0c0c0e', '--raised': '#151518', '--overlay': '#1b1b20', '--ink': '#f2f2f4', '--ink-2': '#a9a9b3', '--ink-3': '#6b6b76', '--iris': '#a3b1ff', '--iris-2': '#d3c6ff', '--iris-soft': 'rgba(163,177,255,.16)', '--mk-1': '#a3b1ff', '--mk-2': '#d3c6ff', '--mk-core': '#ffffff', '--mk-dim': '#26262e', '--star-a': '255,255,255', '--star-b': '190,200,255', '--star-c': '220,210,255', '--glow': '150,160,255' } },
    { id: 'graphite', name: '그래파이트', vars: { '--base': '#121417', '--surface': '#191c21', '--raised': '#22262c', '--overlay': '#2a2f36', '--ink': '#eceff3', '--ink-2': '#aab1bb', '--ink-3': '#737b86', '--iris': '#9ecbff', '--iris-2': '#c7e3ff', '--iris-soft': 'rgba(158,203,255,.16)', '--mk-1': '#9ecbff', '--mk-2': '#c7e3ff', '--mk-core': '#eceff3', '--mk-dim': '#2f3a46', '--star-a': '236,239,243', '--star-b': '158,203,255', '--star-c': '199,227,255', '--glow': '120,170,230' } },
    { id: 'forest', name: '깊은 숲', vars: { '--base': '#0a1210', '--surface': '#0f1916', '--raised': '#15221e', '--overlay': '#1b2b26', '--ink': '#e8f0ec', '--ink-2': '#a3b8ae', '--ink-3': '#6b8078', '--iris': '#7fd8a8', '--iris-2': '#bfe9d0', '--iris-soft': 'rgba(127,216,168,.16)', '--mk-1': '#7fd8a8', '--mk-2': '#bfe9d0', '--mk-core': '#e8f0ec', '--mk-dim': '#234034', '--star-a': '232,240,236', '--star-b': '127,216,168', '--star-c': '191,233,208', '--glow': '100,190,140' } },
    { id: 'ember', name: '잿불', vars: { '--base': '#120d0b', '--surface': '#1a1311', '--raised': '#241a17', '--overlay': '#2e211d', '--ink': '#f3ece7', '--ink-2': '#c0aea3', '--ink-3': '#84736a', '--iris': '#ffb27a', '--iris-2': '#ffd8b3', '--iris-soft': 'rgba(255,178,122,.16)', '--mk-1': '#ffb27a', '--mk-2': '#ffd8b3', '--mk-core': '#f3ece7', '--mk-dim': '#4a3129', '--star-a': '243,236,231', '--star-b': '255,178,122', '--star-c': '255,216,179', '--glow': '230,150,100' } },
    { id: 'violet', name: '보랏빛', vars: { '--base': '#0e0a16', '--surface': '#150f20', '--raised': '#1d152c', '--overlay': '#251b38', '--ink': '#efe9f7', '--ink-2': '#b3a6c7', '--ink-3': '#7a6d8f', '--iris': '#c39bff', '--iris-2': '#e6d4ff', '--iris-soft': 'rgba(195,155,255,.16)', '--mk-1': '#c39bff', '--mk-2': '#e6d4ff', '--mk-core': '#efe9f7', '--mk-dim': '#3a2a55', '--star-a': '239,233,247', '--star-b': '195,155,255', '--star-c': '230,212,255', '--glow': '170,130,240' } },
    // P18 2026-11-19 사용자 선택(확인용\테마-후보.html 「모두 다」) — 어두운 8
    { id: 'gold-night', name: '황금 밤', vars: { '--base': '#0a0b12', '--surface': '#10121b', '--raised': '#181a26', '--overlay': '#1f2231', '--ink': '#ecebe4', '--ink-2': '#b3ad9c', '--ink-3': '#7a7465', '--iris': '#e0b84f', '--iris-2': '#f5dc96', '--iris-soft': 'rgba(224,184,79,.15)', '--mk-1': '#e0b84f', '--mk-2': '#f5dc96', '--mk-core': '#fff6dc', '--mk-dim': '#3b3222', '--star-a': '245,236,214', '--star-b': '224,184,79', '--star-c': '245,220,150', '--glow': '200,160,70' } },
    { id: 'ocean', name: '심해', vars: { '--base': '#05121a', '--surface': '#0a1a24', '--raised': '#10242f', '--overlay': '#152d3a', '--ink': '#e3f1f4', '--ink-2': '#9dbcc4', '--ink-3': '#64838b', '--iris': '#4fd1c5', '--iris-2': '#7dd3fc', '--iris-soft': 'rgba(79,209,197,.15)', '--mk-1': '#4fd1c5', '--mk-2': '#7dd3fc', '--mk-core': '#e3f1f4', '--mk-dim': '#173a40', '--star-a': '220,245,248', '--star-b': '79,209,197', '--star-c': '125,211,252', '--glow': '60,180,190' } },
    { id: 'nord', name: '북극 밤', vars: { '--base': '#1b1f27', '--surface': '#222731', '--raised': '#2a303c', '--overlay': '#323947', '--ink': '#eceff4', '--ink-2': '#b5bfcf', '--ink-3': '#7d8799', '--iris': '#88c0d0', '--iris-2': '#b48ead', '--iris-soft': 'rgba(136,192,208,.16)', '--mk-1': '#88c0d0', '--mk-2': '#b48ead', '--mk-core': '#eceff4', '--mk-dim': '#3b4252', '--star-a': '236,239,244', '--star-b': '136,192,208', '--star-c': '180,142,173', '--glow': '120,170,190' } },
    { id: 'moonlight', name: '달빛', vars: { '--base': '#0c0e11', '--surface': '#121519', '--raised': '#1a1e23', '--overlay': '#22272d', '--ink': '#eef1f4', '--ink-2': '#aab2bc', '--ink-3': '#6f7782', '--iris': '#cfd8e3', '--iris-2': '#9fb3c8', '--iris-soft': 'rgba(207,216,227,.13)', '--mk-1': '#cfd8e3', '--mk-2': '#9fb3c8', '--mk-core': '#ffffff', '--mk-dim': '#2c323a', '--star-a': '240,244,248', '--star-b': '207,216,227', '--star-c': '159,179,200', '--glow': '170,185,205' } },
    { id: 'sakura-night', name: '밤 벚꽃', vars: { '--base': '#130b11', '--surface': '#1b1018', '--raised': '#251621', '--overlay': '#2f1c2a', '--ink': '#f6e9ef', '--ink-2': '#c9a9b8', '--ink-3': '#8c6d7b', '--iris': '#ff8fb8', '--iris-2': '#ffc6dc', '--iris-soft': 'rgba(255,143,184,.15)', '--mk-1': '#ff8fb8', '--mk-2': '#ffc6dc', '--mk-core': '#fff0f6', '--mk-dim': '#4a2238', '--star-a': '255,236,244', '--star-b': '255,143,184', '--star-c': '255,198,220', '--glow': '230,110,160' } },
    { id: 'wine', name: '와인', vars: { '--base': '#12070a', '--surface': '#1a0b10', '--raised': '#241118', '--overlay': '#2e1720', '--ink': '#f5e8eb', '--ink-2': '#c7a3ab', '--ink-3': '#8a6870', '--iris': '#e05a7a', '--iris-2': '#f2a7b8', '--iris-soft': 'rgba(224,90,122,.16)', '--mk-1': '#e05a7a', '--mk-2': '#f2a7b8', '--mk-core': '#fff0f3', '--mk-dim': '#4a1b27', '--star-a': '255,234,238', '--star-b': '224,90,122', '--star-c': '242,167,184', '--glow': '200,70,100' } },
    { id: 'mocha', name: '모카', vars: { '--base': '#14100d', '--surface': '#1c1612', '--raised': '#261e18', '--overlay': '#30261f', '--ink': '#f2ebe4', '--ink-2': '#c2b2a3', '--ink-3': '#85766a', '--iris': '#d4a373', '--iris-2': '#e9c9a0', '--iris-soft': 'rgba(212,163,115,.15)', '--mk-1': '#d4a373', '--mk-2': '#e9c9a0', '--mk-core': '#fbf3ea', '--mk-dim': '#45342a', '--star-a': '246,236,224', '--star-b': '212,163,115', '--star-c': '233,201,160', '--glow': '190,140,95' } },
    { id: 'neon', name: '사이버 네온', vars: { '--base': '#07060f', '--surface': '#0d0b18', '--raised': '#151226', '--overlay': '#1c1832', '--ink': '#eef0ff', '--ink-2': '#a9a8d0', '--ink-3': '#6c6a96', '--iris': '#00e5ff', '--iris-2': '#ff4fd8', '--iris-soft': 'rgba(0,229,255,.13)', '--mk-1': '#00e5ff', '--mk-2': '#ff4fd8', '--mk-core': '#ffffff', '--mk-dim': '#2a2350', '--star-a': '230,240,255', '--star-b': '0,229,255', '--star-c': '255,79,216', '--glow': '0,200,255' } },
    { id: 'ivory', name: '아이보리', vars: { '--base': '#faf6ee', '--surface': '#f2ecdf', '--raised': '#e9e1d0', '--overlay': '#e0d6c2', '--ink': '#2a241c', '--ink-2': '#655b4c', '--ink-3': '#978b78', '--iris': '#b0742e', '--iris-2': '#d9a75a', '--iris-soft': 'rgba(176,116,46,.14)', '--mk-1': '#b0742e', '--mk-2': '#d9a75a', '--mk-core': '#2a241c', '--mk-dim': '#d8ccb4', '--star-a': '70,55,35', '--star-b': '176,116,46', '--star-c': '217,167,90', '--glow': '200,150,80', '--line': 'rgba(60,40,10,.09)', '--line-2': 'rgba(60,40,10,.18)', '--ok': '#3f9a5c', '--warn': '#c9862b', '--bad': '#c4453f' } },
    { id: 'mist', name: '새벽 안개', vars: { '--base': '#eef2f6', '--surface': '#e3e9f0', '--raised': '#d8e0e9', '--overlay': '#cdd7e2', '--ink': '#1c2430', '--ink-2': '#4f5c6d', '--ink-3': '#8593a4', '--iris': '#3b74c9', '--iris-2': '#6f9be0', '--iris-soft': 'rgba(59,116,201,.13)', '--mk-1': '#3b74c9', '--mk-2': '#6f9be0', '--mk-core': '#1c2430', '--mk-dim': '#c0cbd8', '--star-a': '40,55,80', '--star-b': '59,116,201', '--star-c': '111,155,224', '--glow': '90,140,210', '--line': 'rgba(20,40,70,.09)', '--line-2': 'rgba(20,40,70,.18)', '--ok': '#2f9a5f', '--warn': '#c98a2b', '--bad': '#c8433f' } },
    { id: 'paper', name: '밝은 종이', vars: { '--base': '#f4f2ec', '--surface': '#ebe8e0', '--raised': '#e1ddd3', '--overlay': '#d8d3c7', '--ink': '#1d1b17', '--ink-2': '#5a5750', '--ink-3': '#8a867c', '--iris': '#3d5bd6', '--iris-2': '#7a5be0', '--iris-soft': 'rgba(61,91,214,.12)', '--mk-1': '#3d5bd6', '--mk-2': '#7a5be0', '--mk-core': '#1d1b17', '--mk-dim': '#c9c4b8', '--star-a': '40,40,60', '--star-b': '61,91,214', '--star-c': '122,91,224', '--glow': '61,91,214', '--line': 'rgba(0,0,0,.08)', '--line-2': 'rgba(0,0,0,.16)', '--ok': '#2f9a5f', '--warn': '#c98a2b', '--bad': '#c8433f' } },
    // P18 2026-11-19 — 밝은 4
    { id: 'sakura', name: '벚꽃 낮', vars: { '--line': 'rgba(0,0,0,.08)', '--line-2': 'rgba(0,0,0,.16)', '--ok': '#2f9a5f', '--warn': '#c98a2b', '--bad': '#c8433f', '--base': '#fbf4f6', '--surface': '#f5e9ed', '--raised': '#efdde3', '--overlay': '#e8d1d9', '--ink': '#2a1820', '--ink-2': '#6b4f5a', '--ink-3': '#a08590', '--iris': '#d6457a', '--iris-2': '#e886ad', '--iris-soft': 'rgba(214,69,122,.12)', '--mk-1': '#d6457a', '--mk-2': '#e886ad', '--mk-core': '#2a1820', '--mk-dim': '#e3c9d2', '--star-a': '70,30,50', '--star-b': '214,69,122', '--star-c': '232,134,173', '--glow': '214,69,122' } },
    { id: 'mint', name: '민트', vars: { '--line': 'rgba(0,0,0,.08)', '--line-2': 'rgba(0,0,0,.16)', '--ok': '#2f9a5f', '--warn': '#c98a2b', '--bad': '#c8433f', '--base': '#eff7f3', '--surface': '#e3f0e9', '--raised': '#d6e8de', '--overlay': '#c9e0d3', '--ink': '#13261d', '--ink-2': '#466556', '--ink-3': '#7f9a8c', '--iris': '#1f9d74', '--iris-2': '#3fbfa0', '--iris-soft': 'rgba(31,157,116,.12)', '--mk-1': '#1f9d74', '--mk-2': '#3fbfa0', '--mk-core': '#13261d', '--mk-dim': '#bcd6c8', '--star-a': '30,60,45', '--star-b': '31,157,116', '--star-c': '63,191,160', '--glow': '31,157,116' } },
    { id: 'sunset', name: '노을', vars: { '--line': 'rgba(0,0,0,.08)', '--line-2': 'rgba(0,0,0,.16)', '--ok': '#2f9a5f', '--warn': '#c98a2b', '--bad': '#c8433f', '--base': '#fcf3ea', '--surface': '#f6e7d9', '--raised': '#efdac8', '--overlay': '#e8cdb6', '--ink': '#2b1a10', '--ink-2': '#6e5040', '--ink-3': '#a3877a', '--iris': '#e0662f', '--iris-2': '#c2418a', '--iris-soft': 'rgba(224,102,47,.12)', '--mk-1': '#e0662f', '--mk-2': '#c2418a', '--mk-core': '#2b1a10', '--mk-dim': '#e2c7b2', '--star-a': '80,40,20', '--star-b': '224,102,47', '--star-c': '194,65,138', '--glow': '224,102,47' } },
    { id: 'sky', name: '맑은 하늘', vars: { '--line': 'rgba(0,0,0,.08)', '--line-2': 'rgba(0,0,0,.16)', '--ok': '#2f9a5f', '--warn': '#c98a2b', '--bad': '#c8433f', '--base': '#f1f6fc', '--surface': '#e5eef8', '--raised': '#d8e5f3', '--overlay': '#cbdcee', '--ink': '#122033', '--ink-2': '#475c75', '--ink-3': '#8195ad', '--iris': '#2a7de1', '--iris-2': '#18a9c9', '--iris-soft': 'rgba(42,125,225,.12)', '--mk-1': '#2a7de1', '--mk-2': '#18a9c9', '--mk-core': '#122033', '--mk-dim': '#c3d4e8', '--star-a': '30,50,80', '--star-b': '42,125,225', '--star-c': '24,169,201', '--glow': '42,125,225' } },
  ];

  const STAGES = [
    { id: 'sphere', name: '별의 구', desc: '3천 별이 구를 이루어 회전(현재)' },
    { id: 'iris', name: '별의 홍채', desc: '별 고리가 차등 회전, 동공이 열림' },
    { id: 'nebula', name: '성운', desc: '느리게 흐르는 별 구름' },
    { id: 'constellation', name: '별자리', desc: '별 120개와 가까운 별을 잇는 선' },
    { id: 'drift', name: '잔잔한 별밭', desc: '깜박이며 아주 천천히 흐르는 별' },
    { id: 'galaxy', name: '은하', desc: '비스듬히 기운 나선 은하가 천천히 돈다' },
    { id: 'warp', name: '워프', desc: '별이 정면에서 흘러나온다 · 작업 중엔 초공간' },
    { id: 'aurora', name: '오로라', desc: '빛의 커튼이 하늘을 가로질러 물결친다' },
    { id: 'helix', name: '이중나선', desc: '두 가닥이 꼬여 회전하는 별의 나선' },
    { id: 'fireflies', name: '반딧불', desc: '배회하던 반딧불이 점점 함께 깜박인다' },
    // 수학 묶음(P18, 2026-11-10 사용자 요청) — 조절 막대·수식은 stars.js IRIS_MATH 한 곳
    { id: 'rose', group: 'math', name: '장미 곡선', desc: 'r = cos(kθ) — 꽃잎 수를 고른다' },
    { id: 'lissajous', group: 'math', name: '리사주 곡선', desc: '두 진동의 주파수 비가 만드는 무늬' },
    { id: 'phyllotaxis', group: 'math', name: '해바라기 나선', desc: '황금각 137.5°로 놓이는 씨앗' },
    { id: 'lorenz', group: 'math', name: '로렌츠 끌개', desc: '나비 효과 — 혼돈의 궤적' },
    { id: 'fourier', group: 'math', name: '푸리에 원', desc: '원이 원 위를 돌며 하트를 그린다' },
    { id: 'primes', group: 'math', name: '소수 나선', desc: '색스 나선 위에서 소수만 밝게' },
    { id: 'sierpinski', group: 'math', name: '시에르핀스키', desc: '혼돈 게임이 만드는 프랙털' },
    { id: 'torusknot', group: 'math', name: '토러스 매듭', desc: '도넛 위를 p·q번 감는 매듭' },
    { id: 'tesseract', group: 'math', name: '4차원 정육면체', desc: '테서랙트가 4차원에서 회전' },
    { id: 'waves', group: 'math', name: '파동 간섭', desc: '여러 파원의 물결이 겹친 무늬' },
    { id: 'off', name: '없음', desc: '애니메이션 끔(성능 최소)' },
  ];
  return { MARKS, MARK_KEYFRAMES, FONTS, THEMES, STAGES };
})();
