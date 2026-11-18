// Trang "ETF Bitcoin": đọc data/etf.json và data/13f.json do tools/fetch-data.js ghi mỗi ngày
// (GitHub Actions), vì các nguồn gốc không cho trình duyệt gọi thẳng.
(function () {
  'use strict';

  const M = window.Market;
  const { $, esc, fmtInt, fmt2, fmtPct, signed, cls, fmtUsd, fmtBtc, fmtDate } = M;
  const FIRST_FUNDS = 15, FIRST_HOLDERS = 25;
  const HEADLINE = ['IBIT', 'FBTC', 'ARKB'];
  const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];

  let etf = null, f13 = null, btcPrice = null;
  let showAllFunds = false, showAllHolders = false, f13Ticker = 'IBIT';

  const notice = (text) => { $('notice').textContent = text || ''; $('notice').hidden = !text; };
  const tile = (label, value, sub) => `
    <div class="stat"><p class="stat-label">${esc(label)}</p><p class="stat-value">${value}</p>${sub ? `<p class="stat-sub">${sub}</p>` : ''}</div>`;
  const dataUrl = (name) => `data/${name}?v=${Date.now()}`;

  async function loadBtcPrice() {
    for (const host of BINANCE_HOSTS) {
      try {
        const p = Number((await M.getJson(`${host}/api/v3/ticker/price?symbol=BTCUSDT`, 8000)).price);
        if (Number.isFinite(p) && p > 0) return p;
      } catch (e) {}
    }
    return null;
  }

  /* ---------- lượng BTC các quỹ ---------- */

  const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`);

  /** Thay đổi của một cột trong history so với lần ghi cách lần mới nhất ít nhất `days` ngày. */
  function changeOver(history, key, days) {
    if (!history.length) return null;
    const last = history[history.length - 1];
    const base = history.filter((h) => dayMs(h.date) <= dayMs(last.date) - days * 864e5).pop();
    if (!base || !Number.isFinite(base[key]) || !Number.isFinite(last[key])) return null;
    return last[key] - base[key];
  }
  const changeCell = (v) => `<td class="t-num ${v === null ? '' : cls(v)}">${v === null ? '–' : signed(v, fmtBtc)}</td>`;
  const usd = (btc) => (btcPrice ? esc(fmtUsd(btc * btcPrice)) : '–');

  function renderHoldings() {
    const h = etf.holdings;
    const history = h.history || [];
    const d1 = changeOver(history, 'total', 1);
    const tiles = [tile('Các ETF Bitcoin đang nắm', `${fmtBtc(h.totalBtc)} <span class="stat-unit">BTC</span>`,
      `${usd(h.totalBtc)} · ${fmtPct.format((h.totalBtc / 21e6) * 100)}% nguồn cung${d1 === null ? '' : ` · <span class="${cls(d1)}">${signed(d1, fmtBtc)} BTC</span> trong ngày`}`)];
    for (const t of HEADLINE) {
      const f = h.funds.find((x) => x.ticker === t);
      if (!f) continue;
      const d = changeOver(history, t, 1);
      tiles.push(tile(t, `${fmtBtc(f.btc)} <span class="stat-unit">BTC</span>`,
        `${usd(f.btc)}${d === null ? '' : ` · <span class="${cls(d)}">${signed(d, fmtBtc)}</span> trong ngày`}`));
    }
    $('stats').innerHTML = tiles.join('');

    M.lineChart($('trend-chart'), history.map((r) => [dayMs(r.date), r.total]), {
      label: 'Tổng BTC các ETF nắm', unit: 'BTC',
      empty: `Trang bắt đầu ghi từ ${history.length ? fmtDate(dayMs(history[0].date)) : 'hôm nay'}, mỗi ngày một điểm. Biểu đồ sẽ hiện khi có từ hai ngày dữ liệu.`,
    });

    const seen = new Set();
    const rows = (showAllFunds ? h.funds : h.funds.slice(0, FIRST_FUNDS)).map((f, i) => {
      // Hai quỹ trùng mã (khác sàn) thì history chỉ giữ quỹ lớn hơn; quỹ còn lại không có cột thay đổi.
      const tracked = f.ticker && !seen.has(f.ticker);
      seen.add(f.ticker);
      const chg = (days) => changeCell(tracked ? changeOver(history, f.ticker, days) : null);
      return `
        <tr>
          <td class="t-rank">${i + 1}</td>
          <td><strong>${esc(f.name)}</strong> <span class="sub">${esc([f.ticker, f.exchange].filter(Boolean).join(' · '))}</span></td>
          <td class="t-num"><strong>${fmtBtc(f.btc)}</strong></td>
          <td class="t-num">${usd(f.btc)}</td>
          <td class="t-num">${fmtPct.format((f.btc / h.totalBtc) * 100)}%</td>
          ${chg(1)}${chg(7)}${chg(30)}
        </tr>`;
    });
    $('funds-body').innerHTML = rows.join('');
    const more = $('funds-more');
    more.hidden = h.funds.length <= FIRST_FUNDS;
    more.textContent = showAllFunds ? 'Thu gọn' : `Xem tất cả ${h.funds.length} quỹ`;
  }

  /* ---------- 13F ---------- */

  const quarterLabel = (iso) => `quý ${Math.ceil(Number(iso.slice(5, 7)) / 3)}/${iso.slice(0, 4)}`;
  const edgarUrl = (cik) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(cik)}&type=13F-HR&dateb=&owner=include&count=40`;

  function render13F() {
    const e = f13.etfs[f13Ticker];
    $('f13-tabs').innerHTML = Object.keys(f13.etfs).map((t) =>
      `<button type="button" class="seg-btn" data-ticker="${esc(t)}" aria-pressed="${t === f13Ticker}">${esc(t)}</button>`).join('');
    const dHolders = e.holders - e.prevHolders;
    const dShares = e.prevShares ? (e.shares / e.prevShares - 1) * 100 : null;
    $('f13-facts').innerHTML = `
      <div><dt>Số tổ chức báo cáo nắm ${esc(f13Ticker)}</dt><dd>${fmtInt.format(e.holders)} <span class="sub ${cls(dHolders)}">${signed(dHolders, fmtInt.format)} so với quý trước</span></dd></div>
      <div><dt>Tổng cổ phiếu họ nắm</dt><dd>${fmtInt.format(e.shares)}${dShares === null ? '' : ` <span class="sub ${cls(dShares)}">${signed(dShares, fmtPct.format)}%</span>`}</dd></div>
      <div><dt>Giá trị cuối quý</dt><dd>${esc(fmtUsd(e.shares * e.price))}</dd></div>
      <div><dt>Giá cổ phiếu cuối quý</dt><dd>${fmt2.format(e.price)} USD</dd></div>`;

    const q = $('f13-search').value.trim().toLowerCase();
    const ranked = e.top.map((h, i) => ({ ...h, rank: i + 1 }));
    const matched = q ? ranked.filter((h) => h.name.toLowerCase().includes(q)) : ranked;
    const rows = q || showAllHolders ? matched : matched.slice(0, FIRST_HOLDERS);
    $('f13-body').innerHTML = rows.length ? rows.map((h) => {
      const diff = h.shares - h.prevShares;
      const change = !h.prevShares
        ? '<span class="badge">Mới</span>'
        : diff === 0 ? '<span class="sub">Không đổi</span>' : `<span class="${cls(diff)}">${signed(diff, fmtInt.format)} <span class="sub">(${signed((diff / h.prevShares) * 100, fmtPct.format)}%)</span></span>`;
      return `
        <tr>
          <td class="t-rank">${h.rank}</td>
          <td><a href="${esc(edgarUrl(h.cik))}" target="_blank" rel="noopener noreferrer"><strong>${esc(h.name)}</strong></a></td>
          <td class="t-num"><strong>${fmtInt.format(h.shares)}</strong></td>
          <td class="t-num">${esc(fmtUsd(h.shares * e.price))}</td>
          <td class="t-num">${change}</td>
          <td class="t-num">${fmtDate(dayMs(h.filed))}</td>
        </tr>`;
    }).join('') : `<tr><td colspan="6" class="chart-empty">Không có tổ chức nào khớp trong 100 tổ chức nắm nhiều ${esc(f13Ticker)} nhất.</td></tr>`;
    const more = $('f13-more');
    more.hidden = Boolean(q) || matched.length <= FIRST_HOLDERS;
    more.textContent = showAllHolders ? 'Thu gọn' : `Xem cả ${matched.length} tổ chức`;
  }

  /* ---------- tải ---------- */

  // Ba phần tải độc lập, phần nào xong hiện phần đó: giá BTC chậm hay lỗi không chặn bảng.
  const problems = new Set();
  const showProblems = () => notice([...problems].join(' '));
  const renderMeta = () => {
    $('meta').textContent = `Lượng BTC các quỹ ghi lúc ${M.fmtWhen(etf.holdings.updatedAt)}${btcPrice ? ` · BTC ${fmtInt.format(btcPrice)} USDT` : ''}`;
  };

  async function loadHoldings() {
    try {
      const data = await M.getJson(dataUrl('etf.json'));
      if (!data.holdings) throw new Error('thiếu holdings');
      etf = data;
      renderHoldings();
      renderMeta();
      if (Date.now() - Date.parse(etf.holdings.updatedAt) > 3 * 864e5) problems.add('Lượng BTC các quỹ đã hơn 3 ngày chưa cập nhật; có thể nguồn dữ liệu đang lỗi.');
    } catch (e) {
      $('meta').textContent = 'Chưa tải được dữ liệu';
      problems.add('Không tải được lượng BTC các quỹ.');
    }
    showProblems();
  }

  async function loadPrice() {
    btcPrice = await loadBtcPrice();
    if (!btcPrice) problems.add('Không lấy được giá BTC nên chưa quy ra USD.');
    if (etf) { renderHoldings(); renderMeta(); }
    showProblems();
  }

  async function load13F() {
    try {
      const data = await M.getJson(dataUrl('13f.json'));
      if (!data.etfs) throw new Error('thiếu etfs');
      f13 = data;
      $('f13-lead').innerHTML = `Số liệu <strong>${esc(quarterLabel(f13.period))}</strong> (chốt ngày ${fmtDate(dayMs(f13.period))}), so với ${esc(quarterLabel(f13.prevPeriod))}. Đây là nơi các tin kiểu "ngân hàng X mua IBIT" lấy số. Cập nhật lúc ${M.fmtWhen(f13.updatedAt)}.`;
      $('f13').hidden = false;
      render13F();
    } catch (e) {
      $('f13-lead').textContent = 'Không tải được dữ liệu 13F.';
    }
  }

  const load = () => Promise.all([loadHoldings(), loadPrice(), load13F()]);

  M.setupTheme();
  $('funds-more').addEventListener('click', () => { showAllFunds = !showAllFunds; renderHoldings(); });
  $('f13-more').addEventListener('click', () => { showAllHolders = !showAllHolders; render13F(); });
  $('f13-search').addEventListener('input', render13F);
  $('f13-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ticker]');
    if (!btn) return;
    f13Ticker = btn.dataset.ticker;
    showAllHolders = false;
    render13F();
  });
  load();
}());
