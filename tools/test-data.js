// Test phần đọc dữ liệu của tools/fetch-data.js (trang ETF). Không gọi mạng, không đụng sổ cổ phần.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('./fetch-data.js');

test('parseHoldings: đọc bảng ETF, xếp theo số BTC, lấy tổng từ bảng tổng hợp', () => {
  const big = '<tr><td>iShares Bitcoin Trust (Blackrock)</td><td></td><td>IBIT:NASDAQ</td><td>Filing</td><td>784,625.3</td><td>$1</td><td>3.7%</td></tr>';
  const html = `
    <table><tr><th>Category</th><th># of BTC</th></tr><tr><td>ETFs</td><td>1,449,138</td></tr></table>
    <table><tr><th>Entity</th><th>Country</th><th>Symbol:Exchange</th><th>Filings &amp; Sources</th><th># of BTC</th><th>Value Today</th><th>% of 21m</th></tr>
      <tr><td>ARK 21Shares</td><td></td><td>ARKB:CBOE</td><td>Filing</td><td>28,168.2</td><td>$1</td><td>0.1%</td></tr>${big}
      <tr><td>Rỗng</td><td></td><td>X:Y</td><td></td><td>0</td><td></td><td></td></tr></table>`;
  const out = D.parseHoldings(html);
  assert.equal(out.totalBtc, 1449138);
  assert.deepEqual(out.funds.map((f) => [f.ticker, f.exchange, f.btc]), [['IBIT', 'NASDAQ', 784625.3], ['ARKB', 'CBOE', 28168.2]]);
});

test('parseHoldings: số IBIT vô lý hoặc thiếu bảng thì báo lỗi, không ghi số sai', () => {
  assert.throws(() => D.parseHoldings('<table><tr><th>Entity</th></tr></table>'));
  const small = '<table><tr><th>Entity</th><th>Country</th><th>Symbol:Exchange</th><th># of BTC</th></tr><tr><td>iShares</td><td></td><td>IBIT:NASDAQ</td><td>12</td></tr></table>';
  assert.throws(() => D.parseHoldings(small), /IBIT/);
});

test('appendHoldingsHistory: mỗi ngày một dòng, chạy lại trong ngày thì ghi đè', () => {
  const snap = (btc) => ({ totalBtc: btc + 1, funds: [{ ticker: 'IBIT', exchange: 'NASDAQ', btc }, { ticker: 'IBIT', exchange: 'XETRA', btc: 5 }] });
  let h = D.appendHoldingsHistory(undefined, '2026-11-18', snap(100));
  h = D.appendHoldingsHistory(h, '2026-11-19', snap(110));
  h = D.appendHoldingsHistory(h, '2026-11-19', snap(120));
  assert.deepEqual(h, [{ date: '2026-11-18', total: 101, IBIT: 100 }, { date: '2026-11-19', total: 121, IBIT: 120 }]);
});

test('parseInfoTable: cộng các dòng cùng ETF, bỏ quyền chọn và chứng khoán khác', () => {
  const row = (cusip, sh, val, extra = '') => `<ns1:infoTable><ns1:nameOfIssuer>X</ns1:nameOfIssuer><ns1:cusip>${cusip}</ns1:cusip><ns1:value>${val}</ns1:value>
    <ns1:shrsOrPrnAmt><ns1:sshPrnamt>${sh}</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>${extra}</ns1:infoTable>`;
  const xml = row('46438F101', 100, 5000) + row('46438f101', 50, 2500) + row('46438F101', 999, 1, '<ns1:putCall>Put</ns1:putCall>')
    + row('037833100', 7, 7) + row('315948109', 10, 600).replace(/ns1:/g, '');
  assert.deepEqual(D.parseInfoTable(xml), { shares: { IBIT: 150, FBTC: 10 }, value: { IBIT: 7500, FBTC: 600 } });
});

test('f13Periods: chỉ lấy quý đã qua hạn nộp (45 ngày + 3 ngày dự phòng)', () => {
  assert.deepEqual(D.f13Periods('2026-11-17'), ['2026-09-30', '2026-06-30']);
  assert.deepEqual(D.f13Periods('2026-11-16'), ['2026-06-30', '2026-03-31']);
  assert.deepEqual(D.f13Periods('2027-01-20'), ['2026-09-30', '2026-06-30']);
  assert.deepEqual(D.f13Periods('2027-02-17'), ['2026-12-31', '2026-09-30']);
});

test('summarize13F: bản nộp sau thay bản trước, xếp theo số cổ phiếu, so với quý trước', () => {
  const f = (cik, filed, IBIT, value) => ({ cik, name: `Org ${cik}`, filed, form: '13F-HR', shares: { IBIT }, value: { IBIT: value } });
  const cur = { a1: f('1', '2026-11-01', 100, 5000), a2: f('1', '2026-11-10', 300, 15000), b1: f('2', '2026-11-05', 200, 10000), c1: { cik: '3', name: 'x', filed: '2026-11-05', shares: {}, value: {} } };
  const prev = { p1: f('1', '2026-08-01', 120, 4800) };
  const e = D.summarize13F('2026-09-30', '2026-06-30', cur, prev, 'now').etfs.IBIT;
  assert.equal(e.holders, 2);
  assert.equal(e.shares, 500);
  assert.equal(e.prevShares, 120);
  assert.equal(e.price, 50);
  assert.deepEqual(e.top.map((h) => [h.cik, h.shares, h.prevShares]), [['1', 300, 120], ['2', 200, 0]]);
});

test('summarize13F: gộp theo tổ chức trên mọi quỹ, kể cả quỹ đã bán hết trong quý', () => {
  const f = (cik, filed, shares, price) => ({
    cik, name: `Org ${cik}`, filed, form: '13F-HR', shares,
    value: Object.fromEntries(Object.entries(shares).map(([t, n]) => [t, n * price[t]])),
  });
  const p = { IBIT: 50, FBTC: 80, ARKB: 30 }, pp = { IBIT: 40, FBTC: 60, ARKB: 20 };
  const cur = {
    a1: f('1', '2026-11-01', { IBIT: 100, FBTC: 10 }, p), // 5000 + 800
    b1: f('2', '2026-11-05', { IBIT: 110 }, p), // 5500
    c1: f('3', '2026-11-06', { FBTC: 100 }, p), // 8000
  };
  const prev = {
    p1: f('1', '2026-08-01', { IBIT: 50, ARKB: 40 }, pp), // 2000 + 800, đã bán hết ARKB
    p4: f('4', '2026-08-02', { ARKB: 10 }, pp), // 200, quý này không còn nắm gì
  };
  const all = D.summarize13F('2026-09-30', '2026-06-30', cur, prev, 'now').all;
  assert.equal(all.holders, 3);
  assert.equal(all.prevHolders, 2);
  assert.equal(all.value, 19300);
  assert.equal(all.prevValue, 3000);
  assert.deepEqual(all.top.map((h) => h.cik), ['3', '1', '2']);
  assert.deepEqual(all.top[1], { cik: '1', name: 'Org 1', filed: '2026-11-01', shares: { IBIT: 100, FBTC: 10 }, prevShares: { IBIT: 50, ARKB: 40 } });
  assert.deepEqual(all.top[0].prevShares, {});
});

test('data/ đang commit: đúng cấu trúc trang ETF cần', () => {
  const dir = path.join(__dirname, '..', 'data');
  const etf = JSON.parse(fs.readFileSync(path.join(dir, 'etf.json'), 'utf8'));
  assert.ok(etf.holdings.totalBtc > 0 && etf.holdings.funds.length > 5 && etf.holdings.history.length >= 1);
  for (const h of etf.holdings.history) assert.match(h.date, /^\d{4}-\d{2}-\d{2}$/);
  const f13 = JSON.parse(fs.readFileSync(path.join(dir, '13f.json'), 'utf8'));
  const tickers = D.F13_ETFS.map((e) => e.ticker);
  assert.deepEqual(Object.keys(f13.etfs).sort(), [...tickers].sort());
  for (const t of tickers) {
    const e = f13.etfs[t];
    assert.ok(e.holders > 0 && e.price > 0 && e.top.length > 0, t);
    for (const h of e.top) assert.ok(h.name && Number.isInteger(h.shares) && h.shares > 0 && h.prevShares >= 0, `${t} ${h.name}`);
  }
  // Phần gộp: mỗi tổ chức một dòng, xếp giảm dần theo tổng giá trị, và không vượt tổng của các quỹ.
  const a = f13.all, valueOf = (h) => Object.entries(h.shares).reduce((s, [t, n]) => s + n * f13.etfs[t].price, 0);
  assert.ok(a.holders >= Math.max(...tickers.map((t) => f13.etfs[t].holders)) && a.value > 0 && a.top.length > 0);
  assert.equal(new Set(a.top.map((h) => h.cik)).size, a.top.length);
  let last = Infinity, sum = 0;
  for (const h of a.top) {
    const v = valueOf(h);
    assert.ok(h.name && v > 0 && v <= last + 1e-6, h.name);
    for (const [t, n] of [...Object.entries(h.shares), ...Object.entries(h.prevShares)]) assert.ok(tickers.includes(t) && Number.isInteger(n) && n > 0, `${h.name} ${t}`);
    last = v; sum += v;
  }
  assert.ok(sum <= a.value * 1.000001);
});
