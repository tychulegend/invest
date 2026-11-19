// Trang "ETF Bitcoin": đọc data/etf.json và data/13f.json do tools/fetch-data.js ghi mỗi ngày
// (GitHub Actions), vì các nguồn gốc không cho trình duyệt gọi thẳng.
(function () {
  'use strict';

  const M = window.Market;
  const { $, esc, fmtInt, fmt2, fmtPct, signed, cls, fmtUsd, fmtBtc, fmtDate } = M;
  const FIRST_FUNDS = 15, FIRST_HOLDERS = 25;
  const HEADLINE = ['IBIT', 'FBTC', 'ARKB'];
  const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];

  const ALL = 'ALL';

  let etf = null, f13 = null, btcPrice = null, quarterBtc = null;
  let showAllFunds = false, showAllHolders = false, f13Ticker = ALL;

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

  const priceOf = (t) => (f13.etfs[t] && f13.etfs[t].price) || 0;
  const fundValue = (e) => e.shares * (e.price || 0);
  /** Giá trị cuối quý của một bộ {mã quỹ: số cổ phiếu}; dùng giá quý này cho cả số quý trước để chỉ còn lại phần mua/bán. */
  const valueOf = (shares) => Object.entries(shares || {}).reduce((s, [t, n]) => s + n * priceOf(t), 0);
  const toBtc = (usdValue) => (quarterBtc ? fmtBtc(usdValue / quarterBtc) : '–');
  const changeHtml = (now, before, fmt) => {
    const diff = now - before;
    if (!before) return '<span class="badge">Mới</span>';
    if (diff === 0) return '<span class="sub">Không đổi</span>';
    return `<span class="${cls(diff)}">${signed(diff, fmt)} <span class="sub">(${signed((diff / before) * 100, fmtPct.format)}%)</span></span>`;
  };

  /**
   * Giá BTC lúc chứng khoán Mỹ đóng cửa ngày chốt quý, để quy giá trị ETF ra số BTC nắm gián tiếp.
   * 16:00 New York là 20:00 UTC, riêng quý kết thúc 31/12 (giờ mùa đông) là 21:00 UTC.
   */
  async function loadQuarterBtc(period) {
    let day = dayMs(period);
    while ([0, 6].includes(new Date(day).getUTCDay())) day -= 864e5;
    const start = day + (new Date(day).getUTCMonth() === 11 ? 21 : 20) * 36e5;
    for (const host of BINANCE_HOSTS) {
      try {
        const k = await M.getJson(`${host}/api/v3/klines?symbol=BTCUSDT&interval=1h&startTime=${start}&limit=1`, 8000);
        const p = Number(k[0][1]);
        if (k[0][0] === start && Number.isFinite(p) && p > 0) return p;
      } catch (e) {}
    }
    return null;
  }

  function f13Tabs() {
    const tickers = Object.keys(f13.etfs).sort((a, b) => fundValue(f13.etfs[b]) - fundValue(f13.etfs[a]));
    const tabs = f13.all ? [[ALL, 'Tất cả'], ...tickers.map((t) => [t, t])] : tickers.map((t) => [t, t]);
    if (!tabs.some(([t]) => t === f13Ticker)) f13Ticker = tabs[0][0];
    $('f13-tabs').innerHTML = tabs.map(([t, label]) =>
      `<button type="button" class="seg-btn" data-ticker="${esc(t)}" aria-pressed="${t === f13Ticker}">${esc(label)}</button>`).join('');
  }

  function f13Rows(ranked, emptyText, rowHtml) {
    const q = $('f13-search').value.trim().toLowerCase();
    const matched = q ? ranked.filter((h) => h.name.toLowerCase().includes(q)) : ranked;
    const rows = q || showAllHolders ? matched : matched.slice(0, FIRST_HOLDERS);
    $('f13-body').innerHTML = rows.length ? rows.map(rowHtml).join('') : `<tr><td colspan="6" class="chart-empty">${esc(emptyText)}</td></tr>`;
    const more = $('f13-more');
    more.hidden = Boolean(q) || matched.length <= FIRST_HOLDERS;
    more.textContent = showAllHolders ? 'Thu gọn' : `Xem cả ${matched.length} tổ chức`;
  }

  /** Gộp mọi quỹ: mỗi tổ chức một dòng, cộng giá trị các quỹ họ nắm. */
  function render13FAll() {
    const a = f13.all, funds = Object.values(f13.etfs);
    const dHolders = a.holders - a.prevHolders;
    // Mua ròng = thay đổi số cổ phiếu từng quỹ nhân giá cuối quý, nên không lẫn phần tăng giá.
    const net = funds.reduce((s, e) => s + (e.shares - e.prevShares) * (e.price || 0), 0);
    $('f13-th-a').textContent = '≈ BTC';
    $('f13-facts').innerHTML = `
      <div><dt>Số tổ chức nắm ít nhất một quỹ</dt><dd>${fmtInt.format(a.holders)} <span class="sub ${cls(dHolders)}">${signed(dHolders, fmtInt.format)} so với quý trước</span></dd></div>
      <div><dt>Tổng giá trị họ nắm cuối quý</dt><dd>${esc(fmtUsd(a.value))} <span class="sub">quý trước ${esc(fmtUsd(a.prevValue))}</span></dd></div>
      <div><dt>Tương đương</dt><dd>≈ ${toBtc(a.value)} BTC${quarterBtc ? ` <span class="sub">giá BTC ngày chốt ${fmtInt.format(quarterBtc)} USD</span>` : ''}</dd></div>
      <div><dt>Mua ròng trong quý</dt><dd><span class="${cls(net)}">${signed(net, fmtUsd)}</span></dd></div>`;

    const ranked = a.top.map((h, i) => ({ ...h, rank: i + 1, value: valueOf(h.shares), before: valueOf(h.prevShares) }));
    f13Rows(ranked, 'Không có tổ chức nào khớp trong 100 tổ chức nắm nhiều nhất.', (h) => {
      const parts = Object.entries(h.shares).map(([t, n]) => [t, n * priceOf(t)]).sort((x, y) => y[1] - x[1]);
      const split = parts.slice(0, 3).map(([t, v]) => `${esc(t)} ${esc(fmtUsd(v))}`).join(' · ') + (parts.length > 3 ? ` · +${parts.length - 3} quỹ khác` : '');
      return `
        <tr>
          <td class="t-rank">${h.rank}</td>
          <td><a href="${esc(edgarUrl(h.cik))}" target="_blank" rel="noopener noreferrer"><strong>${esc(h.name)}</strong></a><span class="sub f13-split">${split}</span></td>
          <td class="t-num"><strong>${toBtc(h.value)}</strong></td>
          <td class="t-num">${esc(fmtUsd(h.value))}</td>
          <td class="t-num">${changeHtml(h.value, h.before, fmtUsd)}</td>
          <td class="t-num">${fmtDate(dayMs(h.filed))}</td>
        </tr>`;
    });
  }

  function render13F() {
    f13Tabs();
    if (f13Ticker === ALL) return render13FAll();
    const e = f13.etfs[f13Ticker];
    $('f13-th-a').textContent = 'Số cổ phiếu';
    const dHolders = e.holders - e.prevHolders;
    const dShares = e.prevShares ? (e.shares / e.prevShares - 1) * 100 : null;
    $('f13-facts').innerHTML = `
      <div><dt>Số tổ chức báo cáo nắm ${esc(f13Ticker)}</dt><dd>${fmtInt.format(e.holders)} <span class="sub ${cls(dHolders)}">${signed(dHolders, fmtInt.format)} so với quý trước</span></dd></div>
      <div><dt>Tổng cổ phiếu họ nắm</dt><dd>${fmtInt.format(e.shares)}${dShares === null ? '' : ` <span class="sub ${cls(dShares)}">${signed(dShares, fmtPct.format)}%</span>`}</dd></div>
      <div><dt>Giá trị cuối quý</dt><dd>${esc(fmtUsd(e.shares * e.price))}</dd></div>
      <div><dt>Giá cổ phiếu cuối quý</dt><dd>${fmt2.format(e.price)} USD</dd></div>`;

    f13Rows(e.top.map((h, i) => ({ ...h, rank: i + 1 })), `Không có tổ chức nào khớp trong 100 tổ chức nắm nhiều ${f13Ticker} nhất.`, (h) => `
        <tr>
          <td class="t-rank">${h.rank}</td>
          <td><a href="${esc(edgarUrl(h.cik))}" target="_blank" rel="noopener noreferrer"><strong>${esc(h.name)}</strong></a></td>
          <td class="t-num"><strong>${fmtInt.format(h.shares)}</strong></td>
          <td class="t-num">${esc(fmtUsd(h.shares * e.price))}</td>
          <td class="t-num">${changeHtml(h.shares, h.prevShares, fmtInt.format)}</td>
          <td class="t-num">${fmtDate(dayMs(h.filed))}</td>
        </tr>`);
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
      $('f13-lead').innerHTML = `Số liệu <strong>${esc(quarterLabel(f13.period))}</strong> (chốt ngày ${fmtDate(dayMs(f13.period))}), so với ${esc(quarterLabel(f13.prevPeriod))}. Đây là nơi các tin kiểu "ngân hàng X mua IBIT" lấy số. Một tổ chức có thể nắm nhiều quỹ cùng lúc; mục "Tất cả" cộng ${Object.keys(f13.etfs).length} quỹ lại theo từng tổ chức. Cập nhật lúc ${M.fmtWhen(f13.updatedAt)}.`;
      $('f13').hidden = false;
      render13F();
      // Giá BTC ngày chốt chỉ để quy ra "≈ BTC"; chậm hay lỗi thì cột đó để trống, bảng vẫn hiện.
      quarterBtc = await loadQuarterBtc(f13.period);
      if (quarterBtc) render13F();
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
