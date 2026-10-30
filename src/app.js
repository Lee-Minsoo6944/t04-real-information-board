import { SOURCE, TZ, ERROR_TEXT, resetState, comparisonFor, fmtComparison, fmtKst, normalizeOpenMeteo } from './core.js';
import { liveAttempt, replayAttempt } from './adapter.js';
import { loadPackage } from './package.js';
import { checkExpected, runSelfTests } from './selftest.js';
import { initFx, initKospi } from './refcards.js';
import { initSummary } from './summary.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};
const fmtSrcTime = (s) => (s ? `${esc(s)}` : '<span class="muted">원천이 시각을 주지 않음 (null)</span>');

// ── 공통 카드 ─────────────────────────────────────
function renderCard(el, st, { onRetry, retryLabel = '다시 시도', synthetic = false, busy = false } = {}) {
  const cur = st.current_reading;
  const fr = st.status?.freshness, code = st.status?.error_code ?? 'none';
  const badge = busy ? ['loading', '조회 중…'] : fr === 'fresh' ? ['fresh', 'fresh · 최신'] : fr === 'stale' ? ['stale', 'stale · 오래된 값'] : ['loading', '아직 조회 전'];
  const err = ERROR_TEXT[code];
  const cmp = fmtComparison(st.last_comparison);
  el.innerHTML = `
    <div class="card-top">
      <span class="badge ${badge[0]}" data-testid="freshness">${badge[1]}</span>
      <span class="code">freshness <b>${esc(fr ?? '—')}</b> · error_code <b data-testid="error_code">${esc(st.status ? code : '—')}</b></span>
    </div>
    ${cur ? `
    <div class="value-row ${fr === 'stale' ? 'is-stale' : ''}">
      <span class="value" data-testid="value">${esc(String(cur.normalized_value))}</span>
      <span class="unit" data-testid="unit">${esc(cur.unit)}</span>
      ${fr === 'stale' ? '<span class="stale-tag">오래된 값 · 마지막 정상값</span>' : ''}
    </div>` : '<div class="value-row empty"><span class="value">—</span><span class="unit">보여 줄 정상값이 아직 없습니다</span></div>'}
    <dl class="meta">
      <dt>무엇</dt><dd>${synthetic ? `합성 시험값 <code>${esc(cur?.signal_id ?? '')}</code> (실제 값 아님)` : esc(SOURCE.metric)}</dd>
      <dt>출처</dt><dd>${cur ? (synthetic ? `${esc(cur.source_name)} · <code>${esc(cur.source_url)}</code>` : `<a href="${esc(cur.source_url)}" target="_blank" rel="noopener">${esc(cur.source_name)}</a>`) : '—'}</dd>
      <dt>출처 시각</dt><dd data-testid="source_time">${cur ? fmtSrcTime(cur.source_time) : '—'} <small>원천이 관측한 시각</small></dd>
      <dt>조회 시각</dt><dd data-testid="fetched_at">${cur ? fmtKst(cur.fetched_at) : '—'} <small>이 값을 받아 온 시각</small></dd>
      <dt>일별 키</dt><dd>${cur ? `${esc(cur.record_date)} <small>(${TZ} 날짜)</small>` : '—'}</dd>
      <dt>직전 날짜 대비</dt><dd data-testid="delta">${cmp ? `<b>${esc(cmp.text)}</b> ${cmp.word} <small>(${esc(st.last_comparison.from.record_date)} ${st.last_comparison.from.normalized_value} → ${esc(st.last_comparison.to.record_date)} ${st.last_comparison.to.normalized_value})</small>` : '<span class="muted">비교할 앞 날짜 기록 없음</span>'}</dd>
      <dt>마지막 시도</dt><dd>${st.last_run ? `${fmtKst(st.last_run.at)} · ${st.last_run.outcome === 'success' ? '성공' : '실패'}${st.last_run.fixture_id ? ` · <code>${esc(st.last_run.fixture_id)}</code>` : ''}` : '—'}</dd>
      <dt>기준 시간대</dt><dd>${TZ} (UTC+09:00)</dd>
    </dl>
    ${st.status && code !== 'none' ? `
    <div class="fail fail-${esc(code)}" role="alert">
      <div class="fail-title">${esc(err.title)}</div>
      <p>${esc(err.explain)}</p>
      <p class="fail-detail">${esc(st.last_run?.detail)}${st.last_run?.retry_after_seconds ? ` · ${st.last_run.retry_after_seconds}초 뒤 다시 시도 가능` : ''}</p>
      <p><b>다음 행동:</b> ${esc(err.action)}</p>
      ${cur ? `<p class="kept">마지막 정상값 ${esc(String(cur.normalized_value))} ${esc(cur.unit)} (조회 ${fmtKst(cur.fetched_at)})과 일별 기록 ${st.daily_readings.length}행은 지우지 않았습니다.</p>` : ''}
      ${onRetry ? `<button class="retry" data-testid="retry">${esc(retryLabel)}</button>` : ''}
    </div>` : (onRetry ? `<button class="ghost retry" ${busy ? 'disabled' : ''}>${synthetic ? esc(retryLabel) : '새로 조회'}</button>` : '')}
  `;
  el.querySelectorAll('.retry').forEach((b) => b.addEventListener('click', onRetry));
}

// ── ① 실시간 조회 ────────────────────────────────
const LIVE_KEY = 't04.live.v3';
let dailyDb = { daily_readings: [] };

async function initLive() {
  let st = store.get(LIVE_KEY);
  if (!st || !st.daily_readings) st = resetState();
  // 저장소의 실제 일별 기록을 기준으로 삼아 비교·마지막 정상값을 이어 간다
  for (const row of dailyDb.daily_readings) {
    const i = st.daily_readings.findIndex((r) => r.record_id === row.record_id);
    if (i < 0) st.daily_readings.push(row);
    else if (row.last_fetched_at > st.daily_readings[i].last_fetched_at) st.daily_readings[i] = row;
  }
  st.daily_readings.sort((a, b) => a.record_date.localeCompare(b.record_date));
  if (!st.current_reading && st.daily_readings.length) st.current_reading = st.daily_readings.at(-1).reading;
  const el = $('#live-card');
  const run = async () => {
    renderCard(el, st, { onRetry: run, busy: true });
    st = (await liveAttempt(st)).state;
    store.set(LIVE_KEY, st);
    renderCard(el, st, { onRetry: run });
  };
  await run();
}

// ── ② 실제 일별 기록 ─────────────────────────────
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function renderDaily() {
  const rows = dailyDb.daily_readings;
  const checks = await Promise.all(rows.map(async (r) => {
    try {
      const raw = await (await fetch(r.raw_file, { cache: 'no-store' })).json();
      const n = normalizeOpenMeteo(raw.response, raw.fetched_at, raw.request_url);
      const ok = same(n, r.reading) && n.normalized_value === r.normalized_value && n.unit === r.unit && raw.fetched_at === r.last_fetched_at;
      return { n, ok };
    } catch (e) { return { n: null, ok: false }; }
  }));
  $('#daily-count').textContent = `${rows.length}건`;
  $('#daily-body').innerHTML = rows.map((r, i) => {
    const c = checks[i];
    return `<tr>
      <td data-label="KST 날짜"><b>${esc(r.record_date)}</b><br><small>${esc(r.record_id)}</small></td>
      <td data-label="원자료 값">${c.n ? `${c.n.normalized_value} ${esc(c.n.unit)}` : '읽기 실패'}</td>
      <td data-label="저장값">${r.normalized_value} ${esc(r.unit)}</td>
      <td data-label="화면값" class="screen-val"><b>${esc(String(r.normalized_value))} ${esc(r.unit)}</b></td>
      <td data-label="출처 시각">${fmtSrcTime(r.reading.source_time)}</td>
      <td data-label="조회 시각">${fmtKst(r.last_fetched_at)}<br><small>${esc(r.last_fetched_at)}</small></td>
      <td data-label="원자료"><a href="${esc(r.raw_file)}" target="_blank">JSON</a> · <a href="${esc(r.reading.source_url)}" target="_blank" rel="noopener">원천</a></td>
      <td data-label="대조" class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓ 일치' : '✗ 불일치'}</td>
    </tr>`;
  }).join('');

  // 플랫폼 기록용 값 (source_url · source_observed_at · normalized_value · unit)
  $('#receipts').innerHTML = rows.map((r) => `
    <div class="receipt">
      <div class="receipt-h">${esc(r.record_date)} 기록</div>
      <pre>${esc(JSON.stringify({ source_url: r.reading.source_url, source_observed_at: r.reading.source_time, normalized_value: r.normalized_value, unit: r.unit }, null, 2))}</pre>
    </div>`).join('');

  const el = $('#change');
  const last = rows.at(-1);
  const c = last ? comparisonFor(rows, last) : null;
  const f = fmtComparison(c);
  if (!f) {
    el.innerHTML = `<div class="change-wait"><b>${last ? '두 번째' : '첫'} 실제 날짜 기록을 기다리는 중</b>
      <p>${last ? `지금은 ${esc(last.record_date)} 한 건뿐입니다.` : '아직 저장된 실제 기록이 없습니다.'} 기록은 매일 09:00 KST 에 자동 조회로 쌓이며, 비교값을 만들려고 기록을 꾸며 넣지 않습니다.</p></div>`;
  } else {
    const days = Math.round((Date.parse(c.to.record_date) - Date.parse(c.from.record_date)) / 86400000);
    el.innerHTML = `<div class="change-box">
      <div class="change-label">${days === 1 ? '어제 대비' : `직전 기록(${days}일 전) 대비`}</div>
      <div class="change-val ${c.direction === 'increase' ? 'up' : c.direction === 'decrease' ? 'down' : ''}" data-testid="real-delta">${esc(f.text)} <small>${f.word}</small></div>
      <div class="change-calc">계산: ${c.to.record_date} 값 ${c.to.normalized_value} − ${c.from.record_date} 값 ${c.from.normalized_value} = ${c.direction === 'decrease' ? '−' : ''}${c.magnitude} ${esc(c.unit)}</div>
    </div>`;
  }
}

// ── ③ 공개 꾸러미 ────────────────────────────────
let pkg = null;
function renderPackage() {
  $('#pkg-sum').innerHTML = `<b class="${pkg.allOk ? 'ok' : 'bad'}">${pkg.allOk ? '✓ 모든 파일 일치' : '✗ 불일치 있음'}</b> · package_id <code>${esc(pkg.package_id)}</code> · contract ${esc(pkg.contract_version)} · fixture contract ${esc(pkg.fixture_contract_version)}`;
  $('#pkg-files').innerHTML = pkg.checks.map((c) => `<tr><td><code>${esc(c.path)}</code></td><td>${c.bytes ?? '—'}</td><td><code class="hash">${esc(c.got)}</code></td><td class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'}</td></tr>`).join('');
}

// ── ④ 합성 재생 ──────────────────────────────────
let sim = resetState();
let simLog = [];
const recordIds = {};
let simBusy = false;

function simReset(note = '') {
  sim = resetState();
  for (const k of Object.keys(recordIds)) delete recordIds[k];
  simLog.push({ reset: true, note });
  renderSim();
}
async function play(id) {
  const fx = pkg.fixtures[id];
  const before = sim.daily_readings.length;
  renderCard($('#sim-card'), sim, { synthetic: true, busy: true });
  sim = (await replayAttempt(sim, fx)).state;
  const row = sim.daily_readings.find((r) => r.record_date === sim.current_reading?.record_date);
  if (sim.last_run.outcome === 'success' && row) recordIds[id] = row.record_id;
  const chk = checkExpected(sim, fx, recordIds);
  simLog.push({ id, at: fx.virtual_now, fr: sim.status.freshness, code: sim.status.error_code, before, after: sim.daily_readings.length, lg: sim.current_reading?.normalized_value, delta: sim.last_delta, chk });
  renderSim();
}
async function seq(ids, note) {
  if (simBusy) return;
  simBusy = true;
  try { simReset(note); for (const id of ids) await play(id); } finally { simBusy = false; }
}
function renderSim() {
  const stale = sim.status?.freshness === 'stale';
  renderCard($('#sim-card'), sim, { synthetic: true, onRetry: stale ? () => play('T04-RECOVER-D2') : null, retryLabel: '다시 시도 (T04-RECOVER-D2 재생)' });
  $('#sim-rows').textContent = `${sim.daily_readings.length}행`;
  $('#sim-daily').innerHTML = sim.daily_readings.map((r) => `<tr><td>${esc(r.record_date)}</td><td><code>${esc(r.record_id)}</code></td><td>${r.normalized_value} ${esc(r.unit)}</td><td>${r.success_count}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">기록 없음</td></tr>';
  $('#sim-log').innerHTML = simLog.map((l) => l.reset
    ? `<tr class="reset-row"><td colspan="8">reset${l.note ? ` — ${esc(l.note)}` : ''}</td></tr>`
    : `<tr><td><code>${esc(l.id)}</code></td><td>${esc(l.at.slice(0, 16).replace('T', ' '))}Z</td><td><span class="badge sm ${l.fr}">${l.fr}</span></td><td><code>${l.code}</code></td><td>${l.lg ?? '—'}</td><td>${l.delta ?? '—'}</td><td>${l.before} → ${l.after}</td><td class="${l.chk.ok ? 'ok' : 'bad'}" title="${esc(l.chk.why)}">${l.chk.ok ? '✓ 기대값' : `✗ ${esc(l.chk.why)}`}</td></tr>`).join('')
    || '<tr><td colspan="8" class="muted">아직 재생하지 않았습니다</td></tr>';
}
function buildSimControls() {
  const order = ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-NORMAL-D2', 'T04-TIMEOUT', 'T04-AUTH-401', 'T04-RATE-429', 'T04-OFFLINE', 'T04-SCHEMA-BREAK', 'T04-RECOVER-D2'];
  $('#sim-buttons').innerHTML = order.map((id) => {
    const fx = pkg.fixtures[id];
    const g = fx.expected.freshness === 'fresh' ? 'g-ok' : 'g-fail';
    return `<button class="fx ${g}" data-id="${id}"><span>${esc(id)}</span><small>${esc(fx.description_ko)}</small></button>`;
  }).join('');
  $('#sim-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b && !simBusy) play(b.dataset.id);
  });
  const fc = pkg.contract.fixture_contract;
  $('#sim-reset').addEventListener('click', () => { simLog = []; simReset(); });
  $('#seq-normal').addEventListener('click', () => { simLog = []; seq(fc.success_sequence, '정상·일별 저장'); });
  $('#seq-fail').addEventListener('click', async () => {
    if (simBusy) return;
    simLog = [];
    for (const f of fc.failure_fixtures) await seq([...fc.failure_baseline_sequence, f], `실패 ${f}`);
  });
  $('#seq-recover').addEventListener('click', async () => {
    simLog = [];
    await seq(fc.recovery_sequence.slice(0, -1), '오류 뒤 회복 — 아래 카드의 "다시 시도"를 누르면 T04-RECOVER-D2 재생');
  });
}

// ── 시작 ─────────────────────────────────────────
async function main() {
  $('#src-url').textContent = SOURCE.url;
  $('#src-url').href = SOURCE.url;
  try { dailyDb = await (await fetch(`data/daily.json?t=${Date.now()}`, { cache: 'no-store' })).json(); }
  catch (e) { $('#daily-body').innerHTML = `<tr><td colspan="8">일별 기록 파일을 읽지 못했습니다: ${esc(e.message)}</td></tr>`; }
  renderDaily();
  initLive();
  initSummary();
  initFx($('#ref-fx'));
  initKospi($('#ref-kospi'));
  window.addEventListener('online', () => $('#live-card .retry')?.click());
  try {
    pkg = await loadPackage();
    renderPackage();
    buildSimControls();
    renderSim();
  } catch (e) { $('#pkg-sum').textContent = `공개 꾸러미를 읽지 못했습니다: ${e.message}`; }
  $('#run-tests').addEventListener('click', async () => {
    $('#test-out').innerHTML = '<li>실행 중… (timeout fixture 는 1.5초씩 걸립니다)</li>';
    const results = await runSelfTests(pkg, dailyDb);
    const pass = results.filter((r) => r.ok).length;
    $('#test-sum').textContent = `${pass}/${results.length} 통과`;
    $('#test-out').innerHTML = results.map((r) => `<li class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'} ${esc(r.name)}${r.ok ? '' : ` — ${esc(r.why)}`}</li>`).join('');
  });
  await runFromUrl();
}

// 주소로 바로 재생: ?replay=normal | failures | recover | recovered | <fixture_id>, ?selftest=1
async function runFromUrl() {
  const q = new URLSearchParams(location.search);
  const r = q.get('replay');
  if (r && pkg) {
    const fc = pkg.contract.fixture_contract;
    const ids = {
      normal: fc.success_sequence,
      recover: fc.recovery_sequence.slice(0, -1),
      recovered: fc.recovery_sequence,
    }[r] || (pkg.fixtures[r] ? [...fc.failure_baseline_sequence, r] : null);
    if (r === 'failures') { $('#seq-fail').click(); await new Promise((ok) => { const t = setInterval(() => { if (!simBusy && simLog.filter((l) => !l.reset).length >= 15) { clearInterval(t); ok(); } }, 100); }); }
    else if (ids) { simLog = []; await seq(ids, `주소로 재생: ${r}`); }
    if (!q.get('only')) $('#h-sim').scrollIntoView();
  }
  if (q.get('selftest')) { $('#run-tests').click(); await new Promise((ok) => { const t = setInterval(() => { if (/통과/.test($('#test-sum').textContent)) { clearInterval(t); ok(); } }, 100); }); if (!q.get('only')) $('#h-test').scrollIntoView(); }
  const f = q.get('focus');
  if (f && document.getElementById(f)) document.getElementById(f).scrollIntoView();
}

// ?only=h-sim 처럼 한 칸만 보이게 (화면 캡처용)
const only = new URLSearchParams(location.search).get('only');
if (only) {
  document.querySelectorAll('main > section').forEach((s) => { if (!only.split(',').some((id) => s.querySelector(`#${id}`))) s.style.display = 'none'; });
  document.querySelectorAll('.hero, .group-label').forEach((e) => { e.style.display = 'none'; });
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
}
main();
