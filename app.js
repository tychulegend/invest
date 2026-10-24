(() => {
  const F = window.FundCore;
  const $ = (id) => document.getElementById(id);

  // core.js hoặc portfolio.js hỏng thì không dựng được gì; báo rõ thay vì treo ở "Đang tải giá…".
  if (!F || !window.PORTFOLIO || !Array.isArray(window.PORTFOLIO.assets)) {
    $('fund-meta').textContent = 'Trang không chạy được.';
    $('data-problems').hidden = false;
    $('data-problems').textContent = `Không đọc được ${!F ? 'core.js' : 'portfolio.js'} (thiếu file hoặc sai cú pháp, vd viết 26.000,000). Mở file kiểm tra lại.`;
    return;
  }

  // calculated.js lỗi cú pháp hoặc thiếu file thì window.CALCULATED không tồn tại; báo rõ thay vì
  // im lặng hiện NaN.
  const loadError = !window.CALCULATED
    ? 'Không đọc được calculated.js (thiếu file hoặc sai cú pháp, vd dán thiếu hay dùng dấu phẩy cho số lẻ). Mở file kiểm tra lại; trước khi sửa xong, trang không cho góp/rút.'
    : '';
  const S = F.merge(window.PORTFOLIO, window.CALCULATED);
  const problems = loadError ? [loadError] : F.validate(S);

  const REFRESH_MS = 60_000;
  // Mọi trang GitHub Pages của cùng một tài khoản dùng chung origin <user>.github.io, nên khoá
  // localStorage kèm đường dẫn trang để không đè dữ liệu của trang khác.
  const KEY_PREFIX = `invest:${window.location.pathname}:`;
  const CACHE_KEY = `${KEY_PREFIX}tickers`;
  const UNIT_LABEL = { oz: 'oz', luong: 'lượng', chi: 'chỉ', gram: 'g' };

  const ICONS = {
    btc: '<path d="M8 6h5a2.75 2.75 0 0 1 0 5.5H8M8 11.5h5.5a2.75 2.75 0 0 1 0 5.5H8M9.5 6v11M10.5 4v2M13 4v2M10.5 17v2M13 17v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    gold: '<path d="M7.5 11.5h9L15 7.5H9z" fill="currentColor" fill-opacity=".35" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3.5 18.5h8l-1.5-4.5H5zM12.5 18.5h8L19 14h-5z" fill="currentColor" fill-opacity=".35" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M19 4.5v2.5M17.75 5.75h2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    cash: '<rect x="2.75" y="6.5" width="18.5" height="11" rx="2" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.75 9.5v.01M18.25 14.5v.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  };

  const nf = (min, max = min) => new Intl.NumberFormat('vi-VN', { minimumFractionDigits: min, maximumFractionDigits: max });
  const fmt2 = nf(2);
  const fmtInt = nf(0);
  const fmtQty = nf(0, 8);
  const fmtPct = nf(2);
  const fmt6 = nf(6);
  const fmt4 = nf(4);
  const fmtOwnNf = nf(2, 4);
  const fmtShare = (v) => (v < 1 ? fmt6 : fmt4).format(v);
  // Tỷ lệ sở hữu nhỏ (vd 0,0123%) cần thêm chữ số mới thấy khác biệt.
  const fmtOwn = (shares, total = S.totalShares) => `${fmtOwnNf.format((shares / total) * 100)}%`;
  const fmtDate = (iso) => String(iso || '?').split('-').reverse().join('/');
  const signed = (v, f) => (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Đơn vị hiển thị. Chỉ đổi cách hiện số; mọi phép tính, góp/rút và lịch sử vẫn bằng USDT.
  const VND_RATE = window.PORTFOLIO.vndRate;
  // Tỷ giá USDT/VNĐ thực tế quanh vài chục nghìn; ngoài khoảng này gần như chắc là gõ nhầm,
  // vd 26.000 (= 26 trong JavaScript).
  const hasVnd = Number.isFinite(VND_RATE) && VND_RATE >= 1000 && VND_RATE <= 1000000;
  const warnings = VND_RATE !== undefined && !hasVnd
    ? [`vndRate trong portfolio.js đang là ${JSON.stringify(VND_RATE)}, không giống tỷ giá USDT/VNĐ. Viết liền, vd 26000 (không viết 26.000). Tạm ẩn nút xem bằng VNĐ.`]
    : [];
  const CURRENCY_KEY = `${KEY_PREFIX}currency`;
  let currency = 'USDT';
  try { if (hasVnd && localStorage.getItem(CURRENCY_KEY) === 'VND') currency = 'VND'; } catch (e) {}
  const inVnd = () => currency === 'VND';
  const curLabel = () => (inVnd() ? 'VNĐ' : 'USDT');
  /** Số tiền (đầu vào luôn là USDT) theo đơn vị đang chọn, không kèm đơn vị. */
  const fmtMoney = (usdt) => (inVnd() ? fmtInt.format(usdt * VND_RATE) : fmt2.format(usdt));
  const money = (usdt) => `${fmtMoney(usdt)} ${curLabel()}`;
  // Giá 1 cổ phần nhỏ (vài nghìn VNĐ, vài phần trăm USDT) nên cần nhiều chữ số hơn số tiền thường.
  const fmtSharePrice = (usdt) => (inVnd() ? fmt2.format(usdt * VND_RATE) : fmtShare(usdt));
  const txType = (c) => (c.type === 'rut' ? 'rut' : 'gop');
  const VERB = { gop: 'góp', rut: 'rút' };
  const pairs = () => F.pairsOf(S);
  const holders = () => S.shareholders;

  // Tài sản thêm mới chưa có icon riêng thì dùng chấm màu như cũ.
  const icon = (x, size = '') => (ICONS[x.id]
    ? `<span class="asset-icon ${size}" style="--c:var(--c-${esc(x.id)})" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[x.id]}</svg></span>`
    : `<span class="swatch" style="background:var(--c-${esc(x.id)})"></span>`);
  // Nhãn đi kèm từng ô để khi xếp dạng khối trên mobile vẫn đọc được mà không cần hàng tiêu đề.
  const cell = (cls, label, value) =>
    `<span class="cell ${cls}" role="cell"><span class="cell-label">${label}</span><span class="cell-value">${value}</span></span>`;
  const pctChange = (v) => `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${signed(v * 100, (n) => fmtPct.format(n))}%</span>`;

  /* ---------- prices ---------- */

  // Cache chỉ dùng để hiển thị khi mất mạng, không bao giờ dùng để tính góp/rút.
  function readCache() {
    try {
      const d = JSON.parse(localStorage.getItem(CACHE_KEY));
      const ok = d && typeof d.prices === 'object' && Number.isFinite(d.at)
        && pairs().every((p) => d.prices[p] && Number.isFinite(d.prices[p].last));
      return ok ? d : null;
    } catch (e) { return null; }
  }
  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  // Ba loại lỗi được báo khác nhau: mất mạng, Binance trả dữ liệu không dùng được, và lỗi vẽ trang.
  class PriceError extends Error {}
  class RenderError extends Error {}

  // Host trả lời được lần trước được thử trước, để host chính bị treo không làm mọi lần tải chờ 8 giây.
  let hosts = [...F.BINANCE_HOSTS];

  async function fetchTickers() {
    const list = pairs();
    if (!list.length) return { prices: {}, at: Date.now(), host: null };
    try {
      const { prices, host } = await F.fetchPrices(list, { fetchImpl: window.fetch.bind(window), hosts });
      hosts = [host, ...hosts.filter((h) => h !== host)];
      return { prices, at: Date.now(), host: new URL(host).host };
    } catch (e) {
      if (e.badRequest) throw new PriceError(e.message);
      throw e;
    }
  }

  /* ---------- render ---------- */

  function renderCertificate(v) {
    $('share-price').textContent = fmtSharePrice(v.price);
    $('nav-total').textContent = money(v.nav);
    $('shares-total').textContent = fmtInt.format(S.totalShares);
    $('price-1000').textContent = money(v.price1000);
    const ch = v.changePct;
    const el = $('share-change');
    el.className = 'cert-change ' + (ch > 0 ? 'up' : ch < 0 ? 'down' : '');
    el.textContent = `${signed(ch * 100, (n) => fmtPct.format(n))}% trong 24 giờ (${signed(v.priceChange, fmtSharePrice)} ${curLabel()} mỗi cổ phần)`;
  }

  function arcPath(cx, cy, R, r, a0, a1) {
    const pt = (rad, a) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, a0);
    return `M${x0} ${y0}A${R} ${R} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${large} 0 ${x3} ${y3}Z`;
  }

  function renderDonut(v) {
    const svg = $('donut');
    const tip = $('tooltip');
    const cx = 110, cy = 110, R = 104, r = 70;
    const parts = v.rows.filter((x) => x.value > 0);
    let a = 0;
    // Vẽ lại thay mất lát đang được trỏ chuột mà không có mouseleave; ẩn tooltip cũ cho khỏi treo số cũ.
    tip.hidden = true;
    // Vàng và cam BTC gần màu nhau; ánh kim cho lát vàng giúp phân biệt mà vẫn giữ đúng "màu vàng".
    const defs = `<defs><linearGradient id="gold-sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" style="stop-color:var(--gold-lo)"/>
      <stop offset="0.45" style="stop-color:var(--gold-hi)"/>
      <stop offset="0.6" style="stop-color:var(--c-gold)"/>
      <stop offset="1" style="stop-color:var(--gold-lo)"/>
    </linearGradient></defs>`;
    svg.innerHTML = defs + parts.map((x) => {
      // Lát 100% vẽ hơi thiếu một chút, vì cung tròn trọn vẹn không vẽ được bằng một lệnh arc.
      const sweep = Math.min(x.weight, 0.99999) * Math.PI * 2;
      const d = arcPath(cx, cy, R, r, a, a + sweep);
      const mid = a + sweep / 2;
      a += sweep;
      const fill = x.id === 'gold' ? 'url(#gold-sheen)' : `var(--c-${esc(x.id)})`;
      return `<path d="${d}" fill="${fill}" data-id="${esc(x.id)}" data-mid="${mid}" tabindex="0"
        aria-label="${esc(x.name)}: ${fmtPct.format(x.weight * 100)}%, ${money(x.value)}"></path>`;
    }).join('');
    $('donut-center').textContent = fmtInt.format(inVnd() ? v.nav * VND_RATE : v.nav);
    // Số VNĐ dài (vài tỷ) không vừa lòng vòng tròn ở cỡ chữ thường.
    $('donut-center').classList.toggle('is-long', $('donut-center').textContent.length > 9);

    const show = (path) => {
      const x = parts.find((p) => p.id === path.dataset.id);
      const mid = +path.dataset.mid;
      const k = svg.getBoundingClientRect().width / 220;
      tip.innerHTML = `<strong>${esc(x.name)}</strong>${fmtPct.format(x.weight * 100)}% danh mục<br>${money(x.value)}`;
      tip.style.left = `${(cx + R * Math.sin(mid)) * k}px`;
      tip.style.top = `${(cy - R * Math.cos(mid)) * k}px`;
      tip.hidden = false;
      highlight(x.id);
    };
    const hide = () => { tip.hidden = true; highlight(null); };
    svg.querySelectorAll('path').forEach((p) => {
      p.addEventListener('mouseenter', () => show(p));
      p.addEventListener('focus', () => show(p));
      p.addEventListener('mouseleave', hide);
      p.addEventListener('blur', hide);
    });

    $('legend').innerHTML = v.rows.map((x) => `
      <li data-id="${esc(x.id)}">
        ${icon(x, 'sm')}
        <span>${esc(x.name)}</span>
        <span class="val">${fmtMoney(x.value)}</span>
        <span class="pct">${fmtPct.format(x.weight * 100)}%</span>
      </li>`).join('');
    $('legend').querySelectorAll('li').forEach((li) => {
      li.addEventListener('mouseenter', () => highlight(li.dataset.id));
      li.addEventListener('mouseleave', () => highlight(null));
    });
  }

  function highlight(id) {
    $('donut').querySelectorAll('path').forEach((p) => p.classList.toggle('dim', id !== null && p.dataset.id !== id));
  }

  const unitLabel = (x) => UNIT_LABEL[x.unit] || x.unit;

  function renderLedger(v) {
    const lines = v.rows.map((x, i) => `
      <tr>
        <td class="op">${i ? '+' : ''}</td>
        <td><span class="ledger-asset">${icon(x, 'sm')}<span>${esc(x.name)}<span class="sub">${fmtQty.format(x.amount)} ${esc(unitLabel(x))}${x.pair || inVnd() ? ` × ${fmtMoney(x.unitPrice)}` : ''}</span></span></span></td>
        <td>${fmtMoney(x.value)}</td>
      </tr>`).join('');
    $('ledger').innerHTML = `
      <tbody>
        ${lines}
        <tr class="total"><td class="op">=</td><td>Tổng tài sản ròng</td><td>${money(v.nav)}</td></tr>
        <tr><td class="op">÷</td><td>Tổng số cổ phần</td><td>${fmtInt.format(S.totalShares)}</td></tr>
        <tr class="result"><td class="op">=</td><td>Giá mỗi cổ phần</td><td>${fmtSharePrice(v.price)} ${curLabel()}</td></tr>
      </tbody>`;
  }

  function renderHoldings(v) {
    $('holdings').innerHTML = v.rows.map((x) => `
      <div class="asset" role="row" style="--w:${(x.weight * 100).toFixed(2)}%;--c:var(--c-${esc(x.id)})">
        <span class="cell c-name" role="cell">
          ${icon(x)}
          <span>${esc(x.name)} <span class="sub">${esc(x.ticker)}</span></span>
        </span>
        ${cell('c-qty', 'Số lượng', `${fmtQty.format(x.amount)} ${esc(unitLabel(x))}`)}
        ${cell('c-price', 'Đơn giá', x.missing ? 'Không có giá' : fmtMoney(x.unitPrice))}
        ${cell('c-chg', '24 giờ', x.pair ? pctChange(x.change) : '<span class="sub">—</span>')}
        ${cell('c-value', `Giá trị (${curLabel()})`, fmtMoney(x.value))}
        ${cell('c-weight', 'Tỷ trọng', `${fmtPct.format(x.weight * 100)}%`)}
        ${cell('c-shares', 'Cổ phần tương ứng', fmtInt.format(x.shareEquivalent))}
      </div>`).join('');
    $('holdings-foot').innerHTML = `
      <div class="asset asset-total" role="row">
        <span class="cell c-name" role="cell">Tổng cộng</span>
        ${cell('c-chg', '24 giờ', pctChange(v.changePct))}
        ${cell('c-value', `Giá trị (${curLabel()})`, fmtMoney(v.nav))}
        ${cell('c-weight', 'Tỷ trọng', '100,00%')}
        ${cell('c-shares', 'Cổ phần', fmtInt.format(S.totalShares))}
      </div>`;
  }

  function renderHolders(v) {
    const list = v.holders;
    $('holders-panel').hidden = !list.length;
    if (!list.length) return;
    $('holders').innerHTML = list.map((h) => `
      <div class="holder${h.shares ? '' : ' empty'}" role="row" style="--w:${(h.weight * 100).toFixed(4)}%">
        <span class="cell h-name" role="cell">${esc(h.name)}</span>
        ${cell('h-shares', 'Số cổ phần', fmtInt.format(h.shares))}
        ${cell('h-pct', 'Sở hữu', fmtOwn(h.shares))}
        ${cell('h-value', `Giá trị (${curLabel()})`, fmtMoney(h.value))}
      </div>`).join('');

    $('history-wrap').hidden = !S.history.length;
    $('history').innerHTML = [...S.history].reverse().map((c) => `
      <li class="tx-${txType(c)}">
        <span class="history-date">${esc(fmtDate(c.date))}</span>
        <span><strong>${esc(c.name)}</strong> ${VERB[txType(c)]} ${fmt2.format(c.amount)} USDT${c.shares ? ` (${fmtInt.format(c.shares)} cổ phần)` : ''}</span>
        <span class="history-price">giá ${fmtShare(c.sharePrice)} USDT/cổ phần</span>
      </li>`).join('');
  }

  // Giá lần vẽ gần nhất, để đổi USDT/VNĐ vẽ lại ngay mà không gọi lại Binance.
  let lastData = null;

  function render(data, v = F.valuation(S, data.prices)) {
    lastData = data;
    document.querySelectorAll('[data-cur]').forEach((el) => { el.textContent = curLabel(); });
    renderCertificate(v);
    renderDonut(v);
    renderLedger(v);
    renderHoldings(v);
    renderHolders(v);
    const when = new Date(data.at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
    $('fund-meta').textContent = `Giá cập nhật lúc ${when}${data.host ? `, nguồn ${data.host}` : ''}`;
    return v;
  }

  function notify(msg) {
    $('notice').textContent = msg || '';
    $('notice').hidden = !msg;
  }

  // Lỗi dữ liệu (calculated.js sai) luôn hiện thường trực, không bị thông báo giá ghi đè.
  function showProblems() {
    const list = (items) => `<ul>${items.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
    $('data-problems').hidden = !problems.length && !warnings.length;
    $('data-problems').innerHTML = (problems.length ? `<strong>calculated.js có vấn đề, góp/rút tạm khoá:</strong>${list(problems)}` : '')
      + (warnings.length ? `<strong>Cấu hình cần xem lại:</strong>${list(warnings)}` : '');
  }

  /** Lấy giá mới và vẽ lại trang. Ném lỗi mạng/giá ra ngoài; lỗi vẽ trang báo riêng. */
  async function loadPrices() {
    const data = await fetchTickers();
    const v = F.valuation(S, data.prices);
    if (!v.complete) {
      const missing = v.rows.filter((x) => x.missing).map((x) => x.pair);
      throw new PriceError(`Binance không trả về giá cho ${missing.join(', ')}. Kiểm tra lại tên pair trong portfolio.js.`);
    }
    writeCache(data);
    try {
      render(data, v);
    } catch (e) {
      throw new RenderError(`Lỗi hiển thị trang: ${e.message}`);
    }
    return { data, v };
  }

  async function refresh() {
    const btn = $('refresh');
    btn.disabled = true;
    btn.textContent = 'Đang cập nhật…';
    try {
      await loadPrices();
      notify('');
    } catch (e) {
      if (e instanceof PriceError || e instanceof RenderError) return notify(e.message);
      const cached = readCache();
      if (cached) {
        try { render(cached); } catch (re) { return notify(`Lỗi hiển thị trang: ${re.message}`); }
      }
      notify(cached
        ? 'Không kết nối được Binance. Đang hiển thị giá đã lưu lần trước; bấm "Cập nhật giá" để thử lại.'
        : 'Không kết nối được Binance nên chưa có giá. Kiểm tra mạng rồi bấm "Cập nhật giá".');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Cập nhật giá';
    }
  }

  /* ---------- góp / rút vốn ---------- */

  // Sau khi đã sao chép một giao dịch, mọi tính toán tiếp theo trong lần mở trang này đều dựa
  // trên dữ liệu cũ; khoá lại để không thể tạo file thứ hai ghi đè mất giao dịch vừa làm.
  let locked = false;
  let copiedKind = null;
  // Mỗi lần bấm "Tính cổ phần" có một mã; sửa ô nhập hay bấm lại thì mã đổi, kết quả về muộn
  // của lần cũ bị bỏ thay vì hiện ra dưới dữ liệu nhập mới.
  const reqId = { gop: 0, rut: 0 };
  // Giao dịch mà file đang hiện trong mỗi khung sẽ thêm vào lịch sử (để so khi sao chép).
  const exports = { gop: null, rut: null };
  // Kết quả tính theo giá của một thời điểm; để lâu thì giá đã khác, phải tính lại mới được sao chép.
  const RESULT_TTL_MS = 2 * 60 * 1000;
  const resultAt = { gop: 0, rut: 0 };
  // Nhớ trên trình duyệt này (dùng chung mọi tab): giao dịch vừa sao chép là dòng thứ mấy của
  // lịch sử và nội dung dòng đó. calculated.js chưa có đúng dòng ấy nghĩa là chưa dán, dán nhầm
  // file khác, hoặc GitHub Pages chưa cập nhật.
  const EXPECT_KEY = `${KEY_PREFIX}expectedTx`;
  const lockedMsg = 'Vừa sao chép một giao dịch. Dán đè calculated.js, tải lại trang rồi mới làm giao dịch tiếp.';

  function readExpected() {
    try {
      const e = JSON.parse(localStorage.getItem(EXPECT_KEY));
      return e && Number.isInteger(e.count) && e.entry ? e : null;
    } catch (err) { return null; }
  }

  /** Giao dịch đã sao chép (ở tab này hay tab khác) mà calculated.js đang dùng chưa có thì báo. */
  function pendingCopyProblem() {
    const exp = readExpected();
    if (!exp) return '';
    const have = S.history[exp.count - 1];
    if (S.history.length >= exp.count && JSON.stringify(have) === JSON.stringify(exp.entry)) return '';
    const what = `${exp.entry.name} ${VERB[txType(exp.entry)]} ${fmt2.format(exp.entry.amount)} USDT`;
    return S.history.length < exp.count
      ? `Đã sao chép giao dịch "${what}" nhưng calculated.js trang đang dùng chưa có giao dịch đó. Có thể chưa dán file mới, hoặc GitHub Pages chưa cập nhật (đợi vài phút rồi tải lại). Tính tiếp bây giờ sẽ làm mất giao dịch đó.`
      : `calculated.js đang dùng không chứa giao dịch vừa sao chép ("${what}") ở dòng ${exp.count}; có thể đã dán nhầm file khác. Kiểm tra lại trước khi tính tiếp.`;
  }

  /**
   * Tải lại calculated.js mới nhất từ máy chủ (bỏ qua cache) và so với bản trang đang dùng.
   * Khác nhau nghĩa là ở đâu đó (tab khác, máy khác, CLI) đã có giao dịch mới: tính tiếp sẽ ghi đè mất.
   */
  async function latestLedgerProblem() {
    let latest;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`calculated.js?v=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      latest = F.merge(window.PORTFOLIO, F.evalCalculated(await res.text()));
    } catch (e) {
      return `Không kiểm tra được calculated.js mới nhất trên máy chủ (${e.name === 'AbortError' ? 'quá 8 giây' : e.message}), chưa làm để tránh ghi đè. Mở trang qua http(s), không mở thẳng file, rồi thử lại.`;
    } finally {
      clearTimeout(timer);
    }
    return F.sameLedger(latest, S) ? '' : 'calculated.js trên máy chủ đã khác bản trang đang dùng (có giao dịch hoặc chỉnh sửa mới). Tải lại trang rồi tính lại.';
  }

  function txError(kind, msg) {
    $(`${kind}-error`).textContent = msg || '';
    $(`${kind}-error`).hidden = !msg;
  }

  // Kết quả gắn với giá lúc bấm; sửa ô nhập là kết quả cũ không còn đúng nên ẩn đi.
  function clearTx(kind) {
    reqId[kind]++;
    $(`${kind}-result`).hidden = true;
    $(`${kind}-snippet`).textContent = '';
    txError(kind, '');
  }

  async function calculateTx(kind, e) {
    e.preventDefault();
    clearTx(kind);
    if (locked) return txError(kind, lockedMsg);
    if (problems.length) return txError(kind, 'calculated.js đang có lỗi (xem thông báo đầu trang), sửa xong mới góp/rút được.');
    const pending = pendingCopyProblem();
    if (pending) return txError(kind, pending);
    const who = +$(`${kind}-who`).value;
    const all = kind === 'rut' && $('rut-all').checked;
    let cents;
    if (!all) {
      const parsed = F.parseAmount($(`${kind}-amount`).value);
      if (parsed.error) return txError(kind, parsed.error);
      cents = parsed.cents;
    }

    const id = reqId[kind];
    const btn = $(`${kind}-calc`);
    btn.disabled = true;
    btn.textContent = 'Đang lấy giá…';
    let fresh;
    let stale;
    try {
      // Luôn lấy giá mới ngay lúc bấm, không dùng giá cache: tính trên giá cũ là chia cổ phần sai.
      // Đồng thời đối chiếu calculated.js mới nhất, để không tính trên sổ đã cũ.
      [fresh, stale] = await Promise.all([loadPrices(), latestLedgerProblem()]);
      notify('');
    } catch (err) {
      if (id !== reqId[kind]) return undefined;
      return txError(kind, err instanceof PriceError || err instanceof RenderError
        ? `${err.message} Chưa tính được.`
        : 'Không lấy được giá mới từ Binance nên chưa tính. Kiểm tra mạng rồi bấm "Tính cổ phần" lại.');
    } finally {
      btn.disabled = locked;
      btn.textContent = 'Tính cổ phần';
    }

    // Trong lúc chờ giá có thể đã sao chép giao dịch khác (khoá, ở tab này hay tab khác) hoặc đã sửa ô nhập.
    if (locked) return txError(kind, lockedMsg);
    if (id !== reqId[kind]) return undefined;
    if (stale) return txError(kind, stale);
    const pendingNow = pendingCopyProblem();
    if (pendingNow) return txError(kind, pendingNow);
    const r = F.prepareTx(S, fresh.data.prices, { kind, who, cents, all }, F.todayISO());
    if (r.error) return txError(kind, r.error);
    renderTx(r.plan, r.next, fresh.data.at, r.valuation);
  }

  function renderTx(plan, next, at, v) {
    const k = plan.kind;
    const cash = F.cashAsset(S);
    const when = new Date(at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const moved = k === 'gop'
      ? `<div><dt>Số tiền góp</dt><dd>${fmt2.format(plan.amount)} USDT</dd></div>
         <div><dt>${esc(plan.name)} nhận thêm</dt><dd>${fmtInt.format(plan.delta)} cổ phần</dd></div>`
      : `<div><dt>${esc(plan.name)} nhận về</dt><dd>${fmt2.format(plan.amount)} USDT</dd></div>
         <div><dt>Cổ phần bị huỷ</dt><dd>${fmtInt.format(plan.delta)}</dd></div>`;
    $(`${k}-facts`).innerHTML = `
      <div><dt>Giá mỗi cổ phần lúc ${when}</dt><dd>${fmtShare(plan.price)} USDT</dd></div>
      ${moved}
      <div><dt>${esc(cash.name)}</dt><dd>${fmt2.format(plan.cashBefore)} → ${fmt2.format(plan.cashAfter)}</dd></div>
      <div><dt>Tổng cổ phần</dt><dd>${fmtInt.format(plan.totalBefore)} → ${fmtInt.format(plan.totalAfter)}</dd></div>`;

    $(`${k}-rows`).innerHTML = holders().map((h, i) => {
      const before = plan.sharesBefore[i], after = plan.sharesAfter[i], d = after - before;
      const tag = d ? ` <span class="${d > 0 ? 'up' : 'down'}">(${signed(d, (n) => fmtInt.format(n))})</span>` : '';
      return `
        <div class="holder contrib-row${i === plan.who ? ' is-who' : ''}" role="row">
          <span class="cell h-name" role="cell">${esc(h.name)}</span>
          ${cell('h-sb', 'Cổ phần trước', fmtInt.format(before))}
          ${cell('h-sa', 'Cổ phần sau', `${fmtInt.format(after)}${tag}`)}
          ${cell('h-pb', 'Sở hữu trước', fmtOwn(before, plan.totalBefore))}
          ${cell('h-pa', 'Sở hữu sau', `<strong>${fmtOwn(after, plan.totalAfter)}</strong>`)}
        </div>`;
    }).join('');

    const pre = $(`${k}-snippet`);
    pre.textContent = F.toSource(next);
    exports[k] = { count: next.history.length, entry: next.history[next.history.length - 1] };
    resultAt[k] = at;
    $(`${k}-note`).textContent = k === 'gop'
      ? `Đã cộng sẵn ${fmt2.format(plan.amount)} vào ${cash.name} và ghi vào lịch sử. Kết quả giữ nguyên theo giá lúc bấm; dán đè toàn bộ calculated.js rồi tải lại trang.`
      : `Đã trừ sẵn ${fmt2.format(plan.amount)} khỏi ${cash.name} và ghi vào lịch sử. Chuyển đúng ${fmt2.format(plan.amount)} USDT cho ${plan.name}, rồi dán đè toàn bộ calculated.js và tải lại trang.`;
    // Gõ theo thói quen số VNĐ vào ô USDT sẽ ra một khoản lớn hơn cả quỹ; nhắc rõ trước khi sao chép.
    if (k === 'gop' && plan.amount > v.nav) {
      $(`${k}-note`).textContent = `Lưu ý: ${fmt2.format(plan.amount)} USDT lớn hơn toàn bộ quỹ hiện tại (${fmt2.format(v.nav)} USDT). Ô số tiền tính bằng USDT, không phải VNĐ; kiểm tra lại trước khi sao chép. ${$(`${k}-note`).textContent}`;
    }
    $(`${k}-status`).textContent = '';
    $(`${k}-result`).hidden = false;
  }

  function lockTx(message, keepKind) {
    locked = true;
    ['gop', 'rut'].forEach((k) => {
      $(`${k}-calc`).disabled = true;
      $(`${k}-calc`).title = 'Tải lại trang sau khi dán calculated.js';
      // Kết quả của khung kia cũng được tính trên dữ liệu cũ; giấu đi để không thể sao chép nhầm.
      if (k !== keepKind) clearTx(k);
    });
    document.querySelectorAll('[data-base]').forEach((el) => {
      el.classList.add('is-locked');
      el.textContent = message;
    });
  }

  /** Lý do không cho sao chép kết quả của khung `kind`, hoặc chuỗi rỗng nếu được. */
  function copyBlocked(kind) {
    if (locked && kind !== copiedKind) return lockedMsg;
    const exp = readExpected();
    // Đã có giao dịch khác được sao chép (tab này hay tab khác) mà sổ chưa có: không cho xuất thêm.
    if (exp && JSON.stringify(exp) !== JSON.stringify(exports[kind])) {
      const problem = pendingCopyProblem();
      if (problem) return problem;
    }
    return '';
  }

  /** Lưu dấu "đã sao chép giao dịch này"; trả false nếu trình duyệt không cho lưu. */
  function saveExpected(kind) {
    try {
      const v = JSON.stringify(exports[kind]);
      localStorage.setItem(EXPECT_KEY, v);
      return localStorage.getItem(EXPECT_KEY) === v;
    } catch (e) { return false; }
  }

  function markCopied(kind) {
    copiedKind = kind;
    lockTx('Đã sao chép một giao dịch. Dán đè calculated.js rồi tải lại trang trước khi làm giao dịch tiếp, nếu không giao dịch vừa rồi sẽ bị ghi đè mất.', kind);
  }

  const expired = (kind) => Date.now() - resultAt[kind] > RESULT_TTL_MS;
  const expiredMsg = 'Kết quả tính theo giá hơn 2 phút trước, giá đã khác. Bấm "Tính cổ phần" lại rồi sao chép ngay.';

  async function copySnippet(kind) {
    const pre = $(`${kind}-snippet`);
    const status = $(`${kind}-status`);
    if (!pre.textContent) return;
    const blocked = copyBlocked(kind);
    if (blocked) { status.textContent = blocked; return; }
    if (expired(kind)) { clearTx(kind); txError(kind, expiredMsg); return; }

    const id = reqId[kind];
    const text = pre.textContent;
    let refusal = null;
    let saved = false;
    status.textContent = 'Đang kiểm tra calculated.js mới nhất…';
    // Kiểm tra lại máy chủ ngay lúc sao chép: từ lúc tính tới giờ có thể đã có giao dịch ở máy khác.
    const checked = (async () => {
      const stale = await latestLedgerProblem();
      if (id !== reqId[kind]) refusal = { msg: '' };
      else if (stale) refusal = { msg: stale, clear: true };
      else if (copyBlocked(kind)) refusal = { msg: copyBlocked(kind) };
      else if (expired(kind)) refusal = { msg: expiredMsg, clear: true };
      else if (!(saved = saveExpected(kind))) {
        refusal = { msg: 'Trình duyệt không lưu được dữ liệu trang (chế độ ẩn danh hoặc chặn lưu trữ), nên không bảo vệ được việc ghi đè. Mở bằng cửa sổ thường rồi thử lại.' };
      }
      if (refusal) throw new Error(refusal.msg);
      return text;
    })();
    checked.catch(() => {});

    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': checked.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      } else {
        await navigator.clipboard.writeText(await checked);
      }
    } catch (e) {
      if (saved) { try { localStorage.removeItem(EXPECT_KEY); } catch (err) {} }
      if (refusal) {
        if (refusal.clear) { clearTx(kind); txError(kind, refusal.msg); status.textContent = ''; } else status.textContent = refusal.msg;
        return;
      }
      // Không có đường sao chép tay: mọi lối sao chép phải đi qua kiểm tra ở trên.
      status.textContent = 'Trình duyệt không cho sao chép tự động (cần mở trang qua https hoặc localhost). Chưa sao chép gì.';
      return;
    }
    status.textContent = 'Đã sao chép.';
    markCopied(kind);
  }

  // Tự bôi đen rồi Ctrl+C sẽ bỏ qua mọi kiểm tra ở nút "Sao chép", nên chặn hẳn.
  function blockManualCopy(e) {
    const sel = window.getSelection();
    const hit = ['gop', 'rut'].find((k) => sel && !sel.isCollapsed && !$(`${k}-result`).hidden
      && $(`${k}-snippet`).textContent && sel.containsNode($(`${k}-snippet`), true));
    if (!hit) return;
    e.preventDefault();
    $(`${hit}-status`).textContent = 'Dùng nút "Sao chép calculated.js" để sao chép, không bôi đen sao chép tay.';
  }

  /** Mở lại trang mà calculated.js chưa có giao dịch đã sao chép lần trước thì khoá và giải thích. */
  function checkExpectedTx() {
    if (!readExpected()) return;
    const problem = pendingCopyProblem();
    if (!problem) {
      try { localStorage.removeItem(EXPECT_KEY); } catch (e) {}
      return;
    }
    lockTx(problem, null);
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'btn btn-skip';
    skip.textContent = 'Tôi đã bỏ giao dịch đó, mở khoá';
    skip.addEventListener('click', () => {
      try { localStorage.removeItem(EXPECT_KEY); } catch (e) {}
      window.location.reload();
    });
    document.querySelector('#gop-panel [data-base]').append(' ', skip);
  }

  function setupTx() {
    const show = !!holders().length;
    $('gop-panel').hidden = !show;
    $('rut-panel').hidden = !show;
    if (!show) return;

    const last = S.history[S.history.length - 1];
    const base = `Đang tính trên calculated.js ngày ${fmtDate(S.updatedAt)}: `
      + `${fmtInt.format(S.totalShares)} cổ phần, ${S.history.length} giao dịch đã ghi`
      + (last ? `, gần nhất là ${last.name} ${VERB[txType(last)]} ${fmt2.format(last.amount)} USDT.` : '.')
      + ' Nếu chưa thấy giao dịch vừa dán, tải lại trang trước khi tính tiếp.';
    document.querySelectorAll('[data-base]').forEach((el) => { el.textContent = base; });

    $('gop-who').innerHTML = holders().map((h, i) => `<option value="${i}">${esc(h.name)}</option>`).join('');
    // Chỉ người đang có cổ phần mới rút được.
    $('rut-who').innerHTML = holders().map((h, i) => (h.shares
      ? `<option value="${i}">${esc(h.name)} (${fmtInt.format(h.shares)} cổ phần)</option>` : '')).join('');

    ['gop', 'rut'].forEach((k) => {
      $(`${k}-form`).addEventListener('input', () => clearTx(k));
      $(`${k}-amount`).addEventListener('input', () => {
        const p = F.parseAmount($(`${k}-amount`).value);
        $(`${k}-hint`).textContent = p.error || !hasVnd ? '' : `= ${fmt2.format(p.cents / 100)} USDT ≈ ${fmtInt.format((p.cents / 100) * VND_RATE)} VNĐ`;
      });
      $(`${k}-form`).addEventListener('submit', (e) => calculateTx(k, e));
      $(`${k}-copy`).addEventListener('click', () => copySnippet(k));
    });
    $('rut-all').addEventListener('change', () => {
      $('rut-amount').disabled = $('rut-all').checked;
      if ($('rut-all').checked) $('rut-amount').value = '';
    });
    document.addEventListener('copy', blockManualCopy);
    checkExpectedTx();
  }

  /* ---------- guilloché rosette ---------- */

  function drawRosette() {
    const paths = [];
    const N = 720;
    const curve = (fn) => {
      let d = '';
      for (let i = 0; i <= N; i++) {
        const [x, y] = fn((i / N) * Math.PI * 2);
        d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
      }
      return `<path d="${d}Z"/>`;
    };
    // Vòng ngoài: các sóng lệch pha chồng lên nhau, kiểu viền tờ cổ phiếu.
    for (let k = 0; k < 6; k++) {
      const base = 78 + k * 3.2, phase = k * 0.35;
      paths.push(curve((t) => {
        const rr = base + 4 * Math.sin(30 * t + phase);
        return [rr * Math.cos(t), rr * Math.sin(t)];
      }));
    }
    // Lõi: hypotrochoid tạo hoa văn đan.
    for (let k = 0; k < 3; k++) {
      const R = 60, rr = 60 / 12, dd = 34 + k * 8;
      paths.push(curve((t) => [
        (R - rr) * Math.cos(t) * (dd / 60) + dd * Math.cos(((R - rr) / rr) * t) * 0.6,
        (R - rr) * Math.sin(t) * (dd / 60) - dd * Math.sin(((R - rr) / rr) * t) * 0.6,
      ]));
    }
    $('rosette').innerHTML = `<g fill="none" stroke="currentColor" stroke-width="0.35">${paths.join('')}</g>`;
  }

  /* ---------- currency ---------- */

  function setupCurrency() {
    if (!hasVnd) return;
    $('rate-note').textContent = `1 USDT = ${fmtInt.format(VND_RATE)} VNĐ`;
    const sw = $('currency-switch');
    sw.hidden = false;
    const sync = () => sw.querySelectorAll('[data-currency]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.currency === currency));
    });
    sw.addEventListener('click', (e) => {
      const b = e.target.closest('[data-currency]');
      if (!b || b.dataset.currency === currency) return;
      currency = b.dataset.currency;
      try { localStorage.setItem(CURRENCY_KEY, currency); } catch (err) {}
      sync();
      if (lastData) {
        try { render(lastData); } catch (err) { notify(`Lỗi hiển thị trang: ${err.message}`); }
      }
    });
    sync();
  }

  /* ---------- theme ---------- */

  function setupTheme() {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const current = () => root.dataset.theme || (mq.matches ? 'dark' : 'light');
    const sync = () => {
      const dark = current() === 'dark';
      $('theme-toggle').setAttribute('aria-label', dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối');
      $('theme-toggle').innerHTML = dark
        ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></g></svg>'
        : '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" fill="currentColor"/></svg>';
    };
    $('theme-toggle').addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem(`theme:${window.location.pathname}`, next); } catch (e) {}
      sync();
    });
    // Safari < 14 chỉ có addListener.
    if (mq.addEventListener) mq.addEventListener('change', sync);
    else if (mq.addListener) mq.addListener(sync);
    sync();
  }

  /* ---------- boot ---------- */

  $('fund-name').textContent = S.name;
  document.title = S.name;
  drawRosette();
  setupTheme();
  setupCurrency();
  showProblems();
  setupTx();
  // calculated.js hỏng thì không có totalShares, vẽ giá sẽ ra NaN; khoá luôn nút cập nhật.
  $('refresh').disabled = !!loadError;
  if (!loadError) {
    $('refresh').addEventListener('click', refresh);
    const cached = readCache();
    if (cached) {
      try { render(cached); } catch (e) { /* cache hỏng thì bỏ qua, refresh() sẽ vẽ lại */ }
    }
    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  }
})();
