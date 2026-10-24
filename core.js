// Phần tính tiền của quỹ: thuần logic, không đụng tới DOM, chạy được cả trên trình duyệt
// (window.FundCore) lẫn Node (require) để có thể test tự động. Trang web và tools/tx.js đều
// đi qua đây nên luôn ra cùng một kết quả.
//
// Quy tắc:
// - Tiền tệ (USDT) tính bằng số nguyên cents, không cộng trừ số thực.
// - Cổ phần luôn là số nguyên.
// - Làm tròn luôn nghiêng về quỹ: góp làm tròn xuống số cổ phần nhận, rút làm tròn lên số
//   cổ phần bị huỷ (và rút toàn bộ thì làm tròn xuống số tiền trả). Nhờ vậy không ai rút
//   được tiền của người khác bằng cách tách nhỏ giao dịch.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FundCore = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const OZ_GRAMS = 31.1034768;
  // Giá vàng trên Binance tính theo troy ounce; quy đổi để nhập theo đơn vị quen thuộc.
  const UNIT_FACTOR = { oz: 1, luong: 37.5 / OZ_GRAMS, chi: 3.75 / OZ_GRAMS, gram: 1 / OZ_GRAMS };
  // Chỉ các cặp vàng (1 token = 1 troy ounce) mới được dùng đơn vị khối lượng ở trên.
  const GOLD_PAIRS = ['XAUTUSDT', 'PAXGUSDT'];
  // Sai số cho phép khi chia số thực ra số nguyên, để 1000 / 0,1 không thành 9999,9999.
  const EPS = 1e-9;
  // Host chính trước; data-api là mirror chỉ đọc, dùng khi host chính bị chặn theo vùng.
  const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];

  const isInt = (n) => Number.isInteger(n);
  const isMoney = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const toCents = (usdt) => Math.round(usdt * 100);
  // Số tiền lưu trong sổ phải là số cent nguyên, không thì mỗi lần cộng trừ sẽ âm thầm làm tròn.
  // So với chính nó sau khi làm tròn tới cent, nên đúng ở mọi độ lớn (không dùng sai số tuyệt đối).
  const isWholeCents = (usdt) => isMoney(usdt) && Math.round(usdt * 100) / 100 === usdt;
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  /** Ngày theo giờ máy, dạng YYYY-MM-DD. */
  const todayISO = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  /** fetch có giới hạn thời gian; quá hạn thì ném lỗi tên 'AbortError'. */
  async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- giá Binance ---------- */

  const pairsOf = (state) => [...new Set(state.assets.filter((a) => a.pair).map((a) => a.pair))];
  const tickerUrl = (host, pairs) =>
    `${host}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(pairs))}&type=MINI`;
  /** Biến phản hồi /ticker/24hr thành { BTCUSDT: { last, open } }. */
  function parseTickers(rows) {
    const prices = {};
    for (const r of rows) prices[r.symbol] = { last: +r.lastPrice, open: +r.openPrice };
    return prices;
  }

  /**
   * Lấy giá từ Binance, thử lần lượt các host. Dùng chung cho trang và CLI.
   * @param {string[]} pairs
   * @param {{fetchImpl: Function, hosts?: string[], timeoutMs?: number}} opts
   * @returns {Promise<{prices: object, host: string}>} lỗi có `badRequest` khi Binance từ chối cặp
   */
  async function fetchPrices(pairs, { fetchImpl, hosts = BINANCE_HOSTS, timeoutMs = 8000 }) {
    if (!pairs.length) return { prices: {}, host: null };
    let lastErr;
    let rejected = 0;
    for (const host of hosts) {
      try {
        const res = await fetchWithTimeout(fetchImpl, tickerUrl(host, pairs), {}, timeoutMs);
        // 400 thường do một cặp sai tên, nhưng vẫn thử host còn lại; chỉ khi mọi host đều từ chối
        // mới kết luận là cặp sai.
        if (res.status === 400) {
          rejected++;
          throw new Error(`${host} trả HTTP 400`);
        }
        if (!res.ok) throw new Error(`${host} trả HTTP ${res.status}`);
        return { prices: parseTickers(await res.json()), host };
      } catch (e) {
        lastErr = e;
      }
    }
    if (rejected === hosts.length) {
      throw Object.assign(new Error(`Binance từ chối danh sách cặp giá (${pairs.join(', ')}). Kiểm tra lại tên pair trong portfolio.js.`), { badRequest: true });
    }
    if (rejected > 0) {
      throw Object.assign(new Error(`Binance từ chối danh sách cặp giá (${pairs.join(', ')}) ở ${rejected}/${hosts.length} máy chủ, máy chủ còn lại không kết nối được. Kiểm tra tên pair trong portfolio.js và mạng.`), { badRequest: true });
    }
    throw lastErr || new Error('Không có host Binance nào để thử.');
  }

  /* ---------- đọc dữ liệu ---------- */

  /**
   * Đọc số tiền người dùng gõ. Chỉ nhận chữ số và tối đa 2 số lẻ (dấu chấm hoặc phẩy);
   * từ chối dấu ngăn cách hàng nghìn vì "1.000" kiểu Việt Nam sẽ bị hiểu thành 1 USDT.
   * @param {string} raw
   * @returns {{cents: number}|{error: string}}
   */
  function parseAmount(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return { error: 'Nhập số tiền.' };
    if (!/^\d+([.,]\d{1,2})?$/.test(s)) {
      return { error: 'Số tiền chỉ gồm chữ số, tối đa 2 số lẻ, không dùng dấu ngăn cách hàng nghìn. Ví dụ: 1000 hoặc 1000,50.' };
    }
    const cents = Math.round(parseFloat(s.replace(',', '.')) * 100);
    if (!(cents > 0)) return { error: 'Số tiền phải lớn hơn 0.' };
    if (cents > 1e12) return { error: 'Số tiền quá lớn, kiểm tra lại.' };
    return { cents };
  }

  /**
   * Gộp cấu hình tĩnh (portfolio.js) với số liệu thay đổi (calculated.js) thành một state mới,
   * không sửa hai object gốc. Sai cấu trúc (vd thiếu ngoặc vuông) không ném lỗi mà ghi vào
   * shapeErrors để validate() báo ra.
   */
  function merge(portfolio, calculated) {
    const C = calculated || {};
    const shapeErrors = [];
    const list = (key) => {
      if (C[key] === undefined) return [];
      if (Array.isArray(C[key])) return C[key].map((x) => ({ ...x }));
      shapeErrors.push(`${key} trong calculated.js phải là danh sách [ ... ].`);
      return [];
    };
    const amounts = C.amounts && typeof C.amounts === 'object' ? C.amounts : {};
    if (C.amounts !== undefined && amounts !== C.amounts) shapeErrors.push('amounts trong calculated.js phải là { ... }.');
    return {
      name: portfolio.name,
      contributionAsset: portfolio.contributionAsset || 'cash',
      initialShares: portfolio.initialShares,
      units: C.units && typeof C.units === 'object' ? { ...C.units } : undefined,
      updatedAt: C.updatedAt,
      totalShares: C.totalShares,
      assets: portfolio.assets.map((a) => ({ ...a, amount: amounts[a.id] })),
      extraAmountIds: Object.keys(amounts).filter((id) => !portfolio.assets.some((a) => a.id === id)),
      shareholders: list('shareholders'),
      history: list('history'),
      shapeErrors,
    };
  }

  const cashAsset = (state) => state.assets.find((a) => a.id === state.contributionAsset);

  /** Bỏ dấu, chữ thường, gộp khoảng trắng: "Bến  Tre" -> "ben tre". */
  const foldName = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim().replace(/\s+/g, ' ');

  /**
   * Tìm cổ đông theo tên gõ tắt: khớp đúng trước, rồi khớp không dấu/không phân biệt hoa thường.
   * Không đoán khi mơ hồ: trùng nhiều người hoặc không ai thì trả lỗi.
   * @returns {{index: number}|{error: string}}
   */
  function findHolder(state, query) {
    const exact = state.shareholders.findIndex((h) => h.name === query);
    if (exact >= 0) return { index: exact };
    const q = foldName(query);
    const hits = state.shareholders.map((h, i) => [foldName(h.name), i]).filter(([n]) => n === q);
    if (hits.length === 1) return { index: hits[0][1] };
    const list = state.shareholders.map((h) => h.name).join(', ');
    return { error: hits.length ? `Tên "${query}" khớp nhiều cổ đông, gõ đúng tên có dấu. Danh sách: ${list}` : `Không có cổ đông tên "${query}". Danh sách: ${list}` };
  }

  /**
   * Kiểm tra cấu hình và calculated.js có hợp lệ không trước khi cho tính giao dịch.
   * @returns {string[]} danh sách lỗi, rỗng nếu ổn
   */
  function validate(state) {
    const errs = [...(state.shapeErrors || [])];
    if (!ISO_DATE.test(String(state.updatedAt))) errs.push(`updatedAt phải có dạng YYYY-MM-DD (đang là ${JSON.stringify(state.updatedAt)}).`);
    Object.keys(state.units || {}).forEach((id) => {
      if (!state.assets.some((a) => a.id === id)) errs.push(`units có id không khai báo trong portfolio.js: ${id}.`);
    });
    const ids = state.assets.map((a) => a.id);
    const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupIds.length) errs.push(`portfolio.js có id tài sản bị trùng: ${[...new Set(dupIds)].join(', ')} (sẽ bị cộng hai lần vào tổng tài sản).`);
    if (!isInt(state.totalShares) || state.totalShares <= 0) errs.push(`totalShares phải là số nguyên dương (đang là ${state.totalShares}).`);
    state.assets.forEach((a) => {
      if (!isMoney(a.amount)) errs.push(`amounts.${a.id} phải là số không âm, không để trong dấu nháy (đang là ${JSON.stringify(a.amount)}).`);
      if (!a.pair && !(Number.isFinite(a.price) && a.price > 0)) {
        errs.push(`Tài sản "${a.id}" trong portfolio.js cần pair (cặp giá Binance) hoặc price cố định, không thì bị tính bằng 0.`);
      }
      // Giá được hiểu là USDT; cặp báo giá bằng đồng khác (vd ETHBTC) sẽ định giá sai hàng nghìn lần.
      if (a.pair && !/USDT$/.test(a.pair)) errs.push(`Cặp giá "${a.pair}" của "${a.id}" phải là cặp USDT (vd ETHUSDT).`);
      // Số lượng trong calculated.js được ghi theo một đơn vị; đổi unit ở portfolio.js mà không quy
      // đổi số lượng sẽ âm thầm định giá lại (1 oz thành 1 lượng là +20,6%).
      if (!state.units || state.units[a.id] === undefined) {
        errs.push(`calculated.js thiếu units.${a.id} (đơn vị đã dùng cho số lượng).`);
      } else if (state.units[a.id] !== a.unit) {
        errs.push(`Đơn vị của "${a.id}" trong portfolio.js là '${a.unit}' nhưng số lượng trong calculated.js ghi theo '${state.units[a.id]}'. Quy đổi amounts.${a.id} cho đúng rồi sửa units.${a.id} trong calculated.js.`);
      }
      // Đơn vị lạ không được ngầm coi là 1: gõ 'g' hay 'lượng' có dấu sẽ định giá sai hàng chục lần.
      if (a.pair) {
        const goldUnit = hasOwn(UNIT_FACTOR, a.unit) && GOLD_PAIRS.includes(a.pair);
        if (!goldUnit && a.unit !== a.ticker) {
          errs.push(GOLD_PAIRS.includes(a.pair)
            ? `Đơn vị "${a.unit}" của "${a.id}" không hợp lệ. Dùng ${Object.keys(UNIT_FACTOR).map((u) => `'${u}'`).join(', ')}.`
            : `Đơn vị "${a.unit}" của "${a.id}" phải đúng bằng ticker ('${a.ticker}').`);
        }
      }
    });
    if (state.extraAmountIds.length) errs.push(`amounts có id không khai báo trong portfolio.js: ${state.extraAmountIds.join(', ')}.`);
    const names = new Set();
    state.shareholders.forEach((h, i) => {
      if (typeof h.name !== 'string' || !h.name.trim()) errs.push(`Cổ đông thứ ${i + 1} chưa có tên.`);
      else if (names.has(h.name)) errs.push(`Tên cổ đông bị trùng: ${h.name}.`);
      names.add(h.name);
      if (!isInt(h.shares) || h.shares < 0) errs.push(`Số cổ phần của ${h.name} phải là số nguyên không âm (đang là ${JSON.stringify(h.shares)}).`);
    });
    const sum = state.shareholders.reduce((t, h) => t + (isInt(h.shares) ? h.shares : 0), 0);
    if (isInt(state.totalShares) && sum !== state.totalShares) {
      errs.push(`Tổng cổ phần của các cổ đông là ${sum}, không khớp totalShares ${state.totalShares}.`);
    }
    const cash = cashAsset(state);
    if (!cash) errs.push(`Không tìm thấy tài sản "${state.contributionAsset}" (contributionAsset) trong portfolio.js.`);
    else {
      if (cash.pair || cash.price !== 1) errs.push(`Tài sản nhận tiền góp "${cash.id}" phải có giá cố định 1 USDT và không có pair, vì tiền góp/rút được cộng trừ thẳng vào số lượng.`);
      if (isMoney(cash.amount) && !isWholeCents(cash.amount)) errs.push(`amounts.${cash.id} chỉ được có tối đa 2 số lẻ (đang là ${cash.amount}).`);
    }
    let historyOk = true;
    state.history.forEach((c, i) => {
      const before = errs.length;
      if (c.type !== 'gop' && c.type !== 'rut') errs.push(`Lịch sử dòng ${i + 1} có type không hợp lệ: ${JSON.stringify(c.type)}.`);
      if (!isInt(c.shares) || c.shares < 1) errs.push(`Lịch sử dòng ${i + 1} thiếu số cổ phần hợp lệ.`);
      if (!isWholeCents(c.amount) || !(c.amount > 0)) errs.push(`Lịch sử dòng ${i + 1} có số tiền không hợp lệ.`);
      if (!(Number.isFinite(c.sharePrice) && c.sharePrice > 0)) errs.push(`Lịch sử dòng ${i + 1} có sharePrice không hợp lệ.`);
      if (!ISO_DATE.test(String(c.date))) errs.push(`Lịch sử dòng ${i + 1} có ngày không hợp lệ: ${JSON.stringify(c.date)}.`);
      if (typeof c.name !== 'string' || !c.name) errs.push(`Lịch sử dòng ${i + 1} thiếu tên.`);
      if (errs.length === before && !historyEntryValid(c)) errs.push(`Lịch sử dòng ${i + 1} (${c.name} ${c.type} ${c.amount}) không tính lại ra đúng ${c.shares} cổ phần theo giá đã ghi.`);
      if (errs.length !== before) historyOk = false;
    });
    // Cổ phần từng người phải đúng bằng mốc ban đầu cộng trừ lịch sử: chặn sửa tay cộng thêm cổ phần
    // cho ai đó (kể cả khi đã sửa totalShares cho khớp).
    if (!state.initialShares) errs.push('portfolio.js thiếu initialShares (mốc cổ phần ban đầu của từng người).');
    else if (historyOk) {
      const { shares: replay, negative } = replayShares(state.initialShares, state.history);
      // Rút khi đang không đủ cổ phần (dù về sau góp bù) là trả tiền từ cổ phần không có.
      negative.forEach((n) => errs.push(`Lịch sử dòng ${n.index + 1}: ${n.name} rút ${n.shares} cổ phần khi chỉ còn ${n.had}.`));
      replay.forEach((count, name) => {
        const h = state.shareholders.find((x) => x.name === name);
        if (!h) errs.push(`"${name}" có trong lịch sử/mốc ban đầu nhưng không có trong shareholders.`);
        else if (h.shares !== count) errs.push(`${name} đang có ${h.shares} cổ phần nhưng mốc ban đầu cộng trừ lịch sử ra ${count}.`);
      });
      state.shareholders.forEach((h) => {
        if (!replay.has(h.name) && h.shares !== 0) errs.push(`${h.name} có ${h.shares} cổ phần nhưng không có trong mốc ban đầu hay lịch sử.`);
      });
    }
    return errs;
  }

  /* ---------- định giá ---------- */

  /**
   * Định giá danh mục và phần của từng cổ đông theo giá Binance.
   * @param {object} state
   * @param {Object<string, {last: number, open: number}>} prices
   */
  function valuation(state, prices) {
    const rows = state.assets.map((a) => {
      const factor = hasOwn(UNIT_FACTOR, a.unit) && GOLD_PAIRS.includes(a.pair) ? UNIT_FACTOR[a.unit] : 1;
      const t = a.pair ? prices[a.pair] : null;
      const live = Boolean(t && Number.isFinite(t.last) && t.last > 0);
      const unitPrice = a.pair ? (live ? t.last * factor : 0) : (a.price ?? 0);
      const openPrice = a.pair ? (live && Number.isFinite(t.open) ? t.open * factor : unitPrice) : (a.price ?? 0);
      const amount = isMoney(a.amount) ? a.amount : 0;
      return {
        ...a,
        amount,
        unitPrice,
        value: amount * unitPrice,
        openValue: amount * openPrice,
        change: openPrice ? unitPrice / openPrice - 1 : 0,
        missing: Boolean(a.pair && !live),
      };
    });
    const nav = rows.reduce((s, r) => s + r.value, 0);
    const openNav = rows.reduce((s, r) => s + r.openValue, 0);
    const price = nav / state.totalShares;
    const openPrice = openNav / state.totalShares;
    rows.forEach((r) => {
      r.weight = nav ? r.value / nav : 0;
      r.shareEquivalent = r.weight * state.totalShares;
    });
    return {
      rows,
      nav,
      openNav,
      price,
      price1000: price * 1000,
      openPrice,
      priceChange: price - openPrice,
      changePct: openPrice ? price / openPrice - 1 : 0,
      complete: rows.every((r) => !r.missing),
      holders: state.shareholders.map((h) => ({ ...h, value: h.shares * price, weight: h.shares / state.totalShares })),
    };
  }

  /* ---------- quy tắc làm tròn (dùng chung cho planTx và kiểm tra lịch sử) ---------- */

  /** Góp `cents` theo giá `price`: số cổ phần nhận, làm tròn xuống. */
  const sharesForGop = (cents, price) => Math.floor(cents / 100 / price + EPS);
  /** Rút `cents` theo giá `price`: số cổ phần phải huỷ, làm tròn lên. */
  const sharesForRut = (cents, price) => Math.ceil(cents / 100 / price - EPS);
  /** Rút toàn bộ `shares` theo giá `price`: số tiền trả (cents), làm tròn xuống. */
  const payoutForAll = (shares, price) => Math.floor(shares * price * 100 + EPS);

  /**
   * Cổ phần từng người tính từ mốc ban đầu cộng trừ lịch sử, kèm các dòng rút làm số dư âm giữa chừng.
   * Dùng Map để tên như "constructor" hay "__proto__" không đụng thuộc tính có sẵn của object.
   */
  function replayShares(initial, history) {
    const shares = new Map(Object.keys(initial || {}).map((name) => [name, initial[name]]));
    const negative = [];
    history.forEach((c, index) => {
      const had = shares.get(c.name) || 0;
      const now = had + (c.type === 'gop' ? 1 : -1) * c.shares;
      if (now < 0) negative.push({ index, name: c.name, shares: c.shares, had });
      shares.set(c.name, now);
    });
    return { shares, negative };
  }

  /** Một dòng lịch sử có tính lại ra đúng theo quy tắc làm tròn ở trên không. */
  function historyEntryValid(c) {
    const cents = toCents(c.amount);
    if (c.type === 'gop') return c.shares === sharesForGop(cents, c.sharePrice);
    return c.shares === sharesForRut(cents, c.sharePrice) || cents === payoutForAll(c.shares, c.sharePrice);
  }

  /**
   * Quỹ mở: góp là mua cổ phần mới, rút là bán lại cổ phần cho quỹ, đều theo giá lúc tính.
   * Tổng cổ phần tăng/giảm theo, nên giá mỗi cổ phần chỉ đổi khi tài sản lời/lỗ.
   * @param {object} state
   * @param {object} val  kết quả valuation() với giá vừa lấy; phải có đủ giá mọi tài sản
   * @param {{kind: 'gop'|'rut', who: number, cents?: number, all?: boolean}} tx
   * @returns {{error: string}|object}
   */
  function planTx(state, val, tx) {
    const { kind, who, all } = tx;
    if (!val || !val.complete) return { error: 'Thiếu giá của ít nhất một tài sản, chưa tính được.' };
    const { price } = val;
    if (!(Number.isFinite(price) && price > 0)) return { error: 'Giá mỗi cổ phần không hợp lệ (tổng tài sản bằng 0?), chưa tính được.' };
    const h = state.shareholders[who];
    if (!h) return { error: 'Không tìm thấy cổ đông đã chọn.' };
    if (kind !== 'gop' && kind !== 'rut') return { error: `Loại giao dịch không hợp lệ: ${kind}.` };
    if (!(kind === 'rut' && all) && !(isInt(tx.cents) && tx.cents > 0)) return { error: 'Số tiền không hợp lệ.' };
    const cash = cashAsset(state);
    const cashCents = toCents(cash.amount);
    let cents = tx.cents;
    let delta;

    if (kind === 'gop') {
      delta = sharesForGop(cents, price);
      if (!(delta >= 1)) return { error: `Số tiền nhỏ hơn giá 1 cổ phần (${price} USDT), không đổi được ra cổ phần nào.` };
    } else {
      if (!h.shares) return { error: `${h.name} chưa có cổ phần nào để rút.` };
      if (all) {
        delta = h.shares;
        cents = payoutForAll(h.shares, price);
      } else {
        delta = sharesForRut(cents, price);
        if (delta > h.shares) {
          const max = payoutForAll(h.shares, price) / 100;
          return { error: `${h.name} chỉ có ${h.shares} cổ phần, rút được tối đa ${max} USDT theo giá lúc tính. Nhập số nhỏ hơn hoặc chọn "Rút toàn bộ".` };
        }
      }
      if (!(delta >= 1)) return { error: 'Số cổ phần bị huỷ không hợp lệ.' };
      if (delta >= state.totalShares) return { error: 'Không thể rút hết toàn bộ quỹ bằng form này; khi đó sửa calculated.js bằng tay.' };
      if (!(cents >= 1)) return { error: 'Số tiền rút quá nhỏ.' };
      if (cents > cashCents) return { error: `${cash.name} chỉ còn ${cashCents / 100} ${cash.unit}, không đủ trả ${cents / 100} USDT. Bán bớt BTC hoặc vàng sang tiền mặt (sửa amounts trong calculated.js), tải lại trang rồi tính lại.` };
    }

    const sign = kind === 'gop' ? 1 : -1;
    return {
      kind,
      who,
      name: h.name,
      cents,
      amount: cents / 100,
      delta,
      price,
      sharesBefore: state.shareholders.map((x) => x.shares),
      sharesAfter: state.shareholders.map((x, i) => x.shares + (i === who ? sign * delta : 0)),
      totalBefore: state.totalShares,
      totalAfter: state.totalShares + sign * delta,
      cashBefore: cashCents / 100,
      cashAfter: (cashCents + sign * cents) / 100,
    };
  }

  /** Áp một giao dịch đã tính vào state, trả về state mới (không sửa state cũ). */
  function applyTx(state, plan, date) {
    const cash = cashAsset(state);
    return {
      ...state,
      updatedAt: date,
      totalShares: plan.totalAfter,
      assets: state.assets.map((a) => (a.id === cash.id ? { ...a, amount: plan.cashAfter } : { ...a })),
      shareholders: state.shareholders.map((h, i) => ({ ...h, shares: plan.sharesAfter[i] })),
      // Giá lưu đủ độ chính xác để mỗi dòng lịch sử luôn tính lại ra đúng số cổ phần đã ghi.
      history: [...state.history, {
        date, type: plan.kind, name: plan.name, amount: plan.amount, shares: plan.delta, sharePrice: plan.price,
      }],
    };
  }

  /**
   * Toàn bộ một giao dịch, dùng chung cho trang và CLI: định giá, tính, áp và kiểm tra kết quả.
   * @returns {{error: string}|{valuation: object, plan: object, next: object}}
   */
  function prepareTx(state, prices, tx, date) {
    const v = valuation(state, prices);
    if (!v.complete) return { error: `Thiếu giá cho ${v.rows.filter((r) => r.missing).map((r) => r.pair).join(', ')}, chưa tính được.` };
    const plan = planTx(state, v, tx);
    if (plan.error) return plan;
    const next = applyTx(state, plan, date);
    const bad = validate(next);
    if (bad.length) return { error: `Kết quả không hợp lệ, không xuất: ${bad.join(' ')}` };
    return { valuation: v, plan, next };
  }

  /* ---------- xuất / so sánh sổ ---------- */

  /** Phần dữ liệu của state được ghi ra calculated.js, dùng để so sánh hai state. */
  const ledgerOf = (state) => ({
    totalShares: state.totalShares,
    units: state.assets.map((a) => [a.id, state.units ? state.units[a.id] : undefined]),
    amounts: Object.fromEntries(state.assets.map((a) => [a.id, a.amount])),
    shareholders: state.shareholders.map((h) => ({ name: h.name, shares: h.shares })),
    history: state.history.map((c) => ({ date: c.date, type: c.type, name: c.name, amount: c.amount, shares: c.shares, sharePrice: c.sharePrice })),
  });
  const sameLedger = (a, b) => JSON.stringify(ledgerOf(a)) === JSON.stringify(ledgerOf(b));

  /** Chạy nội dung một file kiểu `window.KEY = ...` trong window giả và trả về object đó (hoặc undefined). */
  function evalCalculated(source, key = 'CALCULATED') {
    const win = {};
    // eslint-disable-next-line no-new-func
    new Function('window', source)(win);
    return win[key];
  }

  /**
   * Xuất state ra nội dung calculated.js. Chỉ giữ các trường chuẩn; chuỗi và tên khoá được quote
   * bằng JSON.stringify nên id hay tên có ký tự đặc biệt vẫn ra file hợp lệ.
   */
  function toSource(state) {
    const q = (s) => JSON.stringify(String(s));
    const amounts = state.assets.map((a) => `    ${q(a.id)}: ${a.amount},`);
    const units = state.assets.map((a) => `    ${q(a.id)}: ${q(a.unit)},`);
    const holders = state.shareholders.map((h) => `    { name: ${q(h.name)}, shares: ${h.shares} },`);
    const history = state.history.map((c) => `    { date: ${q(c.date)}, type: ${q(c.type)}, name: ${q(c.name)}, `
      + `amount: ${c.amount}, shares: ${c.shares}, sharePrice: ${c.sharePrice} },`);
    return `// Số liệu thay đổi theo thời gian của quỹ.
// Mục "Góp vốn" / "Rút vốn" trên trang xuất ra nguyên file này: sao chép rồi dán đè toàn bộ.
// Sửa tay được (vd đổi tiền mặt sang BTC) nhưng chỉ sửa giá trị, không thêm trường mới
// (trường lạ sẽ bị bỏ ở lần xuất sau); tổng shares phải đúng bằng totalShares.
window.CALCULATED = {
  updatedAt: ${q(state.updatedAt)},

  // Tổng số cổ phần đang lưu hành; tăng khi có người góp, giảm khi có người rút.
  totalShares: ${state.totalShares},

  // Số lượng từng tài sản, theo id và đơn vị khai báo trong portfolio.js.
  amounts: {
${amounts.join('\n')}
  },

  // Đơn vị đã dùng cho số lượng ở trên; phải khớp unit trong portfolio.js.
  units: {
${units.join('\n')}
  },

  shareholders: [
${holders.join('\n')}
  ],

  // Lịch sử góp ('gop') và rút ('rut') vốn, để cả nhà đối chiếu.
  history: [
${history.join('\n')}
  ],
};
`;
  }

  return {
    UNIT_FACTOR, GOLD_PAIRS, BINANCE_HOSTS, todayISO, toCents, pairsOf, tickerUrl, parseTickers, fetchWithTimeout, fetchPrices,
    parseAmount, merge, validate, valuation,
    sharesForGop, sharesForRut, payoutForAll, historyEntryValid, replayShares,
    planTx, applyTx, prepareTx, ledgerOf, sameLedger, evalCalculated, toSource, cashAsset, findHolder,
  };
}));
