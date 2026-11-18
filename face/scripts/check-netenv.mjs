// 검사: 학교·회사 망 대비(daemon/netenv.mjs) — 윈도 신뢰 목록·윈도 프록시를 실행기 env 에 맞추는지.
// 가짜 프록시로 "정말 프록시를 거치는지"까지 본다(인터넷·실 데몬 접촉 0). npm run verify:netenv
import http from 'node:http';
import { spawn } from 'node:child_process';
import { systemProxy, applySystemNet } from '../daemon/netenv.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n); } };

// 1) 프록시 없는 PC: 윈도 신뢰 목록만 켠다
{
  const env = {};
  const r = applySystemNet(env, { proxyFn: () => null });
  ok(env.NODE_USE_SYSTEM_CA === '1' && r.proxy === null && !env.HTTPS_PROXY && !env.NODE_USE_ENV_PROXY, '프록시 없음 = 윈도 신뢰 목록만 켬');
}
// 2) 윈도 프록시가 있으면 HTTPS_PROXY·HTTP_PROXY·NODE_USE_ENV_PROXY + 이 PC 안 주소는 예외
{
  const env = { NO_PROXY: 'intra.school.kr' };
  const r = applySystemNet(env, { proxyFn: () => 'http://proxy.school.kr:8080' });
  ok(r.proxy === 'http://proxy.school.kr:8080' && env.HTTPS_PROXY === r.proxy && env.HTTP_PROXY === r.proxy && env.NODE_USE_ENV_PROXY === '1', '윈도 프록시 = HTTPS_PROXY + NODE_USE_ENV_PROXY');
  ok(env.NO_PROXY === 'intra.school.kr,localhost,127.0.0.1,::1', '원래 예외 유지 + 이 PC 안 주소(중계기·데몬) 예외');
}
// 3) 사용자가 이미 정한 HTTPS_PROXY 는 그대로(윈도에 묻지 않음)
{
  let asked = 0;
  const env = { HTTPS_PROXY: 'http://my:3128', HTTP_PROXY: 'http://other:1' };
  applySystemNet(env, { proxyFn: () => { asked++; return 'http://x:1'; } });
  ok(env.HTTPS_PROXY === 'http://my:3128' && env.HTTP_PROXY === 'http://other:1' && asked === 0 && env.NODE_USE_ENV_PROXY === '1', '이미 정한 프록시는 지키고 켜기만');
}
// 4) systemProxy: 파워셸 출력 해석
{
  const fake = (out) => () => ({ stdout: out });
  ok(systemProxy({ env: {}, platform: 'win32', spawnSyncFn: fake('10.0.0.1:3128\r\n') }) === 'http://10.0.0.1:3128', 'host:port 를 받음');
  ok(systemProxy({ env: {}, platform: 'win32', spawnSyncFn: fake('') }) === null, '빈 출력 = 프록시 없음');
  ok(systemProxy({ env: {}, platform: 'win32', spawnSyncFn: fake('오류 글자') }) === null, '이상한 출력은 버림');
  ok(systemProxy({ env: {}, platform: 'win32', spawnSyncFn: () => { throw new Error('x'); } }) === null, '파워셸 실패 = 없음');
}
// 5) 이 PC 에서 진짜로 물어보기(학교가 아니면 보통 없음) — 시간만 잰다
{
  const t = Date.now();
  const p = systemProxy({ env: {} });
  ok(p === null || /^http:\/\/\S+:\d+$/.test(p), `이 PC 실제 조회 = ${p ?? '없음'} (${Date.now() - t}ms)`);
}
// 6) 맞춘 env 로 띄운 Node 의 fetch 가 실제로 프록시를 거친다(가짜 학교 프록시)
{
  const seen = [];
  const proxy = http.createServer((q, s) => { s.writeHead(405); s.end(); });
  proxy.on('connect', (req, sock) => { seen.push(req.url); sock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(https?|no)_proxy$/i.test(k) && !/^NODE_USE_/.test(k)));
  applySystemNet(env, { proxyFn: () => `http://127.0.0.1:${proxy.address().port}` });
  const code = "try { await fetch('https://api.github.com/repos/x/y/releases/latest', { signal: AbortSignal.timeout(5000) }); } catch {} " +
    "try { await fetch('http://127.0.0.1:9/', { signal: AbortSignal.timeout(2000) }); } catch {}";
  await new Promise((res) => spawn(process.execPath, ['--input-type=module', '-e', code], { env, stdio: 'ignore' }).on('close', res));
  proxy.close();
  ok(seen.length === 1 && seen[0] === 'api.github.com:443', `바깥 주소만 프록시를 거침 (${JSON.stringify(seen)})`);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
