// Trang "Công ty tích luỹ Bitcoin": gọi thẳng API công khai của CoinGecko từ trình duyệt.
(function () {
  'use strict';

  const M = window.Market;
  const { $, esc, fmtInt, fmt2, fmtPct, signed, cls, fmtUsd, fmtBtc, fmtDate } = M;
  const API = 'https://api.coingecko.com/api/v3';
  const MIN = 60_000;
  const LIST_TTL = 10 * MIN, DETAIL_TTL = 60 * MIN, ENTITY_TTL = 24 * 60 * MIN;
  const FIRST_ROWS = 30, TX_ROWS = 12;

  let companies = [];
  let showAll = false;
  let selected = null; // symbol của công ty đang xem chi tiết
  let detailSeq = 0;

  const notice = (text) => { $('notice').textContent = text || ''; $('notice').hidden = !text; };
  const tile = (label, value, sub) => `
    <div class="stat"><p class="stat-label">${esc(label)}</p><p class="stat-value">${value}</p>${sub ? `<p class="stat-sub">${sub}</p>` : ''}</div>`;

  /* ---------- bảng ---------- */

  function renderStats(co, gov) {
    const holders = co.companies.filter((c) => c.total_holdings > 0).length;
    $('stats').innerHTML = [
      tile('Công ty đại chúng đang nắm', `${fmtBtc(co.total_holdings)} <span class="stat-unit">BTC</span>`, `${esc(fmtUsd(co.total_value_usd))} · ${fmtInt.format(holders)} công ty`),
      tile('Tỷ lệ trên nguồn cung', `${fmtPct.format((co.total_holdings / 21e6) * 100)}<span class="stat-unit">%</span>`, 'của 21 triệu BTC'),
      gov ? tile('Chính phủ đang nắm', `${fmtBtc(gov.total_holdings)} <span class="stat-unit">BTC</span>`, `${esc(fmtUsd(gov.total_value_usd))} · ${fmtPct.format((gov.total_holdings / 21e6) * 100)}% nguồn cung`) : '',
    ].join('');
  }

  function renderCompanies() {
    const rows = showAll ? companies : companies.slice(0, FIRST_ROWS);
    $('companies-body').innerHTML = rows.map((c, i) => {
      const hasCost = c.total_entry_value_usd > 0;
      const pnl = hasCost ? (c.total_current_value_usd / c.total_entry_value_usd - 1) * 100 : 0;
      return `
        <tr class="is-click${c.symbol === selected ? ' is-selected' : ''}" data-symbol="${esc(c.symbol || '')}" tabindex="0" role="button" aria-label="Xem chi tiết ${esc(c.name)}">
          <td class="t-rank">${i + 1}</td>
          <td><strong>${esc(c.name)}</strong> <span class="sub">${esc([c.symbol, c.country].filter(Boolean).join(' · '))}</span></td>
          <td class="t-num"><strong>${fmtBtc(c.total_holdings)}</strong></td>
          <td class="t-num">${esc(fmtUsd(c.total_current_value_usd))}</td>
          <td class="t-num">${fmtPct.format(c.percentage_of_total_supply)}%</td>
          <td class="t-num">${hasCost ? fmtInt.format(c.total_entry_value_usd / c.total_holdings) : '–'}</td>
          <td class="t-num ${cls(pnl)}">${hasCost ? `${signed(pnl, fmtPct.format)}%` : '–'}</td>
        </tr>`;
    }).join('');
    const more = $('companies-more');
    more.hidden = companies.length <= FIRST_ROWS;
    more.textContent = showAll ? 'Thu gọn' : `Xem tất cả ${companies.length} công ty`;
  }

  function renderGov(gov) {
    $('gov-body').innerHTML = gov.governments.filter((g) => g.total_holdings > 0).map((g, i) => `
      <tr>
        <td class="t-rank">${i + 1}</td>
        <td><strong>${esc(g.name)}</strong></td>
        <td class="t-num"><strong>${fmtBtc(g.total_holdings)}</strong></td>
        <td class="t-num">${esc(fmtUsd(g.total_current_value_usd))}</td>
        <td class="t-num">${fmtPct.format(g.percentage_of_total_supply)}%</td>
      </tr>`).join('');
  }

  /* ---------- chi tiết một công ty ---------- */

  /** API chi tiết cần mã thực thể (vd "strategy"); bảng xếp hạng chỉ có mã chứng khoán nên phải tra. */
  async function entityId(symbol) {
    const { data } = await M.cachedJson('entities', `${API}/entities/list?per_page=250`, ENTITY_TTL);
    const hit = data.find((e) => e.symbol === symbol);
    return hit ? hit.id : null;
  }

  function renderDetail(c, txs) {
    const btcTx = txs.filter((t) => t.coin_id === 'bitcoin' && Number.isFinite(t.holding_balance)).sort((a, b) => a.date - b.date);
    const now = Date.now();
    const points = btcTx.map((t) => [t.date, t.holding_balance]);
    if (points.length) points.push([Math.max(now, points[points.length - 1][0]), c.total_holdings]);
    // Mức thay đổi trong N ngày = số dư hiện tại trừ số dư ngay trước mốc đó.
    const since = (days) => {
      const before = btcTx.filter((t) => t.date < now - days * 864e5).pop();
      return before ? c.total_holdings - before.holding_balance : null;
    };
    const pace = [[30, '30 ngày'], [90, '90 ngày'], [365, '1 năm']].map(([d, label]) => {
      const v = since(d);
      return `<div><dt>${label} qua</dt><dd class="${v === null ? '' : cls(v)}">${v === null ? '–' : `${signed(v, fmtBtc)} BTC`}</dd></div>`;
    }).join('');
    const hasCost = c.total_entry_value_usd > 0;
    const recent = btcTx.slice().reverse();
    const txRow = (t) => {
      const buy = t.holding_net_change >= 0;
      const price = t.transaction_value_usd > 0 && t.holding_net_change ? t.transaction_value_usd / Math.abs(t.holding_net_change) : 0;
      const safeUrl = /^https:\/\//.test(t.source_url || '') ? t.source_url : '';
      return `
        <tr>
          <td>${fmtDate(t.date)}</td>
          <td class="${buy ? 'up' : 'down'}"><strong>${buy ? 'Mua' : 'Bán'}</strong></td>
          <td class="t-num"><strong>${signed(t.holding_net_change, fmtBtc)}</strong></td>
          <td class="t-num">${t.transaction_value_usd > 0 ? esc(fmtUsd(t.transaction_value_usd)) : '–'}</td>
          <td class="t-num">${price ? fmtInt.format(price) : '–'}</td>
          <td class="t-num">${fmtBtc(t.holding_balance)}</td>
          <td>${safeUrl ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">Nguồn</a>` : ''}</td>
        </tr>`;
    };
    $('detail').innerHTML = `
      <dl class="contrib-facts">
        <div><dt>Đang nắm</dt><dd>${fmtBtc(c.total_holdings)} BTC</dd></div>
        ${pace}
        <div><dt>Giá vốn trung bình</dt><dd>${hasCost ? `${fmtInt.format(c.total_entry_value_usd / c.total_holdings)} USD` : '–'}</dd></div>
      </dl>
      <h3 class="sub-title">Lượng BTC nắm giữ theo thời gian</h3>
      <div class="chart-wrap" id="detail-chart"></div>
      <h3 class="sub-title">Các lần mua bán</h3>
      ${recent.length ? `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Ngày</th><th></th><th class="t-num">Số BTC</th><th class="t-num">Giá trị</th><th class="t-num">Giá mỗi BTC (USD)</th><th class="t-num">Số dư sau đó</th><th></th></tr></thead>
          <tbody id="tx-body">${recent.slice(0, TX_ROWS).map(txRow).join('')}</tbody>
        </table>
      </div>
      ${recent.length > TX_ROWS ? `<button type="button" class="btn btn-more" id="tx-more">Xem cả ${recent.length} lần</button>` : ''}`
        : '<p class="chart-empty">Nguồn chưa có lịch sử mua bán của công ty này.</p>'}`;
    M.lineChart($('detail-chart'), points, { label: `Lượng BTC của ${c.name}`, unit: 'BTC', step: true, empty: 'Nguồn chưa có lịch sử để vẽ biểu đồ.' });
    const more = $('tx-more');
    if (more) more.addEventListener('click', () => { $('tx-body').innerHTML = recent.map(txRow).join(''); more.remove(); });
  }

  async function showDetail(symbol, { scroll = false } = {}) {
    const c = companies.find((x) => x.symbol === symbol);
    if (!c) return;
    const seq = ++detailSeq;
    selected = symbol;
    renderCompanies();
    $('detail-panel').hidden = false;
    $('detail-title').textContent = c.name;
    $('detail').innerHTML = '<p class="chart-empty">Đang tải lịch sử…</p>';
    if (scroll) $('detail-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const id = await entityId(symbol);
      if (seq !== detailSeq) return;
      if (!id) { $('detail').innerHTML = '<p class="chart-empty">Nguồn không có trang chi tiết cho công ty này.</p>'; return; }
      const { data } = await M.cachedJson(`tx:${id}`, `${API}/public_treasury/${encodeURIComponent(id)}/transaction_history?per_page=250`, DETAIL_TTL);
      if (seq !== detailSeq) return;
      renderDetail(c, (data && data.transactions) || []);
    } catch (e) {
      if (seq !== detailSeq) return;
      $('detail').innerHTML = `<p class="chart-empty">${esc(M.errorText(e))}</p><button type="button" class="btn btn-more" id="detail-retry">Thử lại</button>`;
      $('detail-retry').addEventListener('click', () => showDetail(symbol));
    }
  }

  /* ---------- tải ---------- */

  async function load(force = false) {
    $('refresh').disabled = true;
    notice('');
    try {
      const co = await M.cachedJson('companies', `${API}/companies/public_treasury/bitcoin`, LIST_TTL, { force });
      let gov = null;
      try { gov = await M.cachedJson('governments', `${API}/governments/public_treasury/bitcoin`, LIST_TTL, { force }); } catch (e) {}
      companies = co.data.companies.filter((c) => c.total_holdings > 0).sort((a, b) => b.total_holdings - a.total_holdings);
      renderStats(co.data, gov && gov.data);
      renderCompanies();
      if (gov) renderGov(gov.data);
      else $('gov-body').innerHTML = '<tr><td colspan="5" class="chart-empty">Không tải được danh sách chính phủ.</td></tr>';
      $('meta').textContent = `Nguồn: CoinGecko · tải lúc ${M.fmtWhen(co.at)}`;
      if (co.stale) notice(`${M.errorText(co.error)} Đang hiện số đã lưu lúc ${M.fmtWhen(co.at)}.`);
      if (companies.length) await showDetail(selected && companies.some((c) => c.symbol === selected) ? selected : companies[0].symbol);
    } catch (e) {
      $('meta').textContent = 'Chưa tải được dữ liệu';
      notice(M.errorText(e));
    } finally {
      $('refresh').disabled = false;
    }
  }

  M.setupTheme();
  $('refresh').addEventListener('click', () => load(true));
  $('companies-more').addEventListener('click', () => { showAll = !showAll; renderCompanies(); });
  const pick = (e) => {
    const tr = e.target.closest('tr[data-symbol]');
    if (!tr || !tr.dataset.symbol) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    showDetail(tr.dataset.symbol, { scroll: true });
  };
  $('companies-body').addEventListener('click', pick);
  $('companies-body').addEventListener('keydown', pick);
  load();
}());
