// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// Gemini 사용량(P18, 2026-11-19 사용자 결정): agy 에는 사용량을 글로 내주는 명령이 없고(`agy -p /usage` 는 모델에게 질문으로 간다 — 쓰지 않는다),
// 대화창 안의 `/usage` 화면만 있다. 그래서 10분마다 agy 를 숨은 가상 터미널로 열어 /usage 화면을 읽고 닫는다 — 질문을 보내지 않으므로 사용량을 쓰지 않는다.
// 결과 = <state>\gemini-usage.json (대시보드 뷰어가 이 파일을 읽어 GEMINI 칸을 그린다) + GET /api/gemini/usage.
// 화면 모양이 바뀌어 못 읽으면 지난 값은 두고 error 를 적는다(화면은 「읽기 실패」). 검사 = `npm run verify:geminiusage`(실측 화면 글자 해석).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { trustGemini } from './trust.mjs';

const require = createRequire(import.meta.url);

/** 터미널 출력 → 글자만(색·커서 이동 코드 제거). */
export function cleanScreen(s) {
  return String(s || '').replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b[()][A-Z0-9]/g, '').replace(/\r/g, '');
}

/** "145h 49m"·"2d 3h"·"16m" → 밀리초. 못 읽으면 null. */
export function parseDuration(s) {
  const t = String(s || ''); let ms = 0, hit = false;
  for (const [re, k] of [[/(\d+)\s*d/, 86400000], [/(\d+)\s*h/, 3600000], [/(\d+)\s*m(?!s)/, 60000]]) { const m = re.exec(t); if (m) { ms += Number(m[1]) * k; hit = true; } }
  return hit ? ms : null;
}

/**
 * /usage 화면 글자 → { account, plan, groups:[{ key, label, h5:{left,resetAt}, d7:{left,resetAt} }] }. 못 읽으면 null.
 * 묶음 머리글(대문자 줄 + 다음 줄이 "Models within this group" 또는 설명) 아래의 막대들을 그 묶음에 붙인다. left = 남은 비율(0~1).
 * key: 'gemini'(GEMINI MODELS) · 'other'(CLAUDE AND GPT MODELS) · 'extra'(그 밖 — 지금은 GEMINI 4 ARGON).
 */
export function parseUsage(text, now = Date.now()) {
  const t = cleanScreen(text);
  if (!/Limit/.test(t)) return null;
  const heads = [];
  for (const m of t.matchAll(/([A-Z][A-Z0-9 &.]{3,40}?)\s*\n\s+(?:Models within this group|For paid|For free)/g)) heads.push({ at: m.index, label: m[1].trim() });
  if (!heads.length) return null;
  const groups = heads.map((h) => ({ key: h.label === 'GEMINI MODELS' ? 'gemini' : /CLAUDE|GPT/.test(h.label) ? 'other' : 'extra', label: h.label, at: h.at, h5: null, d7: null }));
  const BAR = /(Weekly Limit Remaining|Five Hour Limit Remaining|[A-Za-z0-9 .]+ Weekly Limit|[A-Za-z0-9 .]+ Five Hour Limit)\s*\[[^\]]*\]\s*([\d.]+)%\s*(Refreshes in ([0-9dhm ]+)|Quota available)?/g;
  for (const m of t.matchAll(BAR)) {
    const g = [...groups].reverse().find((x) => x.at < m.index); if (!g) continue;
    const kind = /Five Hour/.test(m[1]) ? 'h5' : 'd7';
    const left = Number(m[2]) / 100; if (!Number.isFinite(left)) continue;
    const dur = m[4] ? parseDuration(m[4]) : null;
    g[kind] = { left: Math.max(0, Math.min(1, left)), resetAt: dur != null ? now + dur : null };
  }
  const out = groups.filter((g) => g.h5 || g.d7).map(({ at, ...g }) => g);
  if (!out.length) return null;
  const acc = /Account:\s*([A-Za-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z]{2,})+)/.exec(t); // 뒤에 다음 머리글(대문자)이 붙어 올 수 있다
  const plan = /\((Google AI [A-Za-z ]+?)\)/.exec(t);
  return { account: acc ? acc[1] : null, plan: plan ? plan[1] : null, groups: out };
}

const writeAtomic = (file, text) => { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); };

export class GeminiUsage {
  /** opts: stateDir · agyExe() → 경로|null · agyHome · env() → 자식 환경 · log · intervalMs(기본 10분) · firstDelayMs(기본 8초) · spawn(시험용 가짜 pty) */
  constructor({ stateDir, agyExe, agyHome, env = () => process.env, log = () => {}, intervalMs = 600000, firstDelayMs = 8000, spawn = null }) {
    Object.assign(this, { stateDir, agyExe, agyHome, env, log, intervalMs, firstDelayMs });
    this.file = path.join(stateDir, 'gemini-usage.json');
    this.dir = path.join(stateDir, 'agy-usage'); // 읽을 때 agy 를 여는 빈 폴더(미리 믿는 폴더로 적어 둔다)
    this.spawn = spawn || ((exe, args, o) => require('node-pty').spawn(exe, args, o));
    this.running = null; this.timer = null;
    try { this.value = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.value = null; }
  }
  start() {
    if (this.timer || !(this.intervalMs > 0)) return;
    this.first = setTimeout(() => this.refresh().catch(() => {}), this.firstDelayMs); this.first.unref?.();
    this.timer = setInterval(() => this.refresh().catch(() => {}), this.intervalMs); this.timer.unref?.();
  }
  stop() { clearTimeout(this.first); clearInterval(this.timer); this.timer = null; }
  get() { let installed = false; try { installed = !!this.agyExe(); } catch {} return { ...(this.value || { ok: false, error: 'not-yet' }), installed }; }
  save(v) { this.value = v; try { fs.mkdirSync(this.stateDir, { recursive: true }); writeAtomic(this.file, JSON.stringify(v, null, 2)); } catch (e) { this.log(`gemini usage: 저장 실패 ${e.message}`); } }
  /** 한 번 읽기(동시에 두 번 돌지 않음). 결과를 저장하고 돌려준다. */
  refresh() {
    if (this.running) return this.running;
    this.running = this.readOnce().then((r) => {
      const now = Date.now();
      if (r.ok) this.save({ ok: true, at: now, ...r.data });
      else { const prev = this.value?.ok || this.value?.groups ? this.value : null; this.save({ ...(prev || {}), ok: false, error: r.error, errorAt: now }); }
      this.log(`gemini usage: ${r.ok ? `ok ${r.data.groups.map((g) => `${g.key} 5h=${g.h5 ? Math.round(g.h5.left * 100) : '-'}% 7d=${g.d7 ? Math.round(g.d7.left * 100) : '-'}%`).join(' · ')}` : `실패 ${r.error}`}`);
      return this.value;
    }).finally(() => { this.running = null; });
    return this.running;
  }
  readOnce() {
    const exe = this.agyExe(); if (!exe) return Promise.resolve({ ok: false, error: 'agy-missing' });
    try { fs.mkdirSync(this.dir, { recursive: true }); trustGemini(this.dir, this.agyHome); } catch {}
    return new Promise((resolve) => {
      let buf = '', since = 0, phase = 'boot', done = false, exited = false, p = null, lastData = Date.now();
      const timers = [];
      const at = (ms, f) => timers.push(setTimeout(f, ms));
      const finish = (r) => {
        if (done) return; done = true; timers.forEach(clearTimeout); clearInterval(poll);
        try { p.write('\x1b'); } catch {}
        setTimeout(() => { try { p.write('\x03'); } catch {} }, 300);
        setTimeout(() => { try { p.write('\x03'); } catch {} }, 700);
        setTimeout(() => { if (!exited) try { p.kill(); } catch {} }, 2500); // 이미 스스로 닫혔으면 kill 하지 않는다(node-pty 의 AttachConsole failed 잡음)
        resolve(r);
      };
      try { p = this.spawn(exe, [], { name: 'xterm-256color', cols: 160, rows: 60, cwd: this.dir, env: this.env() }); }
      catch (e) { resolve({ ok: false, error: `spawn: ${e.message}` }); return; }
      p.onData((d) => { buf += d; lastData = Date.now(); });
      p.onExit?.(() => { exited = true; if (!done) finish({ ok: false, error: phase === 'boot' ? 'agy-exited' : 'agy-exited-early' }); });
      const poll = setInterval(() => {
        const t = cleanScreen(buf);
        if (phase === 'boot') {
          if (/Do you trust the contents/.test(t)) return finish({ ok: false, error: 'trust-prompt' });
          if (/sign in|log in|login/i.test(t) && !/for shortcuts/.test(t)) return finish({ ok: false, error: 'login-needed' });
          if (/for shortcuts/.test(t)) {
            phase = 'typing';
            at(800, () => { try { p.write('\x1b'); } catch {} });          // 「Introducing …」 같은 안내 띠 닫기
            at(1400, () => { try { p.write('/usage'); } catch {} });
            at(2800, () => { since = buf.length; phase = 'wait'; try { p.write('\r'); } catch {} });
          }
        } else if (phase === 'wait') {
          const tail = cleanScreen(buf.slice(since));
          if (/Five Hour Limit/.test(tail) && /Weekly Limit/.test(tail) && Date.now() - lastData > 1200) {
            const data = parseUsage(tail);
            finish(data ? { ok: true, data } : { ok: false, error: 'parse-failed' });
          }
        }
      }, 300);
      at(45000, () => finish({ ok: false, error: phase === 'boot' ? 'boot-timeout' : 'usage-timeout' }));
    });
  }
}
