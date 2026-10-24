// Góp/rút vốn từ dòng lệnh, dùng chung core.js với trang web nên ra đúng cùng kết quả.
//
//   git pull                                 luôn lấy sổ mới nhất trước
//   node tools/tx.js gop "Cam" 1000          xem trước, không ghi file
//   node tools/tx.js rut "Cam" 500 --write   tính rồi ghi đè calculated.js
//   node tools/tx.js rut "Cam" all --write   rút toàn bộ phần của Cam
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
const USAGE = 'cú pháp: node tools/tx.js gop|rut "<tên cổ đông>" <số tiền USDT | all> [--write] [--offline]';

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

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const offline = args.includes('--offline');
  const unknownFlags = args.filter((a) => a.startsWith('--') && !['--write', '--offline'].includes(a));
  const positional = args.filter((a) => !a.startsWith('--'));
  if (unknownFlags.length) fail(`không hiểu ${unknownFlags.join(' ')}. ${USAGE}`);
  // Thừa tham số thường là số tiền bị tách bởi dấu cách ("1 000"); dừng thay vì lấy mỗi phần đầu.
  if (positional.length !== 3) fail(`cần đúng 3 tham số, nhận ${positional.length}: ${JSON.stringify(positional)}. Tên có dấu cách thì đặt trong ngoặc kép. ${USAGE}`);
  const [kind, name, amountArg] = positional;
  if (!['gop', 'rut'].includes(kind)) fail(USAGE);

  const { blockers, warnings } = gitCheck();
  warnings.forEach((w) => console.warn(`Cảnh báo: ${w}`));
  blockers.forEach((w) => console.warn(`${write && !offline ? 'Chặn' : 'Cảnh báo'}: ${w}`));
  if (write && blockers.length && !offline) fail('không ghi vì chưa chắc sổ trên máy là mới nhất. Xử lý cảnh báo trên, hoặc thêm --offline nếu cố ý ghi mà không đối chiếu.');

  const S = loadState();
  const problems = F.validate(S);
  if (problems.length) fail(`calculated.js có vấn đề:\n  - ${problems.join('\n  - ')}`);

  const who = S.shareholders.findIndex((h) => h.name === name);
  if (who < 0) fail(`không có cổ đông tên "${name}". Danh sách: ${S.shareholders.map((h) => h.name).join(', ')}`);

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

  if (!write) {
    console.log('\nChỉ xem trước. Thêm --write để ghi đè calculated.js.');
    return;
  }
  writeLedger(S, next);
  console.log(`\nĐã ghi calculated.js (${next.history.length} giao dịch trong lịch sử), đọc lại khớp.`);
}

main().catch((e) => fail(e.message));
