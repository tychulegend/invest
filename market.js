// Phần dùng chung của hai trang theo dõi thị trường (companies.html, etf.html): định dạng số,
// giao diện sáng/tối, gọi API có giới hạn thời gian và cache, biểu đồ đường.
// Hai trang này chỉ để xem; không đụng tới sổ cổ phần (core.js, calculated.js, portfolio.js).
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (min, max = min) => new Intl.NumberFormat('vi-VN', { minimumFractionDigits: min, maximumFractionDigits: max });
  const fmtInt = nf(0), fmt1 = nf(0, 1), fmt2 = nf(2), fmtPct = nf(2), fmt3 = nf(0, 3);
  const signed = (v, f) => (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v));
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  /** 54.120.109.043 thành "54,12 tỷ"; số nhỏ để nguyên. */
  const fmtUsd = (v) => {
    const a = Math.abs(v);
    if (a >= 1e9) return `${fmt2.format(v / 1e9)} tỷ USD`;
    if (a >= 1e6) return `${fmt1.format(v / 1e6)} triệu USD`;
    return `${fmtInt.format(v)} USD`;
  };
  const fmtBtc = (v) => (Math.abs(v) >= 1000 ? fmtInt : fmt3).format(v);
  const fmtDate = (d) => {
    const x = new Date(d);
    return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`;
  };
  const fmtWhen = (d) => new Date(d).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

  // Mọi trang GitHub Pages của cùng một tài khoản dùng chung origin, nên khoá localStorage kèm
  // thư mục của site. Trùng với khoá của trang sổ cổ phần để ba trang dùng chung giao diện sáng/tối.
  const SITE_PATH = window.location.pathname.replace(/[^/]*$/, '');
  const THEME_KEY = `theme:${SITE_PATH}`;
  const KEY_PREFIX = `invest:${SITE_PATH}:market:`;

  function setupTheme() {
    const root = document.documentElement;
    const btn = $('theme-toggle');
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const current = () => root.dataset.theme || (mq.matches ? 'dark' : 'light');
    const sync = () => {
      const dark = current() === 'dark';
      btn.setAttribute('aria-label', dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối');
      btn.innerHTML = dark
        ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></g></svg>'
        : '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" fill="currentColor"/></svg>';
    };
    btn.addEventListener('click', () => {
      root.dataset.theme = current() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, root.dataset.theme); } catch (e) {}
      sync();
    });
    if (mq.addEventListener) mq.addEventListener('change', sync);
    sync();
  }

  /** GET JSON có giới hạn thời gian. Lỗi mang theo .status (vd 429 khi bị giới hạn số lần gọi). */
  async function getJson(url, timeoutMs = 12000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * GET JSON qua cache localStorage. API miễn phí giới hạn số lần gọi theo IP, nên trong thời hạn
   * ttlMs dùng lại bản đã lưu; gọi lỗi mà còn bản cũ thì trả bản cũ kèm stale = true.
   * @returns {Promise<{data: any, at: number, stale: boolean}>}
   */
  async function cachedJson(key, url, ttlMs, { force = false } = {}) {
    const k = KEY_PREFIX + key;
    let hit = null;
    try { hit = JSON.parse(localStorage.getItem(k)); } catch (e) {}
    if (hit && !force && Date.now() - hit.at < ttlMs) return { data: hit.data, at: hit.at, stale: false };
    try {
      const data = await getJson(url);
      const at = Date.now();
      try { localStorage.setItem(k, JSON.stringify({ at, data })); } catch (e) {}
      return { data, at, stale: false };
    } catch (e) {
      if (hit) return { data: hit.data, at: hit.at, stale: true, error: e };
      throw e;
    }
  }

  const errorText = (e) => (e && e.status === 429
    ? 'Nguồn dữ liệu đang giới hạn số lần gọi. Chờ khoảng một phút rồi thử lại.'
    : 'Không tải được dữ liệu. Kiểm tra mạng rồi thử lại.');

  /* ---------- biểu đồ đường một chuỗi ---------- */

  const niceStep = (span, target) => {
    const raw = span / target, mag = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  };

  /**
   * Vẽ biểu đồ đường vào el, có đường dóng và ô chú thích khi rê chuột/chạm.
   * @param {HTMLElement} el
   * @param {Array<[number, number]>} points [thời điểm ms, giá trị], đã xếp theo thời gian
   * @param {{label: string, unit: string, step?: boolean, fmt?: function(number): string}} opts
   *   step: vẽ bậc thang (số dư giữ nguyên giữa hai lần mua bán)
   */
  function lineChart(el, points, opts) {
    const fmt = opts.fmt || fmtBtc;
    if (points.length < 2) {
      el.innerHTML = `<p class="chart-empty">${esc(opts.empty || 'Chưa đủ dữ liệu để vẽ biểu đồ.')}</p>`;
      return;
    }
    const W = 720, H = 260, L = 8, R = 8, T = 12, B = 26;
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const x0 = xs[0], x1 = xs[xs.length - 1];
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (lo === hi) { lo -= 1; hi += 1; }
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const px = (t) => L + ((t - x0) / (x1 - x0 || 1)) * (W - L - R);
    const py = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let d = '';
    points.forEach((p, i) => {
      const X = px(p[0]).toFixed(1), Y = py(p[1]).toFixed(1);
      d += i === 0 ? `M${X} ${Y}` : opts.step ? `H${X}V${Y}` : `L${X} ${Y}`;
    });
    let grid = '';
    for (let v = lo; v <= hi + step / 2; v += step) {
      grid += `<line class="chart-grid" x1="${L}" x2="${W - R}" y1="${py(v).toFixed(1)}" y2="${py(v).toFixed(1)}"/>
        <text class="chart-tick" x="${L}" y="${(py(v) - 4).toFixed(1)}">${esc(fmt(v))}</text>`;
    }
    const xLabel = (t, anchor) => `<text class="chart-tick" x="${px(t).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${fmtDate(t)}</text>`;
    el.innerHTML = `
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}: từ ${esc(fmt(ys[0]))} (${fmtDate(x0)}) đến ${esc(fmt(ys[ys.length - 1]))} ${esc(opts.unit)} (${fmtDate(x1)})">
        ${grid}${xLabel(x0, 'start')}${xLabel(x1, 'end')}
        <path class="chart-area" d="${d}V${py(lo).toFixed(1)}H${px(x0).toFixed(1)}Z"/>
        <path class="chart-line" d="${d}"/>
        <line class="chart-cross" y1="${T}" y2="${H - B}" hidden/>
        <circle class="chart-dot" r="4.5" hidden/>
      </svg>
      <div class="tooltip chart-tip" hidden></div>`;
    const svg = el.querySelector('svg'), cross = el.querySelector('.chart-cross');
    const dot = el.querySelector('.chart-dot'), tip = el.querySelector('.chart-tip');
    const hide = () => { cross.setAttribute('hidden', ''); dot.setAttribute('hidden', ''); tip.hidden = true; };
    const show = (clientX) => {
      const box = svg.getBoundingClientRect();
      const t = x0 + ((((clientX - box.left) / box.width) * W - L) / (W - L - R)) * (x1 - x0);
      let i = 0;
      if (opts.step) {
        // Bậc thang: giá trị tại t là của mốc gần nhất về bên trái.
        for (let j = 0; j < points.length; j++) if (points[j][0] <= t) i = j;
      } else {
        for (let j = 1; j < points.length; j++) if (Math.abs(points[j][0] - t) < Math.abs(points[i][0] - t)) i = j;
      }
      const X = px(points[i][0]), Y = py(points[i][1]);
      cross.setAttribute('x1', X); cross.setAttribute('x2', X); cross.removeAttribute('hidden');
      dot.setAttribute('cx', X); dot.setAttribute('cy', Y); dot.removeAttribute('hidden');
      tip.innerHTML = `<strong>${esc(fmt(points[i][1]))} ${esc(opts.unit)}</strong>${fmtDate(points[i][0])}`;
      tip.hidden = false;
      const left = (X / W) * box.width;
      tip.style.left = `${Math.min(Math.max(left, 70), box.width - 70)}px`;
      tip.style.top = `${(Y / H) * box.height}px`;
    };
    svg.addEventListener('pointermove', (e) => show(e.clientX));
    svg.addEventListener('pointerdown', (e) => show(e.clientX));
    svg.addEventListener('pointerleave', hide);
  }

  window.Market = { $, esc, nf, fmtInt, fmt1, fmt2, fmtPct, signed, cls, fmtUsd, fmtBtc, fmtDate, fmtWhen, setupTheme, getJson, cachedJson, errorText, lineChart };
}());
