// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
// 학교·회사 망(P18, 2026-11-18): Node 의 fetch 는 윈도 프록시 설정도, 윈도 신뢰 인증서(보안 검사 장비의 루트)도 쓰지 않아
// 그런 망에서는 업데이트 확인·중계기의 바깥 연결이 실패한다. 실행기(launch.mjs)가 맨 앞에서 이 함수로 자기 env 를 맞추면
// 그 뒤에 뜨는 데몬·중계기·CLI 가 모두 물려받는다.
//   NODE_USE_SYSTEM_CA=1 — 윈도 신뢰 목록도 믿는다(Node 24 실측)
//   HTTPS_PROXY + NODE_USE_ENV_PROXY=1 — 윈도 프록시로 나간다(NODE_USE_ENV_PROXY 가 없으면 fetch 가 HTTPS_PROXY 를 무시 — 실측)
//   NO_PROXY — 이 PC 안 주소(중계기 127.0.0.1·데몬)는 프록시를 거치지 않는다
// 프록시 찾기 = .NET GetSystemWebProxy(고정 프록시 + 자동 구성 스크립트 PAC + 자동 검색 WPAD). 설치 패키지 bootstrap.ps1·
// updater/agents.mjs 와 같은 규칙이다.
import { spawnSync } from 'node:child_process';

export const PROXY_PROBE_URL = 'https://downloads.claude.ai/';
const PROXY_PS = `$t=[Uri]'${PROXY_PROBE_URL}';$p=[System.Net.WebRequest]::GetSystemWebProxy();$u=$p.GetProxy($t);if($u -and $u.AbsoluteUri -ne $t.AbsoluteUri){$u.Authority}`;
const LOCAL = ['localhost', '127.0.0.1', '::1'];

/** 윈도에 설정된 프록시 'http://host:port' — 없거나 이미 HTTPS_PROXY 가 있으면 null. */
export function systemProxy({ env = process.env, platform = process.platform, spawnSyncFn = spawnSync } = {}) {
  if (platform !== 'win32' || env.HTTPS_PROXY || env.https_proxy) return null;
  try {
    const r = spawnSyncFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PROXY_PS], {
      encoding: 'utf8', timeout: 8000, windowsHide: true,
    });
    const out = String(r?.stdout ?? '').trim();
    return /^[A-Za-z0-9.\-[\]:]+:\d{1,5}$/.test(out) ? `http://${out}` : null;
  } catch {
    return null;
  }
}

/** env 를 제자리에서 맞추고 { proxy } 를 돌려준다(이미 정해진 값은 지킨다). */
export function applySystemNet(env = process.env, { proxyFn = systemProxy } = {}) {
  env.NODE_USE_SYSTEM_CA = env.NODE_USE_SYSTEM_CA || '1';
  const proxy = env.HTTPS_PROXY || env.https_proxy || proxyFn({ env }) || null;
  if (proxy) {
    env.HTTPS_PROXY = proxy;
    if (!env.HTTP_PROXY && !env.http_proxy) env.HTTP_PROXY = proxy;
    const have = String(env.NO_PROXY ?? env.no_proxy ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    env.NO_PROXY = [...new Set([...have, ...LOCAL])].join(',');
    env.NODE_USE_ENV_PROXY = '1';
  }
  return { proxy };
}
