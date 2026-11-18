---
id: iris:oqscbv6v
type: project
code: P04
status_scheme: task5
lifecycle: active
tags:
- {kind: 소프트웨어/산출물 종류, value: Local App}
- {kind: 소프트웨어/산출물 종류, value: Web}
drawers: [docs]
aliases: ['P04-IRIS 메신저(IRIS-Messenger) 〖Local App〗〖Web〗', 'R07-개발자(Developer)\D06-오픈소스(Open Source)\P04-IRIS 메신저(IRIS-Messenger) 〖Local App〗〖Web〗']
relations:
  canonical: ['iris:wkknzac5/AGENTS.md']
created: '2026-09-11'
---
# P04-아이리스 메신저(IRIS-Messenger) 〖Local App〗〖Web〗

IRIS-Face(P02)에 꽂는 **첫 번째 확장 모듈** — Face 사용자끼리 글·파일을 주고받는 메신저(1차 = 사람→사람, 2차 = 에이전트→에이전트 요청·결과, 수신자 승인 뒤). Face 본체는 이 모듈을 모르며, 본체의 접점(계약 v1: `panel`·`badge`·`notify`·`queue`)에만 닿는다. 서버는 사용자 작업 내용·과정·세션 기록을 **절대 받지 않고**, 메시지는 종단간 암호화(E2EE) 암호문으로만 지난다.

- 구조: `module\`(Face `modules\messenger\`에 복사되는 클라이언트: 화면·배지·파일 첨부) · `hub\server\`(Supabase 표·RLS 정책·청소·운영·처리방침·셋업 README) · `hub\client\`(로그인·토큰 보관·E2EE 열쇠·연결·연락처 공용 라이브러리) · `scripts\`(배포 밖 실사용 검증·릴리스 zip 빌드 도구) · `dist\`(빌드 산출물, git 제외) · `.github\`(keepalive 등 워크플로) · `docs\`(설계·검증 기록). **`hub\`는 `module\`을 참조하지 않는다**(반대 방향만) — 다음 모듈이 생기면 `hub\`를 통째로 새 P로 떼어낸다. 두 가지 실사용 검사는 `npm run verify:rls`(RLS·속도제한·Storage·연락처 정책을 실제 허브에 대고 확인)와 `npm run verify:e2e`(두 계정 간 실사용 종단 흐름 확인)다 — 둘 다 살아 있는 허브가 필요하며 코드만 읽어서는 대체할 수 없다.
- 정본: 설계 = `docs\설계.md`(2026-09-11 조각 점검, 사용자 확정분만 기록). Face 쪽 접점 계약 정본은 P02 `docs\모듈-계약-v1.md`(여기서 재서술 금지).
- 확정 결정(2026-09-11): 기반 = 자체 허브(Supabase) · 1차 범위 = 사람→사람 글·파일 · E2EE 처음부터 · 이메일 매직링크 · 초대 코드 상호 수락 · 공식 허브는 사용자 Supabase 무료로 시작 + 모듈 설정에 서버 주소 칸 · 사용자당 열쇠 하나 + 백업 문구 · 모듈 = 별 프로세스(본체와 stdio 계약으로만 대화) · 불변 = 모듈 없는 Face는 네트워크 호출 0(기계 증명).
- 공개: MIT, 공개 저장소 이름 `d06-p04-iris-messenger`(스택은 첫 푸시 전 `.stack` 바인딩으로 확정). 서버 코드도 공개해 누구나 자기 Supabase에 세울 수 있게 한다. `service role key`는 어디에도 넣지 않는다.

<!-- 상위(루트/R07/D09) AGENTS.md 규칙 재서술 금지 -->
- **P18 보안 수정**(2026-11-11 점검): ① 초대 코드 고유번호 = 16자(80비트, `IRIS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`) — 옛 4자 코드도 받되 대조는 코드에 실린 길이만큼(`parseInvite().fp`), 앞 8자 = 화면 고유번호 ② 열쇠가 바뀌면 연락처 항목 `liveFingerprint`(새 열쇠)를 화면이 크게 보이고 「새 고유번호 확인」은 그 값을 `fingerprint` 로 돌려보내야 저장(`acceptKeyChange(id, expectFp)`) ③ 새 PC 「시작」은 서버에 내 프로필 열쇠가 있으면 `account exists` 로 거절 — 되살리기(12단어) 또는 경고를 거치는 「열쇠 재설정」만 ④ 열지 못한 편지는 `item.sealed`(암호문)로 보관, 「새 고유번호 확인」·「수락」 뒤 `Messages.reopen(peer)` ⑤ 받은 파일 = Mark-of-the-Web(ZoneId=3) + 이름에서 끝 점·예약 이름·글자 방향 문자 제거. 남은 것(서버 측): 사용자별 용량·속도 제한, `created_at`·`delivered_at` 칸 권한 — 살아 있는 허브로 `verify:rls` 를 거쳐야 해 미룸.
