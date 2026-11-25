// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// healthcheck.mjs — IRIS 건강 점검(P18 2026-11-25 4차 8번): 로그인·인터넷·시계·저장 공간·메모리·문서 프로그램·계정 연결·업데이트를 한 번에.
// 읽기만 한다. 밖으로는 「열리는지」만 확인하고(내용 없는 HEAD) 아무것도 보내지 않으며, 열쇠 값·계정 이름·경로는 결과에 싣지 않는다.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

const GB = 1024 ** 3;
export const SITES = [['Claude', 'https://api.anthropic.com/'], ['Codex', 'https://chatgpt.com/'], ['업데이트', 'https://github.com/']];

/** 주소 하나가 열리나 → { ok, date }. 어떤 응답이든 오면 열린 것(401·403·404 도). */
export async function reach(url, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  try { const r = await fetchImpl(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'iris-face' } }); return { ok: true, date: Date.parse(r.headers.get('date') || '') || null }; }
  catch { return { ok: false, date: null }; }
}
const portOpen = (port) => new Promise((resolve) => { const s = net.connect({ host: '127.0.0.1', port }); const end = (v) => { s.destroy(); resolve(v); }; s.setTimeout(1500, () => end(false)); s.once('connect', () => end(true)); s.once('error', () => end(false)); });
/** 윈도에 그 프로그램이 깔려 있나(자동화 이름 등록 여부만 본다 — 프로그램을 띄우지 않는다). */
function hasApp(progid) {
  return new Promise((resolve) => {
    let c; try { c = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'), ['query', `HKCR\\${progid}\\CLSID`], { windowsHide: true, stdio: 'ignore' }); } catch { return resolve(false); }
    const t = setTimeout(() => { try { c.kill(); } catch {} resolve(false); }, 5000);
    c.on('error', () => { clearTimeout(t); resolve(false); }); c.on('close', (code) => { clearTimeout(t); resolve(code === 0); });
  });
}

/** ctx = { root, stateDir, agents(){missing,accounts}, auth(){items}|null, memory()|null, docPython()→bool, dashPort|null, proxyPort|null, update(){…} } — 모자라면 그 항목을 건너뛴다.
 *  → [{ id, label, level:'ok'|'warn'|'bad'|'info', text, fix?, go? }] · go = 설정 묶음 이름 또는 'dash' */
export async function runHealth(ctx, deps = {}) {
  const { fetchImpl, has = hasApp, port = portOpen, statfs = fs.statfsSync, now = Date.now } = deps;
  const out = []; const add = (id, label, level, text, fix, go) => out.push({ id, label, level, text, ...(fix ? { fix } : {}), ...(go ? { go } : {}) });
  const net3 = await Promise.all(SITES.map(([, u]) => reach(u, { ...(fetchImpl ? { fetchImpl } : {}) })));
  const down = SITES.filter((_, i) => !net3[i].ok).map(([n]) => n);
  if (!down.length) add('net', '인터넷', 'ok', 'Claude·Codex·업데이트 서버가 모두 열려요.');
  else if (down.length === SITES.length) add('net', '인터넷', 'bad', '인터넷에 연결되지 않았어요.', '와이파이나 랜선을 확인해 주세요. 학교 망이면 프록시·방화벽에 막혔을 수 있어요(전산 담당자께 문의).');
  else add('net', '인터넷', 'warn', `${down.join('·')} 쪽 서버가 열리지 않아요.`, '학교·회사 망에서 그 주소를 막았을 수 있어요. 휴대폰 연결로 바꿔 열리면 망 문제예요.');
  const date = net3.find((r) => r.date)?.date;
  if (date) { const m = Math.round(Math.abs(now() - date) / 60000); if (m >= 5) add('clock', '컴퓨터 시계', 'bad', `시계가 ${m}분 어긋나 있어요. 로그인이 실패할 수 있어요.`, '윈도 설정 → 시간 및 언어 → 날짜 및 시간 → 「지금 동기화」를 눌러 주세요.'); else add('clock', '컴퓨터 시계', 'ok', '시계가 맞아요.'); }

  const ag = ctx.agents?.() || {}, miss = ag.missing || [], acc = ag.accounts || null;
  const NAME = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
  const gone = miss.filter((k) => k === 'claude' || k === 'codex'), empty = acc ? ['claude', 'codex'].filter((k) => acc[k] === 0 && !gone.includes(k)) : [];
  if (gone.length) add('cli', 'AI 프로그램', 'bad', `${gone.map((k) => NAME[k]).join('·')} 프로그램이 없어요.`, 'IRIS 설치 파일을 다시 실행하면 받아요(내 자료는 그대로).');
  else if (empty.length === 2) add('cli', 'AI 프로그램', 'bad', '연결된 계정이 하나도 없어요.', '대시보드에서 계정을 추가해 주세요.', 'dash');
  else add('cli', 'AI 프로그램', 'ok', empty.length ? `${NAME[['claude', 'codex'].find((k) => !empty.includes(k))]}를 쓸 수 있어요(${empty.map((k) => NAME[k]).join('·')} 계정은 없음).` : 'Claude·Codex 프로그램이 있어요.');
  const items = ctx.auth?.()?.items || null;
  if (items) {
    const dead = items.filter((i) => !i.optional && i.level === 'expired'), soon = items.filter((i) => !i.optional && i.level === 'soon');
    if (dead.length) add('login', '로그인', 'bad', `${dead.length}개의 로그인이 만료됐어요.`, '설정 → 계정에서 「갱신」을 눌러 주세요.', 'account');
    else if (soon.length) add('login', '로그인', 'warn', `${soon.length}개의 로그인이 곧 만료돼요.`, '설정 → 계정에서 「갱신」을 눌러 주세요.', 'account');
    else add('login', '로그인', 'ok', '로그인이 살아 있어요.');
  }
  if (ctx.proxyPort) { if (await port(ctx.proxyPort)) add('relay', '계정 연결 도구', 'ok', '켜져 있어요.'); else add('relay', '계정 연결 도구', 'bad', '꺼져 있어 AI와 연결되지 않아요.', 'IRIS를 완전히 껐다(전부 종료) 다시 켜 주세요.'); }

  try {
    const s = statfs(ctx.root), free = s.bavail * s.bsize, t = `${(free / GB).toFixed(1)}GB 남았어요.`;
    if (free < 2 * GB) add('disk', '저장 공간', 'bad', t, '휴지통을 비우거나 큰 파일을 옮겨 주세요. 2GB보다 적으면 AI가 파일을 못 만들 수 있어요.');
    else if (free < 5 * GB) add('disk', '저장 공간', 'warn', t, '업데이트에는 5GB쯤 여유가 있으면 좋아요.'); else add('disk', '저장 공간', 'ok', t);
  } catch { add('disk', '저장 공간', 'info', '확인하지 못했어요.'); }
  try { const f = path.join(ctx.stateDir, `.health-${process.pid}`); fs.writeFileSync(f, 'x'); fs.rmSync(f); add('write', '기록 저장', 'ok', '설정과 기록을 저장할 수 있어요.'); }
  catch { add('write', '기록 저장', 'bad', 'IRIS 폴더에 쓸 수 없어요.', '백신(랜섬웨어 보호)이 막았을 수 있어요. IRIS 폴더를 예외로 넣어 주세요.'); }
  const mem = ctx.memory?.();
  if (mem && Number.isFinite(mem.freeGB)) { const t = `쓸 수 있는 메모리 ${mem.freeGB.toFixed(1)}GB.`; if (mem.freeGB < 1) add('mem', '메모리', 'bad', t, '쓰지 않는 대화를 끝내거나 다른 프로그램을 닫아 주세요.'); else if (mem.freeGB < 2.5) add('mem', '메모리', 'warn', t, '대화를 여러 개 열면 느려질 수 있어요.'); else add('mem', '메모리', 'ok', t); }

  const [word, ppt, xls, hwp, hshow] = await Promise.all(['Word.Application', 'PowerPoint.Application', 'Excel.Application', 'HWPFrame.HwpObject', 'HShow.Application'].map((x) => has(x)));
  const no = [!word && '워드', !ppt && !hshow && 'PPT', !xls && '엑셀', !hwp && '한/글'].filter(Boolean);
  if (ctx.docPython && !ctx.docPython()) add('doc', '문서 보기', 'bad', '문서를 바꾸는 도구가 없어요.', 'IRIS 설치 파일을 다시 실행하면 채워져요.');
  else if (no.length) add('doc', '문서 보기', 'info', `${no.join('·')} 프로그램이 없어 그 문서는 캔버스에서 미리 볼 수 없어요.`, '그 프로그램이 있는 PC에서는 저절로 보여요.');
  else add('doc', '문서 보기', 'ok', '워드·PPT·엑셀·한/글 문서를 볼 수 있어요.');

  const u = ctx.update?.();
  if (u && u.mode === 'package') {
    if (u.checkError) add('update', '업데이트', 'warn', '새 판을 확인하지 못했어요.', '인터넷을 확인한 뒤 「지금 확인」을 눌러 주세요.', 'about');
    else if (u.headline?.version) add('update', '업데이트', 'warn', `새 판 ${u.headline.version}이 있어요.`, u.plan ? '받아 두었어요. 「적용」을 눌러 주세요.' : '「업데이트」를 눌러 주세요.', 'about');
    else add('update', '업데이트', 'ok', `최신 판이에요(${u.installed?.package || ''}).`);
  }
  const rank = { bad: 0, warn: 1, info: 2, ok: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
