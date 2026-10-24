// Test phần tính tiền (core.js) và dữ liệu thật trong calculated.js.
// Chạy: npm test  (dùng node:test có sẵn của Node, tương tự PHPUnit, không cần cài gì thêm)
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../core.js');
const { readPortfolio, loadState, git, isGitRepo } = require('./load.js');

// Cấu hình mẫu cố định cho các test logic, để thêm tài sản hay đổi đơn vị trong portfolio.js
// thật không làm đỏ cả bộ test. Sổ thật được kiểm tra riêng ở cuối file.
// Quỹ bắt đầu với 1.000.000 cổ phần của Legend; mọi thay đổi sau đó phải nằm trong history.
const INITIAL = { Legend: 1000000 };
const PORTFOLIO = {
  name: 'Quỹ test',
  initialShares: INITIAL,
  contributionAsset: 'cash',
  assets: [
    { id: 'btc', name: 'Bitcoin', ticker: 'BTC', unit: 'BTC', pair: 'BTCUSDT' },
    { id: 'gold', name: 'Vàng', ticker: 'XAUT', unit: 'oz', pair: 'XAUTUSDT' },
    { id: 'cash', name: 'Tiền mặt', ticker: 'USDT', unit: 'USDT', price: 1 },
  ],
};
const INITIAL_SHARES = Object.values(INITIAL).reduce((a, b) => a + b, 0);
const PRICES = { BTCUSDT: { last: 80841.06, open: 81792.96 }, XAUTUSDT: { last: 3996.98, open: 4017.54 } };
const START = {
  updatedAt: '2026-10-24',
  totalShares: INITIAL_SHARES,
  amounts: { btc: 1, gold: 1, cash: 4000 },
  units: { btc: 'BTC', gold: 'oz', cash: 'USDT' },
  shareholders: [
    { name: 'Legend', shares: INITIAL.Legend },
    { name: 'Cam', shares: 0 },
    { name: 'Bến Tre', shares: 0 },
    { name: 'Tóc Vàng Hoe', shares: 0 },
    { name: 'Cháu Gái Dễ Thương', shares: 0 },
  ],
  history: [],
};

const cents = F.toCents;
const state0 = () => F.merge(PORTFOLIO, structuredClone(START));
const val = (s, prices = PRICES) => F.valuation(s, prices);
const run = (s, tx, prices = PRICES) => {
  const v = val(s, prices);
  const plan = F.planTx(s, v, tx);
  if (plan.error) throw new Error(plan.error);
  return { plan, next: F.applyTx(s, plan, '2026-10-24'), p: v.price };
};
// Bộ sinh số ngẫu nhiên có seed (mulberry32), lặp lại được giữa các lần chạy.
const rng = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Xuất rồi đọc lại phải ra đúng state đó. */
const assertRoundTrip = (st) => assert.ok(F.sameLedger(F.merge(PORTFOLIO, F.evalCalculated(F.toSource(st))), st), 'xuất rồi đọc lại khớp');

/** Bất biến phải đúng sau mọi giao dịch hợp lệ. */
function checkInvariants(before, after, plan, prices = PRICES, { roundTrip = true } = {}) {
  const sum = after.shareholders.reduce((t, h) => t + h.shares, 0);
  assert.equal(sum, after.totalShares, 'tổng cổ phần cổ đông = totalShares');
  after.shareholders.forEach((h) => assert.ok(Number.isInteger(h.shares) && h.shares >= 0, `${h.name} có số cổ phần nguyên không âm`));
  assert.deepEqual(F.validate(after), [], 'state sau giao dịch hợp lệ');

  const sign = plan.kind === 'gop' ? 1 : -1;
  assert.equal(cents(F.cashAsset(after).amount), cents(F.cashAsset(before).amount) + sign * plan.cents, 'tiền mặt đổi đúng bằng số tiền giao dịch, theo cent');
  assert.ok(Number.isInteger(plan.cents) && plan.cents > 0, 'số tiền là số cent nguyên dương');

  const vB = val(before, prices);
  const vA = val(after, prices);
  // Làm tròn luôn có lợi cho quỹ nên giá cổ phần chỉ đứng yên hoặc nhích lên, tối đa bằng
  // giá trị 1 cổ phần chia đều cho cả quỹ.
  assert.ok(vA.price >= vB.price - 1e-12, `giá cổ phần không giảm vì giao dịch (${vB.price} -> ${vA.price})`);
  assert.ok(vA.price - vB.price <= vB.price / after.totalShares + 1e-12, `giá cổ phần không nhảy (${vB.price} -> ${vA.price})`);

  // Người giao dịch không được lợi.
  const sharesValueCents = plan.delta * vB.price * 100;
  if (plan.kind === 'gop') assert.ok(sharesValueCents <= plan.cents + 1e-6, 'góp: không nhận dư cổ phần');
  else assert.ok(plan.cents <= sharesValueCents + 1e-6, 'rút: không nhận dư tiền');

  const holdersSum = vA.holders.reduce((t, h) => t + h.value, 0);
  assert.ok(Math.abs(holdersSum - vA.nav) < 1e-6, 'tổng giá trị phần các cổ đông = tổng tài sản');

  const last = after.history[after.history.length - 1];
  assert.ok(F.historyEntryValid(last), `dòng lịch sử mới tính lại ra đúng: ${JSON.stringify(last)}`);

  if (roundTrip) assertRoundTrip(after);
}

/** Cổ phần từng người tính lại từ mốc ban đầu và lịch sử, dạng object thường để so sánh. */
const replayHolders = (history) => Object.fromEntries(F.replayShares(INITIAL, history).shares);

describe('parseAmount', () => {
  test('nhận số nguyên, số lẻ bằng chấm hoặc phẩy', () => {
    assert.deepEqual(F.parseAmount('1000'), { cents: 100000 });
    assert.deepEqual(F.parseAmount('1000.5'), { cents: 100050 });
    assert.deepEqual(F.parseAmount('1000,55'), { cents: 100055 });
    assert.deepEqual(F.parseAmount(' 0.01 '), { cents: 1 });
    assert.deepEqual(F.parseAmount('0.29'), { cents: 29 }, '0.29 * 100 = 28.999… vẫn ra 29 cent');
  });
  test('từ chối dấu ngăn cách hàng nghìn, quá 2 số lẻ, số âm, chữ, số 0', () => {
    for (const bad of ['1.000', '1,000', '1.000.000', '1 000', '10.123', '-5', 'abc', '', '0', '0.00', '1e5', 'Infinity', '1e400']) {
      assert.ok(F.parseAmount(bad).error, `"${bad}" phải bị từ chối`);
    }
  });
});

describe('validate', () => {
  test('dữ liệu gốc hợp lệ', () => assert.deepEqual(F.validate(state0()), []));
  test('bắt lỗi dữ liệu sửa tay sai', () => {
    const bad = structuredClone(START);
    bad.amounts.cash = '4000';
    bad.shareholders[1].shares = 1.5;
    bad.shareholders[2].shares = 5;
    bad.shareholders.push({ name: 'Legend', shares: 0 });
    bad.amounts.eth = 2;
    const errs = F.validate(F.merge(PORTFOLIO, bad));
    assert.ok(errs.some((e) => e.includes('amounts.cash')), 'tiền mặt để trong dấu nháy');
    assert.ok(errs.some((e) => e.includes('Cam')), 'cổ phần lẻ');
    assert.ok(errs.some((e) => e.includes('trùng')), 'tên trùng');
    assert.ok(errs.some((e) => e.includes('eth')), 'id tài sản lạ');
    assert.ok(errs.some((e) => e.includes('không khớp')), 'tổng không khớp');
  });
  test('sai cấu trúc (thiếu ngoặc vuông) được báo, không ném lỗi', () => {
    const bad = structuredClone(START);
    bad.shareholders = { name: 'Cam', shares: 0 };
    bad.history = {};
    let s;
    assert.doesNotThrow(() => { s = F.merge(PORTFOLIO, bad); });
    const errs = F.validate(s);
    assert.ok(errs.some((e) => e.includes('shareholders')));
    assert.ok(errs.some((e) => e.includes('history')));
  });
  test('thiếu calculated.js', () => assert.ok(F.validate(F.merge(PORTFOLIO, undefined)).length > 0));
  test('tiền mặt lẻ hơn 1 cent bị từ chối', () => {
    const bad = structuredClone(START);
    bad.amounts.cash = 1234.5678;
    assert.ok(F.validate(F.merge(PORTFOLIO, bad)).some((e) => e.includes('2 số lẻ')));
  });
  test('contributionAsset có giá thị trường bị từ chối', () => {
    const s = state0();
    s.contributionAsset = 'btc';
    assert.ok(F.validate(s).some((e) => e.includes('giá cố định 1 USDT')));
  });
  test('đơn vị vàng gõ sai bị từ chối thay vì ngầm coi là 1 ounce', () => {
    for (const unit of ['g', 'lượng', 'chỉ', 'gam', 'ounce', 'OZ', 'constructor', 'toString']) {
      const s = state0();
      s.assets.find((a) => a.id === 'gold').unit = unit;
      s.units.gold = unit;
      assert.ok(F.validate(s).some((e) => e.includes('Đơn vị')), `unit "${unit}" phải bị từ chối`);
    }
  });
  test('đơn vị khối lượng vàng không dùng được cho BTC', () => {
    const s = state0();
    s.assets.find((a) => a.id === 'btc').unit = 'chi';
    s.units.btc = 'chi';
    assert.ok(F.validate(s).some((e) => e.includes('Đơn vị')));
  });
  test('đơn vị hợp lệ quy đổi đúng', () => {
    const s = state0();
    s.assets.find((a) => a.id === 'gold').unit = 'luong';
    s.units.gold = 'luong';
    assert.deepEqual(F.validate(s), []);
    const gold = val(s).rows.find((r) => r.id === 'gold');
    assert.ok(Math.abs(gold.unitPrice - PRICES.XAUTUSDT.last * (37.5 / 31.1034768)) < 1e-9, '1 lượng = 37,5 g');
  });
  test('sửa tay cộng thêm cổ phần cho một người (kể cả sửa totalShares cho khớp) bị phát hiện', () => {
    const bad = structuredClone(START);
    bad.shareholders[1].shares = 50000;
    bad.totalShares += 50000;
    assert.ok(F.validate(F.merge(PORTFOLIO, bad)).some((e) => e.includes('mốc ban đầu')));
  });
  test('dòng lịch sử không tính lại ra đúng số cổ phần bị phát hiện', () => {
    let s = state0();
    s = run(s, { kind: 'gop', who: 1, cents: 100000 }).next;
    s.history[0].shares += 1;
    s.shareholders[1].shares += 1;
    s.totalShares += 1;
    assert.ok(F.validate(s).some((e) => e.includes('không tính lại ra đúng')));
  });
  test('cặp giá không phải USDT bị từ chối', () => {
    const s = state0();
    s.assets.push({ id: 'eth', name: 'Ethereum', ticker: 'ETH', unit: 'ETH', pair: 'ETHBTC', amount: 1 });
    s.units.eth = 'ETH';
    assert.ok(F.validate(s).some((e) => e.includes('cặp USDT')));
  });
  test('đổi đơn vị ở portfolio.js mà không quy đổi số lượng bị phát hiện', () => {
    const s = state0();
    s.assets.find((a) => a.id === 'gold').unit = 'luong';
    assert.ok(F.validate(s).some((e) => e.includes("ghi theo 'oz'")));
  });
  test('rút khi đang 0 cổ phần rồi góp bù lại vẫn bị phát hiện', () => {
    let s = state0();
    const p = val(s).price;
    const cents = 10000;
    const n = F.sharesForRut(cents, p);
    s.history.push({ date: '2026-10-24', type: 'rut', name: 'Cam', amount: 100, shares: n, sharePrice: p });
    s.history.push({ date: '2026-10-24', type: 'gop', name: 'Cam', amount: n * p > 100 ? 100 : 100, shares: F.sharesForGop(cents, p), sharePrice: p });
    assert.ok(F.validate(s).some((e) => e.includes('khi chỉ còn')));
  });
  test('tên cổ đông trùng thuộc tính có sẵn của JS không lách được kiểm tra', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      const bad = structuredClone(START);
      bad.shareholders.push({ name, shares: 500000 });
      bad.totalShares += 500000;
      assert.ok(F.validate(F.merge(PORTFOLIO, bad)).length > 0, name);
    }
  });
  test('updatedAt và ngày trong lịch sử phải đúng dạng', () => {
    const bad = structuredClone(START);
    delete bad.updatedAt;
    assert.ok(F.validate(F.merge(PORTFOLIO, bad)).some((e) => e.includes('updatedAt')));
  });
  test('units thừa id lạ bị từ chối; units khác thứ tự vẫn xuất lại khớp', () => {
    const extra = structuredClone(START);
    extra.units.eth = 'ETH';
    assert.ok(F.validate(F.merge(PORTFOLIO, extra)).some((e) => e.includes('eth')));
    const reordered = structuredClone(START);
    reordered.units = { cash: 'USDT', gold: 'oz', btc: 'BTC' };
    const st = F.merge(PORTFOLIO, reordered);
    assert.deepEqual(F.validate(st), []);
    assert.ok(F.sameLedger(F.merge(PORTFOLIO, F.evalCalculated(F.toSource(st))), st));
  });
  test('id tài sản bị trùng bị từ chối', () => {
    const s = state0();
    s.assets.push({ ...s.assets[2] });
    assert.ok(F.validate(s).some((e) => e.includes('trùng')));
  });
  test('số tiền lớn vẫn được coi là đúng cent', () => {
    const c = structuredClone(START);
    c.amounts.cash = 2252273299.95;
    assert.deepEqual(F.validate(F.merge(PORTFOLIO, c)), []);
  });
  test('tài sản không có pair lẫn price bị từ chối', () => {
    const s = state0();
    s.assets.push({ id: 'eth', name: 'Ethereum', ticker: 'ETH', unit: 'ETH', amount: 2 });
    s.units.eth = 'ETH';
    assert.ok(F.validate(s).some((e) => e.includes('"eth"')));
  });
});

describe('valuation', () => {
  test('tổng tài sản, giá cổ phần và giá trị từng cổ đông', () => {
    const v = val(state0());
    const nav = 80841.06 + 3996.98 + 4000;
    assert.ok(Math.abs(v.nav - nav) < 1e-6);
    assert.ok(Math.abs(v.price - nav / INITIAL_SHARES) < 1e-12);
    assert.ok(Math.abs(v.price1000 - v.price * 1000) < 1e-9);
    assert.ok(Math.abs(v.holders[0].value - nav) < 1e-6, 'Legend giữ 100%');
    assert.equal(v.complete, true);
  });
  test('thiếu giá một cặp thì valuation báo không đủ và planTx từ chối', () => {
    const s = state0();
    const v = val(s, { BTCUSDT: PRICES.BTCUSDT });
    assert.equal(v.complete, false);
    assert.ok(F.planTx(s, v, { kind: 'gop', who: 1, cents: 100000 }).error);
  });
});

describe('fetchPrices', () => {
  const ok = { ok: true, status: 200, json: async () => [{ symbol: 'BTCUSDT', lastPrice: '1', openPrice: '1' }] };
  const bad = { ok: false, status: 400, json: async () => ({}) };
  test('một host trả 400 thì vẫn thử host còn lại', async () => {
    let calls = 0;
    const r = await F.fetchPrices(['BTCUSDT'], { fetchImpl: async () => (calls++ ? ok : bad) });
    assert.equal(calls, 2);
    assert.equal(r.prices.BTCUSDT.last, 1);
  });
  test('mọi host đều 400 thì báo sai tên cặp', async () => {
    await assert.rejects(F.fetchPrices(['XXX'], { fetchImpl: async () => bad }), (e) => e.badRequest === true);
  });
  test('không có cặp nào thì không gọi Binance', async () => {
    let calls = 0;
    const r = await F.fetchPrices([], { fetchImpl: async () => { calls++; return ok; } });
    assert.equal(calls, 0);
    assert.deepEqual(r.prices, {});
  });
});

describe('góp vốn', () => {
  test('góp 1.000: cổ phần làm tròn xuống, mọi bất biến đúng', () => {
    const s = state0();
    const { plan, next, p } = run(s, { kind: 'gop', who: 1, cents: 100000 });
    assert.equal(plan.delta, Math.floor(1000 / p));
    checkInvariants(s, next, plan);
  });
  test('góp nhỏ hơn giá 1 cổ phần bị từ chối', () => {
    const s = state0();
    assert.ok(F.planTx(s, val(s), { kind: 'gop', who: 1, cents: 4 }).error);
  });
  test('giá không hợp lệ bị từ chối', () => {
    const s = state0();
    for (const price of [0, NaN, Infinity, -1]) {
      assert.ok(F.planTx(s, { ...val(s), price }, { kind: 'gop', who: 1, cents: 100 }).error);
    }
  });
  test('số tiền thiếu hoặc không phải số nguyên cent bị từ chối', () => {
    const s = state0();
    for (const c of [undefined, NaN, 0, -100, 1.5, Infinity, '100']) {
      assert.ok(F.planTx(s, val(s), { kind: 'gop', who: 1, cents: c }).error, `cents=${c}`);
    }
    assert.ok(F.planTx(s, val(s), { kind: 'rut', who: 0, cents: undefined }).error, 'rút một phần thiếu số tiền');
  });
});

describe('rút vốn', () => {
  test('rút một phần: cổ phần huỷ làm tròn lên', () => {
    let s = state0();
    s = run(s, { kind: 'gop', who: 1, cents: 300000 }).next;
    const { plan, next, p } = run(s, { kind: 'rut', who: 1, cents: 50000 });
    assert.equal(plan.delta, Math.ceil(500 / p));
    checkInvariants(s, next, plan);
  });
  test('rút 0,04 USDT không còn được trả tiền mà không mất cổ phần', () => {
    let s = state0();
    s = run(s, { kind: 'gop', who: 1, cents: 100000 }).next;
    const plan = F.planTx(s, val(s), { kind: 'rut', who: 1, cents: 4 });
    assert.ok(plan.delta >= 1, 'phải huỷ ít nhất 1 cổ phần');
  });
  test('rút toàn bộ: về đúng 0 cổ phần, tiền làm tròn xuống tới cent', () => {
    let s = state0();
    s = run(s, { kind: 'gop', who: 3, cents: 542000 }).next;
    const { plan, next, p } = run(s, { kind: 'rut', who: 3, all: true });
    assert.equal(next.shareholders[3].shares, 0);
    assert.equal(plan.cents, F.payoutForAll(plan.delta, p));
    checkInvariants(s, next, plan);
  });
  test('rút quá phần mình có bị từ chối, kể cả lệch vài cent', () => {
    let s = state0();
    s = run(s, { kind: 'gop', who: 1, cents: 100000 }).next;
    const v = val(s);
    const maxCents = F.payoutForAll(s.shareholders[1].shares, v.price);
    assert.ok(F.planTx(s, v, { kind: 'rut', who: 1, cents: maxCents + 5 }).error);
    assert.ok(!F.planTx(s, v, { kind: 'rut', who: 1, cents: maxCents }).error, 'rút đúng tối đa thì được');
  });
  test('rút khi tiền mặt không đủ bị từ chối', () => {
    const s = state0();
    assert.ok(F.planTx(s, val(s), { kind: 'rut', who: 0, cents: 400001 }).error);
  });
  test('người không có cổ phần không rút được', () => {
    const s = state0();
    assert.ok(F.planTx(s, val(s), { kind: 'rut', who: 2, cents: 100 }).error);
  });
  test('không rút hết toàn bộ quỹ bằng form', () => {
    const s = state0();
    assert.ok(F.planTx(s, val(s), { kind: 'rut', who: 0, all: true }).error);
  });
});

describe('prepareTx', () => {
  test('trả về plan, state mới và định giá; state mới hợp lệ', () => {
    const r = F.prepareTx(state0(), PRICES, { kind: 'gop', who: 1, cents: 100000 }, '2026-10-24');
    assert.ok(!r.error);
    assert.deepEqual(F.validate(r.next), []);
    assert.equal(r.next.history.length, 1);
  });
  test('thiếu giá thì từ chối', () => {
    assert.ok(F.prepareTx(state0(), {}, { kind: 'gop', who: 1, cents: 100000 }, '2026-10-24').error);
  });
});

describe('lịch sử tính lại được', () => {
  test('giao dịch lớn ở giá ~0,0893 vẫn tính lại ra đúng (lỗi độ chính xác của sharePrice 8 số)', () => {
    const s = state0();
    // Đẩy giá cổ phần lên ~0,0893 rồi rút 3.777 như ca review tìm ra.
    const prices = { BTCUSDT: { last: 81341.06, open: 81792.96 }, XAUTUSDT: { last: 3996.98, open: 4017.54 } };
    let st = run(s, { kind: 'gop', who: 1, cents: 1000000 }, prices).next;
    const r = run(st, { kind: 'rut', who: 1, cents: 377700 }, prices);
    st = r.next;
    assert.ok(st.history.every(F.historyEntryValid));
  });
});

describe('chuỗi giao dịch', () => {
  test('chuỗi 13 giao dịch như test tay: mọi bước đều đúng bất biến', () => {
    let s = state0();
    const seq = [
      { kind: 'gop', who: 1, cents: 202500 },
      { kind: 'gop', who: 1, cents: 117000 },
      { kind: 'gop', who: 3, cents: 542000 },
      { kind: 'rut', who: 1, cents: 50000 },
      { kind: 'rut', who: 0, cents: 300000 },
      { kind: 'rut', who: 3, cents: 200000 },
      { kind: 'rut', who: 1, all: true },
      { kind: 'rut', who: 3, cents: 150000 },
      { kind: 'gop', who: 4, cents: 100 },
      { kind: 'gop', who: 2, cents: 12345 },
      { kind: 'rut', who: 2, cents: 1 },
      { kind: 'gop', who: 1, cents: 99999 },
      { kind: 'rut', who: 4, all: true },
    ];
    // Giá BTC/vàng đổi giữa các giao dịch, như ngoài đời.
    seq.forEach((tx, i) => {
      const prices = {
        BTCUSDT: { last: PRICES.BTCUSDT.last * (1 + (i % 5 - 2) * 0.013), open: PRICES.BTCUSDT.open },
        XAUTUSDT: { last: PRICES.XAUTUSDT.last * (1 + (i % 3 - 1) * 0.007), open: PRICES.XAUTUSDT.open },
      };
      const { plan, next } = run(s, tx, prices);
      checkInvariants(s, next, plan, prices);
      s = next;
    });
    assert.equal(s.history.length, seq.length);
    assert.ok(s.shareholders[1].shares > 0, 'Cam góp lại sau khi rút hết');
    assert.equal(s.shareholders[4].shares, 0, 'Cháu Gái Dễ Thương rút hết');
    const replay = replayHolders(s.history);
    s.shareholders.forEach((h) => assert.equal(h.shares, replay[h.name] || 0, `${h.name} khớp lịch sử`));
  });
  test('2.000 giao dịch ngẫu nhiên tới 100.000 USDT, giá dao động: không ai lấy được tiền của người khác', () => {
    let s = state0();
    const rand = rng(42);
    let paidIn = 0;
    let paidOut = 0;
    let done = 0;
    for (let i = 0; i < 2000; i++) {
      const prices = {
        BTCUSDT: { last: PRICES.BTCUSDT.last * (0.7 + rand() * 0.6), open: PRICES.BTCUSDT.open },
        XAUTUSDT: { last: PRICES.XAUTUSDT.last * (0.9 + rand() * 0.2), open: PRICES.XAUTUSDT.open },
      };
      const who = Math.floor(rand() * 5);
      const kind = rand() < 0.55 ? 'gop' : 'rut';
      const tx = { kind, who, cents: 1 + Math.floor(rand() ** 3 * 10000000), all: kind === 'rut' && rand() < 0.1 };
      const plan = F.planTx(s, val(s, prices), tx);
      if (plan.error) continue;
      const next = F.applyTx(s, plan, '2026-10-24');
      checkInvariants(s, next, plan, prices, { roundTrip: done % 100 === 0 });
      if (kind === 'gop') paidIn += plan.cents; else paidOut += plan.cents;
      s = next;
      done++;
    }
    assert.ok(done > 1000, `đủ nhiều giao dịch hợp lệ (${done})`);
    assertRoundTrip(s);
    assert.equal(cents(F.cashAsset(s).amount), 400000 + paidIn - paidOut, 'tiền mặt cuối = ban đầu + góp - rút, từng cent');
    const replay = replayHolders(s.history);
    s.shareholders.forEach((h) => assert.equal(h.shares, replay[h.name] || 0, `${h.name} khớp lịch sử`));
  });
});

describe('xuất file', () => {
  test('tên có ký tự đặc biệt vẫn ra file hợp lệ', () => {
    const s = state0();
    s.shareholders[1].name = "Cam 'Út'\n\\   \"x\"";
    assert.equal(F.evalCalculated(F.toSource(s)).shareholders[1].name, s.shareholders[1].name);
  });
  test('id tài sản không phải tên biến JS vẫn ra file hợp lệ', () => {
    const p = structuredClone(PORTFOLIO);
    p.assets.push({ id: 'usdt-bank', name: 'Tiền ngân hàng', ticker: 'USD', unit: 'USD', price: 1 });
    const c = structuredClone(START);
    c.amounts['usdt-bank'] = 500;
    c.units['usdt-bank'] = 'USD';
    const s = F.merge(p, c);
    assert.equal(F.evalCalculated(F.toSource(s)).amounts['usdt-bank'], 500);
  });
});

// Kiểm tra chính sổ thật sẽ được đăng lên, với portfolio.js thật, không phải dữ liệu giả lập.
describe('calculated.js thật', () => {
  const real = loadState();
  test('hợp lệ', () => assert.deepEqual(F.validate(real), []));
  test('cổ phần từng người khớp với mốc ban đầu cộng trừ lịch sử', () => {
    const replay = replayHolders(real.history);
    real.shareholders.forEach((h) => assert.equal(h.shares, replay[h.name] || 0, `${h.name}`));
    Object.keys(replay).forEach((name) => assert.ok(real.shareholders.some((h) => h.name === name), `"${name}" trong lịch sử có trong shareholders`));
  });
  test('mọi dòng lịch sử tính lại ra đúng bằng quy tắc làm tròn hiện tại', () => {
    real.history.forEach((c, i) => assert.ok(F.historyEntryValid(c), `dòng ${i + 1}: ${JSON.stringify(c)}`));
  });
  test('xuất lại ra đúng cùng số liệu (sửa tay kiểu 1234.50 vẫn được)', () => {
    assert.ok(F.sameLedger(F.merge(readPortfolio(), F.evalCalculated(F.toSource(real))), real));
  });
  // Lịch sử chỉ được nối thêm: bản đã commit phải là phần đầu của bản đang sửa. Bắt được việc dán
  // một file tính trên sổ cũ, làm mất giao dịch đã ghi (file đó tự nó vẫn hợp lệ).
  // Sổ chỉ được nối thêm: mọi phiên bản calculated.js từng commit phải là phần đầu của bản hiện tại,
  // và mốc initialShares không bao giờ đổi. So với toàn bộ lịch sử git (không chỉ commit liền trước),
  // để một lần push làm mất giao dịch không thể "lọt" nhờ một commit khác đè lên sau đó.
  test('lịch sử chỉ nối thêm so với mọi phiên bản đã commit trong git', (t) => {
    if (!isGitRepo()) {
      t.skip('thư mục chưa là git repo');
      return;
    }
    const versions = (path) => git('log', '--format=%H', '--', path).split('\n').filter(Boolean)
      .map((sha) => ({ sha, source: git('show', `${sha}:${path}`) }));
    const current = real.history;
    for (const { sha, source } of versions('calculated.js')) {
      const old = F.evalCalculated(source) || {};
      const hist = Array.isArray(old.history) ? old.history : [];
      assert.ok(current.length >= hist.length, `lịch sử ngắn hơn bản ${sha.slice(0, 7)}: ${hist.length} -> ${current.length}`);
      hist.forEach((c, i) => assert.deepEqual(current[i], c, `dòng ${i + 1} khác bản ${sha.slice(0, 7)}`));
    }
    const nowInitial = JSON.stringify(readPortfolio().initialShares);
    for (const { sha, source } of versions('portfolio.js')) {
      const old = F.evalCalculated(source, 'PORTFOLIO') || {};
      if (old.initialShares !== undefined) assert.equal(JSON.stringify(old.initialShares), nowInitial, `initialShares khác bản ${sha.slice(0, 7)}`);
    }
  });
  test('portfolio.js thật dùng được với core', () => assert.ok(Array.isArray(readPortfolio().assets)));
});
