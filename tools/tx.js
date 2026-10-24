// Ghi giao dịch vào sổ từ dòng lệnh, dùng chung core.js với trang web nên ra đúng cùng kết quả.
//
// Lệnh tiếng Anh: deposit (góp), withdraw (rút), sell (bán), buy (mua), rebalance (cân bằng);
// tên tiếng Việt cũ gop/rut/ban/mua/canbang vẫn dùng được.
//
//   git pull                                          luôn lấy sổ mới nhất trước
//   node tools/tx.js deposit "Cam" 1000               góp vốn: xem trước, không ghi file
//   node tools/tx.js withdraw "Cam" 500 --write       rút vốn rồi ghi đè calculated.js
//   node tools/tx.js withdraw "Cam" all --write       rút toàn bộ phần của Cam
//   node tools/tx.js sell btc 0.01 806.50 --write     bán 0.01 BTC, thực nhận 806.50 USDT
//   node tools/tx.js buy btc 0.01 810 --write         mua 0.01 BTC, thực trả 810 USDT
//   node tools/tx.js sell btc 0.01                    chưa có số thực nhận: chỉ ước tính theo giá hiện tại
//   node tools/tx.js rebalance btc 40 gold 40 cash 20 khuyến nghị cân bằng danh mục, chỉ in không ghi
//
// Mua/bán không đổi cổ phần của ai, chỉ đổi số lượng tài sản và tiền mặt; số USDT phải là số thực
// nhận/thực trả trên sàn (đã trừ phí), không tự tính theo giá.
//
// --write chỉ chạy khi chắc sổ trên máy là mới nhất (git đã pull, không chậm hơn remote). Chưa có
// git/remote thì phải thêm --offline để xác nhận là cố ý ghi mà không đối chiếu được.
//
// Giá lấy trực tiếp từ Binance ngay lúc chạy; không lấy được giá thì dừng, không đoán.
const fs = require('node:fs');
const F = require('../core.js');
const { CALC_FILE, readPortfolio, loadState, git, isGitRepo } = require('./load.js');

const fail = (msg) => { console.error(`Lỗi: ${msg}`); process.exit(1); };
const pct = (n, d) => `${((n / d) * 100).toFixed(4)}%`;
const USAGE = [
  'cú pháp:',
  '  node tools/tx.js deposit|withdraw "<tên cổ đông>" <số tiền USDT | all> [--write] [--offline]',
  '  node tools/tx.js sell|buy <tài sản> <số lượng> [<số USDT thực nhận/thực trả>] [--write] [--offline]',
  '  node tools/tx.js rebalance <tài sản> <%> <tài sản> <%> …   (vd rebalance btc 40 gold 40 cash 20; chỉ in, không ghi)',
  '  (tên cũ gop/rut/ban/mua/canbang vẫn dùng được)',
].join('\n');

/**
 * Kiểm tra sổ trên máy có phải mới nhất không. Trả về { blockers, warnings }: blockers chặn --write
 * (tính trên sổ cũ sẽ làm mất giao dịch đã dán từ trang web), warnings chỉ để báo.
 */
function gitCheck() {
  if (!isGitRepo()) return { blockers: ['Thư mục chưa là git repo, không đối chiếu được với bản trên GitHub.'], warnings: [] };
  const blockers = [];
  const warnings = [];
  try {
    git('fetch', '--quiet');
    const behind = Number(git('rev-list', '--count', 'HEAD..@{u}'));
    if (behind > 0) blockers.push(`Nhánh đang sau remote ${behind} commit: chạy git pull trước, nếu không sẽ tính trên sổ cũ.`);
  } catch (e) {
    blockers.push('Không kiểm tra được remote (chưa có upstream, mất mạng, hoặc cần đăng nhập).');
  }
  try { if (git('status', '--porcelain', '--', 'calculated.js')) warnings.push('calculated.js đang có thay đổi chưa commit.'); } catch (e) { /* bỏ qua */ }
  return { blockers, warnings };
}

/**
 * Ghi calculated.js an toàn: kiểm tra nội dung mới ngay trong bộ nhớ, chắc rằng file trên đĩa vẫn
 * là bản đã đọc lúc đầu, ghi ra file tạm rồi mới thay file thật.
 */
function writeLedger(base, next) {
  const source = F.toSource(next);
  const reread = F.merge(readPortfolio(), F.evalCalculated(source));
  const problems = F.validate(reread);
  if (problems.length) fail(`nội dung mới không hợp lệ, không ghi:\n  - ${problems.join('\n  - ')}`);
  if (!F.sameLedger(reread, next)) fail('nội dung mới đọc lại không khớp state vừa tính, không ghi.');
  // Trong lúc chờ Binance, file có thể đã bị đổi (dán từ trang, lần chạy khác); ghi đè sẽ làm mất giao dịch đó.
  if (!F.sameLedger(loadState(), base)) fail('calculated.js đã thay đổi trong lúc đang tính, không ghi. Chạy lại lệnh.');
  const tmp = `${CALC_FILE}.tmp`;
  fs.writeFileSync(tmp, source);
  fs.renameSync(tmp, CALC_FILE);
  if (!F.sameLedger(loadState(), next)) fail('calculated.js sau khi ghi không khớp, kiểm tra lại file ngay.');
}

function loadValid() {
  const S = loadState();
  const problems = F.validate(S);
  if (problems.length) fail(`calculated.js có vấn đề:\n  - ${problems.join('\n  - ')}`);
  return S;
}

/** Góp/rút vốn. */
async function runShareTx(kind, [name, amountArg]) {
  const S = loadValid();
  // Nhận tên gõ tắt không dấu (cam, ben tre); mơ hồ thì dừng, không đoán.
  const found = F.findHolder(S, name);
  if (found.error) fail(found.error);
  const who = found.index;

  const all = amountArg === 'all';
  if (all && kind !== 'rut') fail('"all" chỉ dùng cho rút.');
  let cents;
  if (!all) {
    const parsed = F.parseAmount(amountArg);
    if (parsed.error) fail(parsed.error);
    cents = parsed.cents;
  }

  const { prices, host } = await F.fetchPrices(F.pairsOf(S), { fetchImpl: fetch });
  const r = F.prepareTx(S, prices, { kind, who, cents, all }, F.todayISO());
  if (r.error) fail(r.error);
  const { valuation: v, plan, next } = r;

  console.log(`Giá lấy từ ${host || '(không cần)'} lúc ${new Date().toLocaleString('vi-VN')}`);
  v.rows.forEach((row) => console.log(`  ${row.name}: ${row.amount} ${row.unit} × ${row.unitPrice} = ${row.value.toFixed(2)} USDT`));
  console.log(`  Tổng tài sản ${v.nav.toFixed(2)} USDT / ${S.totalShares} cổ phần = ${v.price} USDT mỗi cổ phần\n`);
  console.log(kind === 'gop'
    ? `${plan.name} góp ${plan.amount} USDT, nhận ${plan.delta} cổ phần mới.`
    : `${plan.name} rút ${plan.amount} USDT, huỷ ${plan.delta} cổ phần. Cần chuyển ${plan.amount} USDT cho ${plan.name}.`);
  if (kind === 'gop' && plan.amount > v.nav) console.warn(`Cảnh báo: số tiền lớn hơn toàn bộ quỹ (${v.nav.toFixed(2)} USDT). Số tiền tính bằng USDT, không phải VNĐ.`);
  console.log(`Tiền mặt ${plan.cashBefore} -> ${plan.cashAfter}; tổng cổ phần ${plan.totalBefore} -> ${plan.totalAfter}\n`);
  console.table(S.shareholders.map((h, i) => ({
    'Cổ đông': h.name,
    'Cổ phần trước': plan.sharesBefore[i],
    'Cổ phần sau': plan.sharesAfter[i],
    'Sở hữu trước': pct(plan.sharesBefore[i], plan.totalBefore),
    'Sở hữu sau': pct(plan.sharesAfter[i], plan.totalAfter),
  })));
  return { S, next };
}

/** Mua/bán tài sản bằng tiền mặt. */
async function runTrade(side, [assetArg, qtyArg, usdtArg], write) {
  const S = loadValid();
  // Nhận id, ticker hoặc tên có dấu/không dấu (btc, vàng, xaut); mơ hồ thì dừng, không đoán.
  const foundAsset = F.findAsset(S, assetArg);
  if (foundAsset.error) fail(foundAsset.error);
  const asset = S.assets.find((a) => a.id === foundAsset.id);
  const qty = F.parseQty(qtyArg);
  if (qty.error) fail(qty.error);

  const { prices, host } = await F.fetchPrices(F.pairsOf(S), { fetchImpl: fetch });
  const row = F.valuation(S, prices).rows.find((r) => r.id === asset.id);
  const estimate = (qty.units / 1e8) * row.unitPrice;
  console.log(`Giá ${asset.name} lúc này (${host || 'giá cố định'}): ${row.unitPrice} USDT/${asset.unit}`);
  console.log(`Ước tính ${side === 'ban' ? 'thu về' : 'phải trả'} theo giá này, chưa trừ phí: ${estimate.toFixed(2)} USDT`);

  if (usdtArg === undefined) {
    if (write) fail(`thiếu số USDT ${side === 'ban' ? 'thực nhận' : 'thực trả'} trên sàn (đã trừ phí). Không ghi theo ước tính.`);
    console.log('\nChưa có số USDT thực tế nên chỉ ước tính, không ghi gì.');
    return null;
  }
  const money = F.parseAmount(usdtArg);
  if (money.error) fail(money.error);
  // Lệch xa giá thị trường thường là gõ nhầm (thiếu số 0, nhầm VNĐ); dừng để người dùng kiểm tra.
  const ratio = money.cents / 100 / estimate;
  if (!(ratio > 0.9 && ratio < 1.1)) fail(`số USDT ${money.cents / 100} lệch ${((ratio - 1) * 100).toFixed(1)}% so với ước tính ${estimate.toFixed(2)}. Kiểm tra lại số lượng/số tiền (USDT, không phải VNĐ).`);

  const r = F.prepareTrade(S, { side, assetId: asset.id, qtyUnits: qty.units, cents: money.cents }, F.todayISO());
  if (r.error) fail(r.error);
  const { plan } = r;
  console.log(`\n${side === 'ban' ? 'Bán' : 'Mua'} ${plan.qty} ${plan.unit} ${plan.assetName}, ${side === 'ban' ? 'thực nhận' : 'thực trả'} ${plan.usdt} USDT.`);
  console.log(`${plan.assetName}: ${plan.assetBefore} -> ${plan.assetAfter} ${plan.unit}`);
  console.log(`Tiền mặt: ${plan.cashBefore} -> ${plan.cashAfter} USDT`);
  console.log('Cổ phần của mọi người không đổi.');
  return { S, next: r.next };
}

/** Khuyến nghị cân bằng danh mục về tỷ trọng gõ trong lệnh (vd btc 40 vàng 40 cash 20). Chỉ in, không ghi gì. */
async function runRebalance(tokens) {
  const offline = tokens.includes('--offline');
  const flags = tokens.filter((t) => t.startsWith('--') && t !== '--offline');
  if (flags.length) fail(`rebalance chỉ in khuyến nghị, không nhận ${flags.join(' ')}.\n${USAGE}`);
  const S = loadValid();
  // Đọc tỷ trọng trước: gõ sai thì báo ngay, không phải chờ git fetch.
  const parsed = F.parseTargets(S, tokens.filter((t) => !t.startsWith('--')));
  if (parsed.error) fail(`${parsed.error}\nVí dụ: node tools/tx.js rebalance btc 40 gold 40 cash 20`);
  // Khuyến nghị dựa trên số lượng trong sổ; sổ cũ hơn GitHub thì số mua/bán sai và người dùng có thể đặt
  // lệnh thật theo đó, nên chặn hẳn thay vì chỉ cảnh báo (trừ khi cố ý thêm --offline).
  // Lấy giá song song với git fetch để khỏi chờ nối tiếp hai lần mạng.
  const pricesP = F.fetchPrices(F.pairsOf(S), { fetchImpl: fetch });
  pricesP.catch(() => {});
  const { blockers, warnings } = gitCheck();
  // calculated.js có thay đổi chưa commit (ghi dở, dữ liệu thử) thì số liệu chưa phải sổ đã công bố.
  const stale = [...blockers, ...warnings];
  if (stale.length && !offline) fail(`${stale.join(' ')} Xử lý rồi thử lại, hoặc thêm --offline nếu chắc sổ trên máy là đúng.`);
  stale.forEach((w) => console.warn(`Cảnh báo: ${w}`));
  const { prices, host } = await pricesP;
  const v = F.valuation(S, prices);
  const r = F.rebalancePlan(S, v, parsed.targets, { bandPct: S.rebalanceBandPct, minTradeUsdt: S.rebalanceMinUsdt });
  if (r.error) fail(r.error);
  const usd = (n) => n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // In số lượng đủ 8 số lẻ, không ra dạng 4e-7, và đúng con số đã dùng để tính tiền.
  const qty = (n) => n.toFixed(8).replace(/\.?0+$/, '');
  console.log(`Giá lấy từ ${host || '(không cần)'} lúc ${new Date().toLocaleString('vi-VN')}. Tổng tài sản ${usd(r.nav)} USDT.`);
  console.log(`Lệch dưới ${r.bandPct} điểm % so với mục tiêu, hoặc khoản dưới ${r.minTradeUsdt} USDT, thì giữ nguyên.\n`);
  for (const row of r.rows) {
    const now = `đang ${row.currentPct.toFixed(2)}%, mục tiêu ${row.targetPct}%`;
    if (row.isCash) console.log(`${row.id} giữ ${usd(r.cashAfter)} USDT  (${now}; hiện có ${usd(row.currentValue)}, mục tiêu ${usd(r.cashTarget)})`);
    else if (row.action === 'giu') console.log(`${row.id} giữ  (${now})`);
    else console.log(`${row.id} ${row.action === 'ban' ? 'bán' : 'mua'} ${qty(row.qty)} ${row.unit} ≈ ${usd(row.usdt)} USDT  (${now})`);
  }
  if (r.limited) console.warn(`\nCảnh báo: không đủ tiền mặt cho mọi khoản mua (có tài sản được giữ nguyên), nên các khoản mua đã thu nhỏ còn ${(r.buyScale * 100).toFixed(1)}%.`);
  console.log('\nĐây chỉ là khuyến nghị theo giá hiện tại, chưa trừ phí; không ghi gì vào sổ.');
  console.log('Mua/bán thật xong thì ghi lại bằng: node tools/tx.js sell|buy <tài sản> <số lượng> <số USDT thực tế> --write');
}

// Lệnh tiếng Anh (chính) và tên tiếng Việt cũ cùng dẫn tới một việc.
// Dùng Map để chữ như "constructor" không trúng thuộc tính có sẵn của object.
const COMMANDS = new Map(Object.entries({
  deposit: 'gop', add: 'gop', gop: 'gop',
  withdraw: 'rut', rut: 'rut',
  sell: 'ban', ban: 'ban',
  buy: 'mua', mua: 'mua',
  rebalance: 'canbang', canbang: 'canbang',
}));

async function main() {
  const args = process.argv.slice(2);
  // Lệnh là tham số đầu tiên không phải cờ, để "--write deposit …" vẫn chạy như trước.
  const cmdIndex = args.findIndex((a) => !a.startsWith('--'));
  const command = COMMANDS.get(String(args[cmdIndex] || '').toLowerCase());
  if (command === 'canbang') return runRebalance(args.filter((_, i) => i !== cmdIndex));
  const write = args.includes('--write');
  const offline = args.includes('--offline');
  const unknownFlags = args.filter((a) => a.startsWith('--') && !['--write', '--offline'].includes(a));
  const positional = args.filter((a) => !a.startsWith('--'));
  if (unknownFlags.length) fail(`không hiểu ${unknownFlags.join(' ')}.\n${USAGE}`);
  const [, ...rest] = positional;
  const kind = command;
  const isShare = kind === 'gop' || kind === 'rut';
  const isTrade = kind === 'ban' || kind === 'mua';
  if (!isShare && !isTrade) fail(USAGE);
  // Thừa tham số thường là số bị tách bởi dấu cách ("1 000"); dừng thay vì lấy mỗi phần đầu.
  if (isShare && rest.length !== 2) fail(`deposit/withdraw cần đúng 2 tham số sau, nhận ${rest.length}: ${JSON.stringify(rest)}. Tên có dấu cách thì đặt trong ngoặc kép.\n${USAGE}`);
  if (isTrade && (rest.length < 2 || rest.length > 3)) fail(`sell/buy cần <tài sản> <số lượng> [<số USDT>], nhận ${JSON.stringify(rest)}.\n${USAGE}`);

  const { blockers, warnings } = gitCheck();
  warnings.forEach((w) => console.warn(`Cảnh báo: ${w}`));
  blockers.forEach((w) => console.warn(`${write && !offline ? 'Chặn' : 'Cảnh báo'}: ${w}`));
  if (write && blockers.length && !offline) fail('không ghi vì chưa chắc sổ trên máy là mới nhất. Xử lý cảnh báo trên, hoặc thêm --offline nếu cố ý ghi mà không đối chiếu.');

  const result = isShare ? await runShareTx(kind, rest) : await runTrade(kind, rest, write);
  if (!result) return;
  if (!write) {
    console.log('\nChỉ xem trước. Thêm --write để ghi đè calculated.js.');
    return;
  }
  writeLedger(result.S, result.next);
  console.log('\nĐã ghi calculated.js, đọc lại khớp.');
}

main().catch((e) => fail(e.message));
