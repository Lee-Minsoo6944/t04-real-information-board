// 한 번의 조회 시도를 상태 전이로 바꾼다. live·replay 가 같은 경로를 쓰고, 바뀌는 것은 fetch·시계·변환 함수뿐이다.
import { SOURCE, SourceError, classifyHttp, classifyException, normalizeOpenMeteo, applySuccess, applyError } from './core.js';

export async function attempt(state, { fetchImpl, url, deadlineMs, online, at, toReading, meta = {} }) {
  try {
    if (!online) throw new SourceError('offline', 'navigator.onLine = false');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), deadlineMs);
    let res, body;
    try {
      res = await fetchImpl(url, { signal: ctrl.signal, cache: 'no-store' });
      const code = classifyHttp(res.status);
      if (code) {
        const ra = res.headers?.get?.('retry-after');
        throw new SourceError(code, `HTTP ${res.status}${ra ? ` · Retry-After ${ra}s` : ''}`);
      }
      try { body = await res.json(); } catch { throw new SourceError('schema_error', 'JSON 이 아님'); }
    } finally { clearTimeout(timer); }
    const reading = toReading(body, at);
    return { state: applySuccess(state, reading, { ...meta, at }), raw: body };
  } catch (err) {
    const code = classifyException(err, { online });
    const retry = /Retry-After (\d+)/.exec(err.detail || '');
    const detail = err.detail || (err.name === 'AbortError' ? `${deadlineMs / 1000}초 안에 응답 없음` : String(err.message || err));
    return { state: applyError(state, code, { ...meta, at, detail, retry_after_seconds: retry ? Number(retry[1]) : null }), raw: null };
  }
}

// 실제 공개 원천 (브라우저)
export function liveAttempt(state) {
  return attempt(state, {
    fetchImpl: (u, o) => fetch(u, o),
    url: SOURCE.url,
    deadlineMs: 8000,
    online: navigator.onLine,
    at: new Date().toISOString(),
    toReading: (raw, at) => normalizeOpenMeteo(raw, at),
  });
}

// 공개 fixture 재생: transport 를 가짜 fetch 로 그대로 재현한다. payload 는 이미 정규화 형식이므로 그대로 같은 저장 함수에 넘긴다.
export function replayAttempt(state, fx) {
  const t = fx.transport;
  const fetchImpl = (url, { signal } = {}) => new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('deadline 초과', 'AbortError')));
    if (t.mode === 'offline') return reject(new TypeError('Failed to fetch'));
    setTimeout(() => resolve({
      status: t.mode === 'timeout' ? 200 : t.status,
      headers: { get: (k) => t.headers?.[k.toLowerCase()] ?? null },
      json: async () => JSON.parse(JSON.stringify(fx.payload)),
    }), t.delay_ms);
  });
  return attempt(state, {
    fetchImpl,
    url: `fixture:${fx.fixture_id}`,
    deadlineMs: t.deadline_ms,
    online: t.mode !== 'offline',
    at: fx.virtual_now,
    toReading: (payload) => payload,
    meta: { fixture_id: fx.fixture_id },
  });
}
