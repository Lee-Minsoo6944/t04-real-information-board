// 화면에서 누구나 실행할 수 있는 자체 시험. 공개 fixture 의 expected 와 실제 상태를 대조한다.
import { resetState, kstDate, applySuccess, normalizeOpenMeteo, comparisonFor, ERROR_CODES } from './core.js';
import { replayAttempt } from './adapter.js';

// fixture.expected 와 현재 상태 비교
export function checkExpected(s, fx, recordIds = {}) {
  const e = fx.expected, bad = [];
  if (s.status?.freshness !== e.freshness) bad.push(`freshness ${s.status?.freshness}≠${e.freshness}`);
  if (s.status?.error_code !== e.error_code) bad.push(`error_code ${s.status?.error_code}≠${e.error_code}`);
  if (s.daily_readings.length !== e.row_count) bad.push(`행 ${s.daily_readings.length}≠${e.row_count}`);
  if ((s.current_reading?.normalized_value ?? null) !== e.stored_value) bad.push(`값 ${s.current_reading?.normalized_value}≠${e.stored_value}`);
  if (s.last_delta !== e.delta) bad.push(`delta ${s.last_delta}≠${e.delta}`);
  if (e.preserve_last_good && e.stored_value !== null && !s.current_reading) bad.push('마지막 정상값 사라짐');
  if (e.record_date && s.current_reading?.record_date !== e.record_date) bad.push(`record_date ${s.current_reading?.record_date}≠${e.record_date}`);
  if (e.same_record_id_as && recordIds[e.same_record_id_as] !== recordIds[fx.fixture_id]) bad.push('record_id 가 달라짐');
  return { ok: bad.length === 0, why: bad.join(', ') };
}

async function runSeq(pkg, ids) {
  let s = resetState();
  const ids2 = {}, steps = [];
  for (const id of ids) {
    const fx = pkg.fixtures[id];
    const before = s.daily_readings.length;
    s = (await replayAttempt(s, fx)).state;
    if (s.last_run.outcome === 'success') ids2[id] = s.daily_readings.find((r) => r.record_date === s.current_reading.record_date).record_id;
    steps.push({ id, before, s, chk: checkExpected(s, fx, ids2) });
  }
  return steps;
}

export async function runSelfTests(pkg, dailyDb) {
  const out = [];
  const t = async (name, fn) => { try { const why = await fn(); out.push({ name, ok: !why, why }); } catch (e) { out.push({ name, ok: false, why: e.message }); } };
  const fc = pkg.contract.fixture_contract;

  await t(`공개 꾸러미 ${pkg.package_id}: 파일 ${pkg.checks.length}개 SHA-256·크기 일치`, () => (pkg.allOk ? '' : pkg.checks.filter((c) => !c.ok).map((c) => c.path).join(', ')));

  await t('KST 자정 경계: 14:59:59Z 는 같은 날, 15:00:00Z 는 다음 날', () =>
    kstDate('2026-08-24T14:59:59Z') === '2026-08-24' && kstDate('2026-08-24T15:00:00Z') === '2026-08-25' ? '' : '날짜 키 어긋남');

  // 정상·일별 저장
  const ok = await runSeq(pkg, fc.success_sequence);
  for (const st of ok) await t(`정상 순서 ${st.id} → 기대값 (${st.s.status.freshness}/${st.s.status.error_code}, 행 ${st.s.daily_readings.length}, 값 ${st.s.current_reading.normalized_value}, delta ${st.s.last_delta})`, () => st.chk.why);
  await t('T04-C20 같은 날 D1-A·D1-B 두 번 성공 → 1행, 같은 record_id', () => (ok[1].s.daily_readings.length === 1 && ok[0].s.daily_readings[0].record_id === ok[1].s.daily_readings[0].record_id ? '' : '행 또는 id 불일치'));
  await t('T04-C20 같은 날 세 번 성공해도 1행', () => {
    let s = resetState();
    const base = pkg.fixtures['T04-NORMAL-D1-A'].payload;
    for (const at of ['2026-08-23T15:00:00.000Z', '2026-08-24T03:00:00.000Z', '2026-08-24T14:59:59.000Z']) s = applySuccess(s, { ...base, fetched_at: at, record_date: kstDate(at) });
    return s.daily_readings.length === 1 && s.daily_readings[0].success_count === 3 ? '' : `행 ${s.daily_readings.length}`;
  });
  await t('T04-C21 다음 날 D2 성공 → 새 행 (1 → 2)', () => (ok[2].before === 1 && ok[2].s.daily_readings.length === 2 ? '' : `${ok[2].before}→${ok[2].s.daily_readings.length}`));

  // 실패 다섯
  const codes = new Set();
  for (const f of fc.failure_fixtures) {
    const steps = await runSeq(pkg, [...fc.failure_baseline_sequence, f]);
    const last = steps.at(-1);
    codes.add(last.s.status.error_code);
    await t(`${f} → stale/${last.s.status.error_code}, 마지막 정상값 ${last.s.current_reading?.normalized_value}, 행 ${last.s.daily_readings.length} 유지`, () => last.chk.why);
  }
  await t('실패 다섯이 서로 다른 error_code', () => (codes.size === 5 && [...codes].every((c) => ERROR_CODES.includes(c)) ? '' : [...codes].join(',')));
  await t('T04-C26 실패 fixture 의 원천 주소·값이 합성값 (fixtures.aleph.invalid)', () => {
    const bad = Object.values(pkg.fixtures).filter((f) => f.payload?.source_url && !f.payload.source_url.includes('.invalid'));
    return bad.length ? bad.map((f) => f.fixture_id).join(',') : '';
  });

  // 오류 뒤 회복
  const rec = await runSeq(pkg, fc.recovery_sequence);
  const tm = rec.at(-2), rv = rec.at(-1);
  await t('T04-C19 TIMEOUT 직후 stale/timeout, 1행, 마지막 정상값 105', () => tm.chk.why);
  await t('T04-C19 RECOVER-D2 → fresh/none, 2행, 다음 날짜(2026-08-25) 새 행 정확히 1건, 저장값 120', () => {
    const newRows = rv.s.daily_readings.filter((r) => !tm.s.daily_readings.some((x) => x.record_id === r.record_id));
    return rv.chk.why || (newRows.length === 1 && newRows[0].record_date === '2026-08-25' ? '' : `새 행 ${newRows.length}`);
  });

  // 실제 기록
  for (const r of dailyDb.daily_readings) {
    await t(`실제 기록 ${r.record_date}: 원자료 → 정규화 = 저장값`, async () => {
      const raw = await (await fetch(r.raw_file, { cache: 'no-store' })).json();
      const n = normalizeOpenMeteo(raw.response, raw.fetched_at, raw.request_url);
      return JSON.stringify(n) === JSON.stringify(r.reading) && n.normalized_value === r.normalized_value ? '' : '불일치';
    });
  }
  const rows = dailyDb.daily_readings;
  if (rows.length >= 2) {
    await t('T04-C24 실제 두 기록의 변화값 재계산 = 화면값', () => {
      const c = comparisonFor(rows, rows.at(-1));
      const shown = document.querySelector('[data-testid="real-delta"]')?.textContent || '';
      return shown.includes(`${c.magnitude} ${c.unit}`) ? '' : `${shown} vs ${c.magnitude}`;
    });
  }
  return out;
}
