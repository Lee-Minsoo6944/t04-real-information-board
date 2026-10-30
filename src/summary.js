// 맨 위 요약 칸: 아래 카드들이 그린 값을 그대로 옮겨 보여 준다 (값을 따로 조회하거나 계산하지 않음).
const $ = (s, r = document) => r.querySelector(s);
const txt = (el) => (el ? el.textContent.trim() : '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function dd(card, label) {
  const dt = [...card.querySelectorAll('dt')].find((d) => d.textContent.trim() === label);
  return dt ? dt.nextElementSibling : null;
}

function readCard(card) {
  const badge = $('.badge', card);
  const val = txt($('.value', card));
  return {
    val: val && val !== '—' ? val : '',
    unit: txt($('.unit', card)),
    badge: txt(badge),
    state: badge?.classList.contains('fresh') ? 'fresh' : badge?.classList.contains('stale') ? 'stale' : 'wait',
  };
}

function setKpi(id, { val, unit, sub, state, dir }) {
  const box = $(`#kpi-${id}`);
  if (!box) return;
  $('.kpi-val', box).innerHTML = val ? `${esc(val)}<small>${esc(unit || '')}</small>` : '—';
  $('.kpi-sub', box).textContent = sub || '';
  box.dataset.state = state || '';
  box.dataset.dir = dir || '';
}

function update() {
  const live = $('#live-card');
  if (live) {
    const c = readCard(live);
    const t = txt(dd(live, '출처 시각')).match(/T(\d\d:\d\d)/);
    setKpi('temp', { ...c, sub: c.val ? `${c.state === 'fresh' ? '최신' : '오래된 값'}${t ? ` · ${t[1]} 관측` : ''}` : c.badge });
  }

  const ch = $('#change');
  if (ch) {
    const cv = $('.change-val', ch);
    if (cv) {
      const word = txt($('small', cv));
      setKpi('delta', { val: txt(cv).replace(word, '').trim(), unit: '', sub: `${word} · 매일 09:00 기록끼리 비교`, state: 'fresh', dir: cv.classList.contains('up') ? 'up' : cv.classList.contains('down') ? 'down' : '' });
    } else if ($('.change-wait', ch)) {
      const n = $('#daily-count') ? txt($('#daily-count')) : '';
      setKpi('delta', { val: '대기 중', unit: '', sub: `기록 ${n || '1건'} · 다음 09:00 기록 후 비교`, state: 'wait' });
    }
  }

  const fx = $('#ref-fx');
  if (fx) {
    const c = readCard(fx);
    const day = txt(dd(fx, '출처 시각')).match(/\d{4}-\d{2}-\d{2}/);
    setKpi('fx', { ...c, unit: '원', sub: c.val ? `기준일 ${day ? day[0] : ''}${c.state === 'stale' ? ' · 오래된 값' : ''}` : c.badge });
  }

  const ks = $('#ref-kospi');
  if (ks) {
    const c = readCard(ks);
    const chg = txt($('b', dd(ks, '전일 종가 대비') || document.createElement('i')));
    setKpi('kospi', { ...c, unit: '', sub: c.val ? `전일 대비 ${chg}${c.state === 'stale' ? ' · 오래된 값' : ''}` : c.badge, dir: chg.startsWith('+') ? 'up' : chg.startsWith('−') ? 'down' : '' });
  }
}

export function initSummary() {
  const mo = new MutationObserver(update);
  ['#live-card', '#change', '#ref-fx', '#ref-kospi', '#daily-count'].forEach((s) => { const el = $(s); if (el) mo.observe(el, { childList: true, subtree: true, characterData: true }); });
  update();
}
