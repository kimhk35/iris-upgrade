// IRIS Messenger · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Supa } from '../supa.mjs';
import { Contacts, parseInvite, INVITE_RE } from '../contacts.mjs';
import { b64, generateEntropy, deriveKeyPair, fingerprint } from '../keys.mjs';
import { startMock } from './_mockhub.mjs';

test('parseInvite: normalizes and validates IRIS-xxxx-xxxx-xxxx codes', () => {
  // ① 공백·소문자 정규화
  assert.deepEqual(parseInvite(' iris-ab2c-de3f-gh4j '), { code8: 'AB2CDE3F', fp4: 'GH4J', fp: 'GH4J', strong: false });
  // 그룹 수가 모자라면 null
  assert.equal(parseInvite('IRIS-AB2C-DE3F'), null);
  // 전각/변형 대시도 정규화
  assert.deepEqual(parseInvite('IRIS–AB2C–DE3F–GH4J'), { code8: 'AB2CDE3F', fp4: 'GH4J', fp: 'GH4J', strong: false });
});

function setupContacts(mock, stateDir) {
  const supa = new Supa({ url: mock.url, anonKey: 'anon-key' });
  supa.setSession({ access_token: 'at1', refresh_token: 'rt1', expires_at: Math.floor(Date.now() / 1000) + 9999, user: { id: 'u1', email: 'a@b.com' } });
  const identity = { fingerprint: 'ABCDEFGH' }; // 8자 표시용 대역(FP_ALPHABET 문자만) — createInvite 꼬리 확인용
  const contacts = new Contacts({ stateDir, supa, identity, me: () => 'u1' });
  return { supa, identity, contacts };
}

test('Contacts: invite codes, mutual accept, key pinning', async (t) => {
  const mock = await startMock();
  t.after(() => mock.close());
  const stateDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'iris-contacts-'));
  const { identity, contacts } = setupContacts(mock, stateDir);
  await contacts.load();

  // ② createInvite() 형식 일치, 뒤 4자 = 내 지문 앞 4자
  const invite = await contacts.createInvite();
  assert.match(invite, INVITE_RE);
  assert.equal(invite.slice(-4), identity.fingerprint.slice(0, 4));

  // 상대(u2) 쪽 초대 준비: 임의 키쌍 + 그 공개키 지문
  const otherKeys = deriveKeyPair(generateEntropy());
  const otherFp = fingerprint(otherKeys.publicRaw);
  const otherPub = b64.enc(otherKeys.publicRaw);
  mock.store.invites.set('BBBBBBBB', { owner_id: 'u2', display_name: '보라', public_key: otherPub, key_version: 1 });
  const goodInvite = `IRIS-BBBB-BBBB-${otherFp.slice(0, 4)}`;
  const badInvite = 'IRIS-BBBB-BBBB-ZZZZ';

  // ③ 지문 불일치 → throw, 서버 호출 순서 lookup_invite만(accept 호출 안 됨)
  mock.calls.invite.length = 0;
  await assert.rejects(() => contacts.acceptInvite(badInvite), /fingerprint mismatch/);
  assert.deepEqual(mock.calls.invite.map((c) => c.fn), ['lookup_invite']);
  assert.equal(contacts.get('u2'), null);

  // ④ 지문 일치 → accept_invite 호출, pin 저장, list()에 pending_out
  mock.calls.invite.length = 0;
  const accepted = await contacts.acceptInvite(goodInvite);
  assert.equal(accepted.id, 'u2');
  assert.equal(accepted.displayName, '보라');
  assert.deepEqual(mock.calls.invite.map((c) => c.fn), ['lookup_invite', 'accept_invite']);
  let entry = contacts.get('u2');
  assert.equal(entry.status, 'pending_out');
  assert.equal(entry.requestedByMe, true);
  assert.equal(entry.publicKey, otherPub);
  assert.deepEqual(Buffer.from(contacts.publicKeyOf('u2')), Buffer.from(otherKeys.publicRaw));
  const onDisk1 = JSON.parse(fssync.readFileSync(path.join(stateDir, 'contacts.json'), 'utf8'));
  assert.equal(onDisk1.pins.u2.publicKey, otherPub);

  // ⑤ mock에서 상대가 수락한 상태로 바꾼 뒤 sync() → accepted
  mock.store.contacts[0].status = 'accepted';
  mock.store.profiles.push({ id: 'u2', display_name: '보라', public_key: otherPub, key_version: 1 });
  await contacts.sync();
  entry = contacts.get('u2');
  assert.equal(entry.status, 'accepted');
  assert.equal(entry.keyChanged, false);

  // ⑥ 서버 public_key 바꾼 뒤 sync() → keyChanged true, publicKeyOf는 옛 값
  const newerKeys = deriveKeyPair(generateEntropy());
  const newerPub = b64.enc(newerKeys.publicRaw);
  mock.store.profiles[0].public_key = newerPub;
  mock.store.profiles[0].key_version = 2;
  await contacts.sync();
  entry = contacts.get('u2');
  assert.equal(entry.keyChanged, true);
  assert.deepEqual(Buffer.from(contacts.publicKeyOf('u2')), Buffer.from(otherKeys.publicRaw));
  // P18: 화면에 보일 새 고유번호 = 서버의 새 열쇠 것(예전 고유번호와 다름), 다른 번호로 확인하면 거절하고 고정값 그대로
  assert.equal(entry.liveFingerprint, fingerprint(newerKeys.publicRaw));
  assert.equal(entry.fingerprint, fingerprint(otherKeys.publicRaw));
  assert.throws(() => contacts.acceptKeyChange('u2', fingerprint(otherKeys.publicRaw)), /fingerprint mismatch/);
  assert.deepEqual(Buffer.from(contacts.publicKeyOf('u2')), Buffer.from(otherKeys.publicRaw));

  // ⑦ acceptKeyChange(보여 준 새 고유번호) → keyChanged false, 새 값
  contacts.acceptKeyChange('u2', entry.liveFingerprint);
  entry = contacts.get('u2');
  assert.equal(entry.keyChanged, false);
  assert.deepEqual(Buffer.from(contacts.publicKeyOf('u2')), Buffer.from(newerKeys.publicRaw));

  // ⑧ respond(id,'block') → blocked_by_me
  await contacts.respond('u2', 'block');
  entry = contacts.get('u2');
  assert.equal(entry.status, 'blocked_by_me');

  // ⑨ respond(id,'remove') → 목록에서 사라지고 pin 삭제
  await contacts.respond('u2', 'remove');
  assert.equal(contacts.get('u2'), null);
  assert.equal(contacts.list().some((c) => c.id === 'u2'), false);
  const onDisk2 = JSON.parse(fssync.readFileSync(path.join(stateDir, 'contacts.json'), 'utf8'));
  assert.equal(onDisk2.pins.u2, undefined);
});

test('Contacts.sync: 지문을 맞춰 본 적 없이 고정된 열쇠는 needsVerify 로 표시된다(TOFU)', async (t) => {
  const mock = await startMock();
  t.after(() => mock.close());
  const stateDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'iris-contacts-'));
  const { contacts } = setupContacts(mock, stateDir);
  await contacts.load();

  // 상대가 먼저 초대하고 내가 (다른 기기에서) 수락해 둔 관계 — 이 기기에는 pin 이 없다.
  const otherKeys = deriveKeyPair(generateEntropy());
  const otherPub = b64.enc(otherKeys.publicRaw);
  mock.store.contacts.push({ user_a: 'u1', user_b: 'u2', status: 'accepted', requested_by: 'u2', blocked_by: null });
  mock.store.profiles.push({ id: 'u2', display_name: '보라', public_key: otherPub, key_version: 1 });

  await contacts.sync();
  let entry = contacts.get('u2');
  assert.equal(entry.status, 'accepted');
  assert.equal(entry.keyChanged, false);
  assert.equal(entry.needsVerify, true, '서버에서 받아 그대로 고정한 열쇠');
  assert.deepEqual(Buffer.from(contacts.publicKeyOf('u2')), Buffer.from(otherKeys.publicRaw), '편지를 열 수는 있어야 한다');
  const onDisk = JSON.parse(fssync.readFileSync(path.join(stateDir, 'contacts.json'), 'utf8'));
  assert.equal(onDisk.pins.u2.pinnedBy, 'sync');
  assert.equal(onDisk.pins.u2.needsVerify, true);

  // 다시 sync() 해도 표식은 그대로 남는다(사람이 확인하기 전까지).
  await contacts.sync();
  assert.equal(contacts.get('u2').needsVerify, true);

  // 사용자가 지문을 직접 대조하고 "새 지문 확인"을 누르면 표식이 사라진다.
  await contacts.acceptKeyChange('u2');
  entry = contacts.get('u2');
  assert.equal(entry.needsVerify, false);
  assert.deepEqual(Buffer.from(contacts.publicKeyOf('u2')), Buffer.from(otherKeys.publicRaw), '열쇠 자체는 그대로');
  const after = JSON.parse(fssync.readFileSync(path.join(stateDir, 'contacts.json'), 'utf8'));
  assert.equal(after.pins.u2.needsVerify, undefined);
  assert.equal(after.pins.u2.pinnedBy, undefined);

  // 초대 코드로 지문을 맞춰 고정한 열쇠에는 애초에 표식이 붙지 않는다.
  await contacts.sync();
  assert.equal(contacts.get('u2').needsVerify, false);
});

test('Contacts.respond(accept): 받은 요청을 수락한 쪽의 고정도 needsVerify 로 표시된다', async (t) => {
  const mock = await startMock();
  t.after(() => mock.close());
  const stateDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'iris-contacts-'));
  const { contacts } = setupContacts(mock, stateDir);
  await contacts.load();

  // u2 가 내 초대 코드를 써서 요청해 온 상태 — u2 는 내 지문을 코드 뒤 4자로 봤지만
  // 나는 u2 의 지문을 아직 한 번도 대조하지 않았다.
  const otherKeys = deriveKeyPair(generateEntropy());
  const otherPub = b64.enc(otherKeys.publicRaw);
  mock.store.contacts.push({ user_a: 'u1', user_b: 'u2', status: 'pending', requested_by: 'u2', blocked_by: null });
  mock.store.profiles.push({ id: 'u2', display_name: '보라', public_key: otherPub, key_version: 1 });

  await contacts.respond('u2', 'accept');
  let entry = contacts.get('u2');
  assert.equal(entry.status, 'accepted');
  assert.equal(entry.needsVerify, true, '수락한 쪽도 지문을 확인하기 전이다');
  assert.deepEqual(Buffer.from(contacts.publicKeyOf('u2')), Buffer.from(otherKeys.publicRaw), '편지는 열 수 있어야 한다');
  const onDisk = JSON.parse(fssync.readFileSync(path.join(stateDir, 'contacts.json'), 'utf8'));
  assert.equal(onDisk.pins.u2.pinnedBy, 'accept');
  assert.equal(onDisk.pins.u2.needsVerify, true);

  // 지문을 직접 대조한 뒤 "새 지문 확인"을 누르면 표식이 사라진다.
  await contacts.acceptKeyChange('u2');
  entry = contacts.get('u2');
  assert.equal(entry.needsVerify, false);
  assert.deepEqual(Buffer.from(contacts.publicKeyOf('u2')), Buffer.from(otherKeys.publicRaw));
  await contacts.sync();
  assert.equal(contacts.get('u2').needsVerify, false, '다시 맞춰 봐도 표식이 되살아나지 않는다');
});

test('Contacts.acceptInvite: server accept_invite invalid/rate_limited/blocked → throws, no pin', async (t) => {
  const mock = await startMock();
  t.after(() => mock.close());
  const stateDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'iris-contacts-'));
  const { contacts } = setupContacts(mock, stateDir);
  await contacts.load();

  const otherKeys = deriveKeyPair(generateEntropy());
  const otherFp = fingerprint(otherKeys.publicRaw);
  mock.store.invites.set('CCCCCCCC', { owner_id: 'u3', display_name: '민준', public_key: b64.enc(otherKeys.publicRaw), key_version: 1 });
  const invite = `IRIS-CCCC-CCCC-${otherFp.slice(0, 4)}`;

  mock.store.acceptStatus = 'invalid';
  await assert.rejects(() => contacts.acceptInvite(invite), /invalid or expired invite/);
  assert.equal(contacts.get('u3'), null);

  mock.store.acceptStatus = 'rate_limited';
  await assert.rejects(() => contacts.acceptInvite(invite), /too many attempts, wait a minute/);
  assert.equal(contacts.get('u3'), null);

  mock.store.acceptStatus = 'blocked';
  await assert.rejects(() => contacts.acceptInvite(invite), /: blocked$/);
  assert.equal(contacts.get('u3'), null);

  assert.equal(mock.store.contacts.length, 0); // 셋 다 pending 계약 미충족 → contacts 행을 만들지 않음
});

// P18 점검(2026-11-11): 초대 코드 고유번호 16자(80비트). 옛 4자 코드도 계속 받는다.
test('parseInvite: 16자 고유번호(새 판)와 4자(옛 판)를 모두 읽고, 긴 쪽을 strong 으로 표시', () => {
  const p = parseInvite('IRIS-AB2C-DE3F-GH4J-KL5M-NP6Q-RS7T');
  assert.equal(p.code8, 'AB2CDE3F'); assert.equal(p.fp, 'GH4JKL5MNP6QRS7T'); assert.equal(p.strong, true);
  const old = parseInvite('IRIS-AB2C-DE3F-GH4J');
  assert.equal(old.fp, 'GH4J'); assert.equal(old.strong, false);
  assert.equal(parseInvite('IRIS-AB2C-DE3F-GH4J-KL5M'), null, '묶음이 모자라면 거절');
});

test('Contacts: 새 판 초대 코드 = 16자 고유번호, 서버가 앞 4자만 같은 가짜 열쇠를 주면 거절', async (t) => {
  const mock = await startMock();
  t.after(() => mock.close());
  const stateDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'iris-contacts16-'));
  const supa = new Supa({ url: mock.url, anonKey: 'anon-key' });
  supa.setSession({ access_token: 'at1', refresh_token: 'rt1', expires_at: Math.floor(Date.now() / 1000) + 9999, user: { id: 'u1', email: 'a@b.com' } });
  const myKeys = deriveKeyPair(generateEntropy());
  const identity = { fingerprint: fingerprint(myKeys.publicRaw), fingerprintLong: fingerprint(myKeys.publicRaw, 16) };
  const contacts = new Contacts({ stateDir, supa, identity, me: () => 'u1' });
  await contacts.load();
  const invite = await contacts.createInvite();
  assert.match(invite, INVITE_RE);
  assert.equal(parseInvite(invite).fp, identity.fingerprintLong, '코드 끝 16자 = 내 긴 고유번호');
  assert.equal(identity.fingerprintLong.slice(0, 8), identity.fingerprint, '긴 고유번호의 앞 8자 = 화면 고유번호');

  // 상대 진짜 열쇠의 16자 고유번호가 든 코드인데, 서버가 다른 열쇠를 돌려주면(바꿔치기) 거절
  const real = deriveKeyPair(generateEntropy()), fake = deriveKeyPair(generateEntropy());
  const code = `IRIS-CCCC-CCCC-${fingerprint(real.publicRaw, 16).match(/.{4}/g).join('-')}`;
  mock.store.invites.set('CCCCCCCC', { owner_id: 'u3', display_name: '가짜', public_key: b64.enc(fake.publicRaw), key_version: 1 });
  await assert.rejects(() => contacts.acceptInvite(code), /fingerprint mismatch/);
});
