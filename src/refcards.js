// 참고 지표 카드 (환율: 브라우저에서 바로 조회 / 코스피: 기록 봇이 받아 둔 값)
import { ERROR_TEXT, SourceError, classifyHttp, classifyException, fmtKst } from './core.js';
import { FX, KOSPI, normalizeFx } from './reference.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtNum = (v, d = 2) => Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } },
};

function card(el, { title, lg, fresh, code, detail, attemptAt, srcTimeText, extra, note, onRetry, busy }) {
  const err = ERROR_TEXT[code];
  const badge = busy ? ['loading', '조회 중…'] : !lg && code === 'none' ? ['loading', '아직 받아 둔 값 없음'] : fresh ? ['fresh', 'fresh · 최신'] : ['stale', lg ? 'stale · 오래된 값' : '값 없음'];
  el.innerHTML = `
    <h3>${esc(title)}</h3>
    <div class="card-top"><span class="badge ${badge[0]}">${badge[1]}</span><span class="code">error_code <b>${esc(code)}</b></span></div>
    ${lg ? `<div class="value-row ${fresh ? '' : 'is-stale'}"><span class="value">${esc(fmtNum(lg.value))}</span><span class="unit">${esc(lg.unit)}</span>${fresh ? '' : '<span class="stale-tag">오래된 값</span>'}</div>`
      : '<div class="value-row empty"><span class="value">—</span></div>'}
    <dl class="meta">
      <dt>출처</dt><dd>${lg ? `<a href="${esc(lg.source_url)}" target="_blank" rel="noopener">${esc(lg.source_name)}</a>` : '—'}</dd>
      <dt>출처 시각</dt><dd>${lg ? srcTimeText(lg) : '—'}</dd>
      <dt>조회 시각</dt><dd>${lg ? fmtKst(lg.fetched_at) : '—'}</dd>
      ${extra && lg ? extra(lg) : ''}
      <dt>마지막 시도</dt><dd>${attemptAt ? fmtKst(attemptAt) : '—'}</dd>
    </dl>
    ${code !== 'none' && err ? `<div class="fail fail-${esc(code)}" role="alert"><div class="fail-title">${esc(err.title)}</div><p>${esc(err.explain)}</p><p class="fail-detail">${esc(detail)}</p><p><b>다음 행동:</b> ${esc(err.action)}</p>${onRetry ? '<button class="retry">다시 시도</button>' : ''}</div>`
      : (onRetry ? `<button class="ghost retry" ${busy ? 'disabled' : ''}>새로 조회</button>` : '')}
    <p class="ref-note">${note}</p>`;
  el.querySelectorAll('.retry').forEach((b) => b.addEventListener('click', onRetry));
}

// ── 환율: 브라우저에서 바로 조회 ─────────────────
const FX_KEY = 't04.ref.fx.v1';
export async function initFx(el) {
  let st = store.get(FX_KEY) || { lg: null, code: 'none', detail: '', at: null };
  const view = (busy) => card(el, {
    title: FX.metric, lg: st.lg, fresh: st.code === 'none' && !!st.lg, code: st.code, detail: st.detail, attemptAt: st.at, busy,
    srcTimeText: (r) => `${esc(r.source_time)} <small>유럽중앙은행 기준일 (영업일 하루 한 번)</small>`,
    note: '이 브라우저가 지금 직접 받아 온 값입니다. 주말·공휴일에는 직전 영업일 값이 그대로 나옵니다.',
    onRetry: run,
  });
  async function run() {
    view(true);
    const at = new Date().toISOString();
    try {
      if (!navigator.onLine) throw new SourceError('offline', 'navigator.onLine = false');
      const res = await fetch(FX.url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
      const c = classifyHttp(res.status);
      if (c) throw new SourceError(c, `HTTP ${res.status}`);
      let raw; try { raw = await res.json(); } catch { throw new SourceError('schema_error', 'JSON 이 아님'); }
      st = { lg: normalizeFx(raw, at), code: 'none', detail: '', at };
    } catch (e) {
      const code = e.name === 'TimeoutError' ? 'timeout' : classifyException(e, { online: navigator.onLine });
      st = { ...st, code, detail: e.detail || e.message, at };
    }
    store.set(FX_KEY, st);
    view(false);
  }
  await run();
}

// ── 코스피: 기록 봇이 받아 둔 값 ─────────────────
export async function initKospi(el) {
  let k = null, loadErr = '';
  try { k = (await (await fetch(`data/reference.json?t=${Date.now()}`, { cache: 'no-store' })).json()).kospi; }
  catch (e) { loadErr = e.message; }
  const la = k?.last_attempt;
  card(el, {
    title: KOSPI.metric,
    lg: k?.last_good,
    fresh: la?.outcome === 'success',
    code: loadErr ? 'offline' : la?.error_code || 'none',
    detail: loadErr ? `참고 파일을 읽지 못함: ${loadErr}` : la?.detail,
    attemptAt: la?.at,
    srcTimeText: (r) => `${fmtKst(r.source_time)} <small>시세 시각</small>`,
    extra: (r) => `<dt>전일 종가 대비</dt><dd><b>${r.change > 0 ? '+' : r.change < 0 ? '−' : '±'}${fmtNum(Math.abs(r.change))} pt</b> <small>(전일 종가 ${fmtNum(r.prev_close)})</small></dd>`,
    note: '코스피 원천은 브라우저에서 바로 부를 수 없어, GitHub 기록 봇이 평일 09:20·12:20·15:20(KST)에 받아 둔 값을 보여 줍니다. 비공식 공개 시세라 참고용으로만 쓰세요.',
  });
}
