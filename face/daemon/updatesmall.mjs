// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// updatesmall.mjs — 업데이트 곁일(P18 2026-11-25): ① 작은 업데이트 안내(update.json) 읽기 ② 데이터 요금이 드는 연결인지 ③ 구조판 풀기(별 프로세스).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+$/;
/** update.json 글(서명 확인 뒤) → { version, from, asset, sha256 }. 모양이 조금이라도 다르면 throw(구조판으로 간다).
 *  { schema:1, release:'2.1.6', face:{ version, asset, sha256, from } } — from = 이 구조판부터는 창만 바꾸면 된다. */
export function parseSmall(text, { release } = {}) {
  const j = JSON.parse(text), f = j?.face || {};
  if (j.schema !== 1 || j.release !== release || !SEMVER.test(String(j.release))) throw new Error('update.json release');
  if (!SEMVER.test(String(f.version)) || !SEMVER.test(String(f.from))) throw new Error('update.json version');
  if (!/^IRIS-Face_v\d+\.\d+\.\d+\.zip$/.test(String(f.asset)) || !/^[0-9a-f]{64}$/.test(String(f.sha256))) throw new Error('update.json asset');
  return { version: f.version, from: f.from, asset: f.asset, sha256: f.sha256 };
}

/** 지금 인터넷이 데이터 요금제(휴대폰 테더링 등)인가 → 'metered' | 'free' | 'unknown'. 윈도가 아는 값만 묻는다(밖으로 나가지 않음). */
export function netCost(timeoutMs = 15_000) {
  if (process.platform !== 'win32') return Promise.resolve('unknown');
  const ps = "$p=[Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile(); if($p){$c=$p.GetConnectionCost(); \"$($c.NetworkCostType) $($c.Roaming) $($c.OverDataLimit)\"}";
  return new Promise((resolve) => {
    let out = ''; let c; try { c = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return resolve('unknown'); }
    const t = setTimeout(() => { try { c.kill(); } catch {} resolve('unknown'); }, timeoutMs);
    c.stdout.on('data', (d) => { out += d; }); c.on('error', () => { clearTimeout(t); resolve('unknown'); });
    c.on('close', () => { clearTimeout(t); resolve(costWord(out)); });
  });
}
export const costWord = (out) => (/^\s*(Fixed|Variable)\b/i.test(out) || /\bTrue\b/i.test(out) ? 'metered' : /Unrestricted/i.test(out) ? 'free' : 'unknown');

if (process.argv[2] === '--extract' && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 앞의 await 를 쓰지 않는다 — update.mjs 가 이 파일을 부르므로 서로 기다리게 된다
  import('./update.mjs').then(({ extractZipFile }) => extractZipFile(process.argv[3], process.argv[4])).catch((e) => { console.error(e.message); process.exit(1); });
}
