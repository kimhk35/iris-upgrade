// IRIS-Face · © 2026 Sejun Ham (함세준) · MIT · https://feynman520.github.io/card/#home
/* 새 PC 로 옮기기 화면(설정 → 업데이트·정보, P18 2026-11-24 고도화 10번) + 윈도 계정 나누기 안내(15번). 규칙은 데몬 migrate.mjs. */
window.Migrate = (() => {
  const $ = (s) => document.querySelector(s);
  let opts = {}, busy = false;
  const H = () => opts.headers?.() || {};
  const clear = () => { for (const s of ['#mg-pw1', '#mg-pw2', '#mg-pw3']) if ($(s)) $(s).value = ''; if ($('#mg-file')) $('#mg-file').value = ''; };
  async function wrap(btn, text, fn) { if (busy) return; busy = true; const b = $(btn), old = b.textContent; b.textContent = text; b.disabled = true; try { await fn(); } catch (e) { Dialog.alert(e.message); } finally { busy = false; b.textContent = old; b.disabled = false; } }
  const make = () => wrap('#mg-make', '만드는 중…', async () => {
    const parts = ['settings', 'records', 'folders'].filter((k) => $(`#mg-${k}`).checked), pw = $('#mg-pw1').value;
    if ([...pw].length < 8) throw new Error('암호는 8글자 이상으로 정해 주세요.'); if (pw !== $('#mg-pw2').value) throw new Error('두 번 적은 암호가 달라요.');
    const r = await fetch('/api/migrate/make', { method: 'POST', headers: { 'content-type': 'application/json', ...H() }, body: JSON.stringify({ parts, password: pw }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error);
    clear(); await Dialog.alert(`다운로드 폴더에 저장했어요.\n${j.name}\n\n대화 ${j.count.sessions}개${j.count.skipped ? `(너무 커서 뺀 것 ${j.count.skipped}개)` : ''} · 폴더 ${j.count.folders}개\n\n암호를 잊으면 이 묶음은 열 수 없어요. 이 PC의 원본은 그대로예요.`);
  });
  const open = () => wrap('#mg-open', '푸는 중…', async () => {
    const f = $('#mg-file').files[0], pw = $('#mg-pw3').value; if (!f) throw new Error('옮기기 묶음(.irispack)을 골라 주세요.'); if (!pw) throw new Error('묶음 암호를 적어 주세요.');
    if (f.size > 1.2e9) throw new Error('묶음이 너무 커요.');
    if (!(await Dialog.confirm('묶음을 이 PC에 풀까요?\n이미 있는 폴더·대화·서식은 덮지 않아요. 화면 설정은 묶음의 것으로 바뀌어요.', { okLabel: '풀기' }))) return;
    const r = await fetch('/api/migrate/open', { method: 'POST', headers: { 'x-pack-password': encodeURIComponent(pw), ...H() }, body: f }); const j = await r.json(); if (!r.ok) throw new Error(j.error);
    clear(); await Dialog.alert(`풀었어요.\n\n대화 ${j.sessions}개${j.sessionsHad ? `(이미 있던 것 ${j.sessionsHad}개)` : ''}\n폴더 ${j.folders}개${j.foldersHad ? `(이미 있던 것 ${j.foldersHad}개)` : ''}\n서식 ${j.templates}개 · 예약 ${j.schedules}개(꺼진 채로)\n\n옮긴 대화는 작업목록에 「종료됨」으로 있어요. 로그인은 이 PC에서 한 번 해 주세요.`); location.reload();
  });
  const guide = async () => {
    const yes = await Dialog.choose({ title: '윈도 계정을 나눠 쓰기', wide: true, okLabel: '윈도 계정 설정 열기', cancelLabel: '닫기', html: '<p>같은 PC를 여럿이 쓰면 사람마다 윈도 계정을 따로 만드는 것이 가장 안전해요. 다만 IRIS는 공용 자리(C:\\IRIS)에 깔려 있어 계정을 나누는 것만으로는 기록 폴더가 가려지지 않아요. 나눈 뒤 설정의 「대화 기록 폴더를 내 윈도 계정만 보기」도 함께 켜 주세요.</p><ol class="mg-ol"><li>「윈도 계정 설정 열기」를 눌러 「다른 사용자」에서 <b>계정 추가</b>를 눌러요.</li><li>그 사람의 마이크로소프트 계정을 적거나, 「이 사람의 로그인 정보가 없어요」→「Microsoft 계정 없이 사용자 추가」로 이름과 암호를 정해요.</li><li>새 계정은 <b>표준 사용자</b> 그대로 두세요. 관리자로 바꾸면 남의 폴더도 열 수 있어요.</li><li>시작 단추 → 내 이름 → 새 계정으로 로그인한 뒤, IRIS에서 구독 계정을 연결해요.</li><li>자리를 비울 때는 <b>윈도 키 + L</b> 로 잠가요.</li></ol><p class="mg-note">관리자 계정을 쓰는 사람은 다른 사람의 폴더도 열 수 있어요. IRIS가 공용 자리(C:\\IRIS)에 깔려 있으면 그 안의 작업 폴더와 기록은 계정을 나눠도 함께 보일 수 있으니, 개인 대화는 개인 공간 잠금도 함께 쓰세요.</p>' });
    if (yes === 'ok') fetch('/api/open-settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: 'otherusers' }) }).then((r) => { if (!r.ok) throw 0; }).catch(() => Dialog.alert('설정 창을 열지 못했어요. 시작 → 설정 → 계정 → 다른 사용자에서 할 수 있어요.'));
  };
  function init(o) { opts = o; $('#mg-make')?.addEventListener('click', make); $('#mg-open')?.addEventListener('click', open); $('#st-winacc')?.addEventListener('click', guide); }
  return { init, guide };
})();
