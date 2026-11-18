#!/usr/bin/env node
// Gom dữ liệu cho trang ETF (etf.html) vào thư mục data/. Chạy mỗi ngày bằng GitHub Actions
// (.github/workflows/data.yml) vì hai nguồn dưới đây không cho trình duyệt gọi thẳng (không CORS):
//   - holdings: lượng BTC từng quỹ đang nắm (bitbo.io/treasuries). Mỗi ngày lưu một dòng vào
//               history; trang tự tính dòng BTC vào/ra từ chênh lệch giữa các ngày.
//   - 13f:      tổ chức nào nắm cổ phiếu IBIT/FBTC/ARKB theo báo cáo 13F nộp SEC (EDGAR).
// Không đụng tới sổ cổ phần (core.js, calculated.js, portfolio.js).
//
//   node tools/fetch-data.js              # cả hai
//   node tools/fetch-data.js holdings     # chỉ phần nêu tên
//
// Mỗi phần độc lập: phần nào lỗi thì giữ nguyên số cũ của phần đó, các phần khác vẫn ghi.
// Luôn xưng đúng là bot (BOT_UA); nguồn nào chặn bot thì không dùng, không giả làm trình duyệt.
// Có phần lỗi thì thoát mã 2 để workflow báo đỏ (nhưng vẫn commit phần đã lấy được).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ETF_FILE = path.join(DATA_DIR, 'etf.json');
const F13_FILE = path.join(DATA_DIR, '13f.json');
const F13_CACHE_DIR = path.join(DATA_DIR, '13f-cache');

// CUSIP là mã định danh chứng khoán dùng trong 13F; tra theo mã chắc hơn theo tên quỹ.
const F13_ETFS = [
  { ticker: 'IBIT', cusip: '46438F101', name: 'iShares Bitcoin Trust (BlackRock)' },
  { ticker: 'FBTC', cusip: '315948109', name: 'Fidelity Wise Origin Bitcoin Fund' },
  { ticker: 'ARKB', cusip: '040919102', name: 'ARK 21Shares Bitcoin ETF' },
];
const F13_TOP = 100;
// Hạn nộp 13F là 45 ngày sau khi quý kết thúc; trước hạn thì quý đó mới có lác đác vài báo cáo.
// Cộng thêm 3 ngày: hạn rơi vào cuối tuần thì dời sang thứ Hai, và các tổ chức lớn nhất hay nộp sát hạn.
const F13_DEADLINE_DAYS = 48;

const BOT_UA = 'family-dashboard-bot/1.0 (static site data fetcher)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isoDay = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5));

/** GET có giới hạn thời gian và thử lại khi lỗi mạng / 429 / 5xx. */
async function get(url, { as = 'text', tries = 4, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(1500 * 2 ** (i - 1));
    try {
      const res = await fetch(url, { headers: { 'User-Agent': BOT_UA, Accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`HTTP ${res.status} ${url}`); continue; }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${url}`), { fatal: true });
      return as === 'json' ? await res.json() : await res.text();
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
};
const writeJson = (file, value, pretty = false) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, pretty ? 1 : 0)}\n`);
};

/** Bảng HTML thành mảng dòng, mỗi dòng là mảng chữ trong ô. */
function parseTables(html) {
  return (html.match(/<table[\s\S]*?<\/table>/g) || []).map((t) =>
    (t.match(/<tr[\s\S]*?<\/tr>/g) || []).map((r) =>
      (r.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map((c) =>
        c.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())));
}

/* ---------- holdings: bitbo ---------- */

const num = (s) => Number(String(s).replace(/[$,%]/g, ''));

function parseHoldings(html) {
  const tables = parseTables(html);
  const etfTable = tables.find((rows) => rows[0] && rows[0].includes('Symbol:Exchange') && rows.some((r) => /^IBIT:/.test(r[2] || '')));
  if (!etfTable) throw new Error('Không thấy bảng ETF (có cột Symbol:Exchange và dòng IBIT)');
  const head = etfTable[0];
  const iName = head.indexOf('Entity'), iSym = head.indexOf('Symbol:Exchange'), iBtc = head.indexOf('# of BTC');
  if (iName < 0 || iBtc < 0) throw new Error('Bảng ETF thiếu cột Entity hoặc # of BTC');
  const funds = [];
  for (const r of etfTable.slice(1)) {
    const btc = num(r[iBtc]);
    const [ticker, exchange] = String(r[iSym] || '').split(':');
    if (!r[iName] || !Number.isFinite(btc) || btc <= 0) continue;
    funds.push({ ticker: ticker || '', exchange: exchange || '', name: r[iName], btc });
  }
  funds.sort((a, b) => b.btc - a.btc);
  const ibit = funds.find((f) => f.ticker === 'IBIT');
  if (!ibit || ibit.btc < 100000) throw new Error('Số BTC của IBIT không hợp lý, nghi là đọc sai');
  const summary = tables.find((rows) => rows[0] && rows[0][0] === 'Category');
  const etfRow = summary && summary.find((r) => r[0] === 'ETFs');
  const total = etfRow ? num(etfRow[1]) : NaN;
  return { funds, totalBtc: Number.isFinite(total) && total > 0 ? total : funds.reduce((s, f) => s + f.btc, 0) };
}

/** Mỗi ngày giữ một dòng (lần chạy sau trong ngày ghi đè), để tự có biểu đồ tích luỹ theo thời gian. */
function appendHoldingsHistory(history, today, snap) {
  const row = { date: today, total: snap.totalBtc };
  for (const f of snap.funds) if (f.ticker && f.exchange !== '' && row[f.ticker] === undefined) row[f.ticker] = f.btc;
  const out = (history || []).filter((h) => h.date !== today);
  out.push(row);
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function fetchHoldings() {
  return { source: 'bitbo.io', ...parseHoldings(await get('https://bitbo.io/treasuries/')) };
}

/* ---------- 13F: SEC EDGAR ---------- */

/** Hai quý gần nhất đã qua hạn nộp: [quý mới, quý trước], dạng YYYY-MM-DD (ngày cuối quý). */
function f13Periods(today) {
  const ends = [];
  let y = Number(today.slice(0, 4)) + 1;
  while (ends.length < 2) {
    for (const md of ['12-31', '09-30', '06-30', '03-31']) {
      const end = `${y}-${md}`;
      if (addDays(end, F13_DEADLINE_DAYS) <= today && ends.length < 2) ends.push(end);
    }
    y--;
  }
  return ends;
}

/** SEC cho tối đa 10 lần gọi mỗi giây; chạy 4 luồng, mỗi lần cách nhau một nhịp. */
async function pool(items, worker, size = 4, gapMs = 220) {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const item = items[i++];
      await worker(item);
      await sleep(gapMs);
    }
  };
  await Promise.all(Array.from({ length: size }, run));
}

/** Danh sách báo cáo 13F của một quý có nhắc tới CUSIP, qua tìm kiếm toàn văn của EDGAR. */
async function listFilings(cusip, period, today) {
  const end = addDays(period, 200) < today ? addDays(period, 200) : today;
  const base = `https://efts.sec.gov/LATEST/search-index?q=%22${cusip}%22&forms=13F-HR&dateRange=custom&startdt=${addDays(period, 1)}&enddt=${end}`;
  const out = [];
  for (let from = 0; ; from += 100) {
    const page = await get(`${base}&from=${from}`, { as: 'json' });
    const hits = (page.hits && page.hits.hits) || [];
    for (const h of hits) {
      const s = h._source || {};
      const [adsh, file] = String(h._id).split(':');
      if (s.period_ending !== period || !adsh || !file || !(s.ciks && s.ciks[0])) continue;
      out.push({
        adsh, file, cik: String(Number(s.ciks[0])), filed: s.file_date, form: s.form,
        name: String((s.display_names && s.display_names[0]) || '').replace(/\s*\(CIK \d+\)\s*$/, '').replace(/\s+/g, ' ').trim(),
      });
    }
    const total = (page.hits && page.hits.total && page.hits.total.value) || 0;
    if (!hits.length || from + 100 >= total || from >= 9900) break;
    await sleep(200);
  }
  return out;
}

/** Cộng số cổ phiếu và giá trị từng ETF trong một bảng 13F. Bỏ quyền chọn (put/call). */
function parseInfoTable(xml) {
  const byCusip = Object.fromEntries(F13_ETFS.map((e) => [e.cusip, e.ticker]));
  const tag = (block, name) => {
    const m = new RegExp(`<(?:\\w+:)?${name}>\\s*([^<]*?)\\s*<`, 'i').exec(block);
    return m ? m[1] : '';
  };
  const shares = {}, value = {};
  for (const m of xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi)) {
    const ticker = byCusip[tag(m[1], 'cusip').toUpperCase()];
    if (!ticker || tag(m[1], 'putCall') || tag(m[1], 'sshPrnamtType').toUpperCase() !== 'SH') continue;
    const sh = Number(tag(m[1], 'sshPrnamt')), val = Number(tag(m[1], 'value'));
    if (!Number.isFinite(sh) || sh <= 0) continue;
    shares[ticker] = (shares[ticker] || 0) + sh;
    value[ticker] = (value[ticker] || 0) + (Number.isFinite(val) ? val : 0);
  }
  return { shares, value };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/**
 * Gom mọi báo cáo của một quý vào cache (data/13f-cache/<quý>.json), chỉ tải báo cáo chưa có.
 * @returns {Object<string, {cik, name, filed, form, shares, value}>} theo số hồ sơ (adsh)
 */
async function loadPeriod(period, today) {
  const file = path.join(F13_CACHE_DIR, `${period}.json`);
  const cache = readJson(file, {});
  const wanted = new Map();
  for (const etf of F13_ETFS) {
    const list = await listFilings(etf.cusip, period, today);
    console.log(`  13F ${period} ${etf.ticker}: ${list.length} báo cáo`);
    for (const f of list) if (!wanted.has(f.adsh)) wanted.set(f.adsh, f);
  }
  const todo = [...wanted.values()].filter((f) => !cache[f.adsh]);
  let done = 0, failed = 0;
  await pool(todo, async (f) => {
    try {
      const xml = await get(`https://www.sec.gov/Archives/edgar/data/${f.cik}/${f.adsh.replace(/-/g, '')}/${f.file}`, { timeoutMs: 120000 });
      cache[f.adsh] = { cik: f.cik, name: f.name, filed: f.filed, form: f.form, ...parseInfoTable(xml) };
    } catch (e) {
      failed++;
      console.warn(`  bỏ qua ${f.adsh}: ${e.message}`);
    }
    if (++done % 200 === 0) { console.log(`  đã tải ${done}/${todo.length}`); writeJson(file, cache); }
  });
  if (todo.length) writeJson(file, cache);
  if (failed > Math.max(20, todo.length * 0.05)) throw new Error(`${failed}/${todo.length} báo cáo quý ${period} tải lỗi`);
  return cache;
}

/**
 * Với mỗi tổ chức lấy báo cáo nộp sau cùng có nhắc tới ETF đó (bản sửa đổi thay cho bản gốc).
 * @returns {Map<string, {cik, name, filed, shares, value}>} theo CIK
 */
function holdersOf(cache, ticker) {
  const byCik = new Map();
  for (const [adsh, f] of Object.entries(cache)) {
    const shares = f.shares && f.shares[ticker];
    if (!shares) continue;
    const cur = byCik.get(f.cik);
    if (!cur || f.filed > cur.filed || (f.filed === cur.filed && adsh > cur.adsh)) {
      byCik.set(f.cik, { adsh, cik: f.cik, name: f.name, filed: f.filed, shares, value: (f.value && f.value[ticker]) || 0 });
    }
  }
  return byCik;
}

/** Giá cổ phiếu cuối quý suy từ trung vị giá trị/số cổ phiếu, để không lệ thuộc vào báo cáo ghi sai đơn vị. */
const impliedPrice = (holders) => {
  const p = median([...holders.values()].filter((h) => h.value > 0).map((h) => h.value / h.shares));
  return p === null ? null : Math.round(p * 100) / 100;
};

/** EDGAR ghi tên kèm mã chứng khoán và bang đăng ký: "WELLS FARGO & COMPANY/MN (WFC, WFC-PA)" thành "WELLS FARGO & COMPANY". */
const cleanName = (name) => String(name).replace(/\s*\([A-Z0-9][A-Z0-9,. -]*\)\s*$/, '').replace(/\s*\/[A-Z]{2}\/?$/, '').trim();

function summarize13F(period, prevPeriod, cur, prev, updatedAt) {
  const etfs = {};
  for (const etf of F13_ETFS) {
    const now = holdersOf(cur, etf.ticker), before = holdersOf(prev, etf.ticker);
    const sum = (m) => [...m.values()].reduce((s, h) => s + h.shares, 0);
    const top = [...now.values()].sort((a, b) => b.shares - a.shares).slice(0, F13_TOP)
      .map((h) => ({ cik: h.cik, name: cleanName(h.name), filed: h.filed, shares: h.shares, prevShares: before.has(h.cik) ? before.get(h.cik).shares : 0 }));
    etfs[etf.ticker] = {
      name: etf.name, cusip: etf.cusip,
      price: impliedPrice(now), prevPrice: impliedPrice(before),
      holders: now.size, prevHolders: before.size,
      shares: sum(now), prevShares: sum(before),
      top,
    };
  }
  return { source: 'sec.gov EDGAR 13F', updatedAt, period, prevPeriod, etfs };
}

async function fetch13F(today, updatedAt) {
  const [period, prevPeriod] = f13Periods(today);
  const cur = await loadPeriod(period, today);
  const prev = await loadPeriod(prevPeriod, today);
  const out = summarize13F(period, prevPeriod, cur, prev, updatedAt);
  for (const etf of F13_ETFS) {
    const e = out.etfs[etf.ticker];
    if (!e.holders || !e.price) throw new Error(`13F ${etf.ticker} quý ${period} không có tổ chức nào, nghi là sai CUSIP`);
  }
  // Chỉ giữ cache của hai quý đang dùng.
  for (const f of fs.readdirSync(F13_CACHE_DIR)) {
    if (f !== `${period}.json` && f !== `${prevPeriod}.json`) fs.unlinkSync(path.join(F13_CACHE_DIR, f));
  }
  return out;
}

/* ---------- chạy ---------- */

async function main() {
  const want = process.argv.slice(2);
  const on = (name) => !want.length || want.includes(name);
  const now = new Date();
  const today = isoDay(now), updatedAt = now.toISOString();
  const etf = readJson(ETF_FILE, {});
  const failed = [];
  let etfChanged = false;

  if (on('holdings')) {
    try {
      const snap = await fetchHoldings();
      etf.holdings = { updatedAt, ...snap, history: appendHoldingsHistory(etf.holdings && etf.holdings.history, today, snap) };
      etfChanged = true;
      console.log(`holdings: ${snap.funds.length} quỹ, tổng ${snap.totalBtc} BTC`);
    } catch (e) { failed.push(`holdings: ${e.message}`); }
  }
  if (etfChanged) writeJson(ETF_FILE, etf);

  if (on('13f')) {
    try {
      const out = await fetch13F(today, updatedAt);
      writeJson(F13_FILE, out);
      console.log(`13f: quý ${out.period}, ${F13_ETFS.map((e) => `${e.ticker} ${out.etfs[e.ticker].holders} tổ chức`).join(', ')}`);
    } catch (e) { failed.push(`13f: ${e.message}`); }
  }

  if (failed.length) {
    console.error(`CÓ PHẦN LỖI (giữ số cũ của phần đó):\n- ${failed.join('\n- ')}`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { parseHoldings, parseInfoTable, appendHoldingsHistory, f13Periods, holdersOf, summarize13F };
