---
name: cmd
description: Ghi giao dịch vào sổ quỹ gia đình (góp/rút vốn, mua/bán tài sản) rồi commit và push lên main, hoặc in khuyến nghị cân bằng danh mục. Chỉ chạy khi người dùng gõ /cmd.
argument-hint: deposit|withdraw <USDT|all> <tên> · sell|buy <số lượng> <tài sản> <USDT thực tế> · rebalance btc 40 gold 40 cash 20
disable-model-invocation: true
---

# /cmd: lệnh tắt cho sổ quỹ

Lệnh người dùng gõ: `/cmd $ARGUMENTS`

| Người dùng gõ | Ý nghĩa | Lệnh chạy |
|---|---|---|
| `/cmd deposit 1000 cam` | Cam góp 1.000 USDT | `node tools/tx.js deposit "cam" 1000 --write` |
| `/cmd withdraw 500 cam`, `/cmd withdraw all cam` | Cam rút 500 USDT / rút hết | `node tools/tx.js withdraw "cam" 500 --write` |
| `/cmd sell 0.01 btc 806.50` | Bán 0.01 BTC, thực nhận 806.50 USDT | `node tools/tx.js sell btc 0.01 806.50 --write` |
| `/cmd buy 0.5 gold 2000` | Mua 0.5 oz vàng, thực trả 2.000 USDT | `node tools/tx.js buy gold 0.5 2000 --write` |
| `/cmd rebalance btc 40 gold 40 cash 20` | Khuyến nghị mua/bán để về tỷ trọng 40/40/20 | `node tools/tx.js rebalance btc 40 gold 40 cash 20` (chỉ in, không ghi) |

Người dùng không giỏi tiếng Anh, nên chấp nhận đúng các tên sau, và chỉ các tên này:
`deposit`/`add`/`gop`/`góp`, `withdraw`/`rut`/`rút`, `sell`/`ban`/`bán`, `buy`/`mua`, `rebalance`/`canbang`/`cân bằng`.
Gõ sai chính tả (vd `widthdraw`, `depost`) với lệnh **có ghi sổ** (deposit/withdraw/sell/buy): **không đoán**, hỏi
lại "ý mày là withdraw (rút) phải không?" và chờ trả lời. Chỉ với `rebalance` (không ghi gì) mới được hiểu lỗi chính tả
rõ ràng như `rebalace`. Tài sản gõ theo id, ticker hoặc tên (`btc`, `gold`/`vàng`/`xaut`,
`cash`/`tiền mặt`); CLI tự tìm, mơ hồ thì báo lỗi.

Với deposit/withdraw/sell/buy: người dùng gõ `/cmd` **chính là sự đồng ý**: ghi, commit và push lên `main`
không hỏi lại. Nhưng đây là tiền thật. Gặp bất kỳ điều gì dưới đây thì **dừng, không ghi, báo lại và hỏi**:
tham số không rõ, lệnh/test/git báo lỗi hay "Cảnh báo:"/"Chặn:", số tiền lớn hơn toàn bộ quỹ, hoặc bất cứ điều gì
bất thường. Không bao giờ sửa `calculated.js` bằng tay, không thêm `--offline`, không bỏ qua test.

## Đọc tham số

- Số tiền là **USDT**, chỉ gồm chữ số, tối đa 2 số lẻ. Số lượng tài sản tối đa 8 số lẻ. Có dấu ngăn cách
  hàng nghìn (`1.000`, `1,000`), chữ `k`/`tr`/`triệu`, hoặc ghi VNĐ: dừng và hỏi lại, không tự quy đổi.
- deposit/withdraw: tên cổ đông gõ tắt không dấu cũng được (`cam`, `ben tre`). Tên mơ hồ thì CLI báo lỗi.
- **sell/buy phải có số USDT thực nhận/thực trả trên sàn** (đã trừ phí). Thiếu thì chạy lệnh **không** có
  `--write` để xem ước tính theo giá hiện tại, báo người dùng, rồi hỏi số thực tế. Không bao giờ ghi theo ước tính.

## Ghi giao dịch (deposit, withdraw, sell, buy)

1. Đồng bộ và kiểm tra trước, dừng ngay nếu lệnh nào lỗi:
   ```bash
   git status --short          # có thay đổi chưa commit ngoài ý muốn thì dừng và hỏi
   git pull --ff-only origin main
   npm test                    # phải qua hết
   ```
2. Chạy lệnh tương ứng ở bảng trên (có `--write`). Lệnh tự lấy giá Binance, in đầy đủ rồi mới ghi, tự từ
   chối nếu sổ trên máy cũ hơn GitHub, và từ chối số USDT lệch quá 10% so với giá thị trường (thường là gõ nhầm).
   Nếu file đã bị ghi mà có điều bất thường: `git checkout -- calculated.js` rồi báo lại.
3. Kiểm tra sau:
   ```bash
   npm test
   git diff --stat             # chỉ được đổi đúng calculated.js
   ```
4. Commit và push lên `main` (người dùng đã cho phép), rồi chờ deploy:
   ```bash
   git add calculated.js
   git commit -m "<mô tả>"     # vd "Cam deposit 1000 USDT", "Sell 0.01 BTC for 806.50 USDT"
   git push origin main
   gh run watch <id> -R tychulegend/invest --exit-status
   ```
   Thân commit ghi các con số chính, rồi dòng attribution theo quy định.
5. Báo lại ngắn gọn, bằng tiếng Việt:
   - Góp/rút: ai, bao nhiêu USDT, giá mỗi cổ phần lúc tính, số cổ phần nhận/huỷ, tiền mặt và tổng cổ phần
     trước → sau, bảng tỷ lệ sở hữu. Với rút: **số USDT cần chuyển cho người đó**.
   - Mua/bán: số lượng tài sản và tiền mặt trước → sau; cổ phần mọi người không đổi.
   - Đã push và deploy xong (hoặc lỗi ở đâu).

## Cân bằng danh mục (rebalance)

1. `git pull --ff-only origin main`, rồi chạy `node tools/tx.js rebalance <tài sản> <%> …` với đúng tỷ trọng
   người dùng gõ, thứ tự tuỳ ý (vd `/cmd rebalance gold 45 btc 45 cash 10` thì chạy
   `node tools/tx.js rebalance gold 45 btc 45 cash 10`). Lệnh này **chỉ in khuyến nghị, không ghi gì**, nên không
   commit, không push. Lệnh tự chặn nếu sổ trên máy cũ hơn GitHub.
2. Phải nêu đủ mọi tài sản và tổng đúng 100%. Thiếu, thừa hay tên lạ thì CLI báo lỗi: chuyển lời báo lỗi cho
   người dùng và hỏi lại, không tự điền phần thiếu.
3. Báo lại đúng dạng người dùng muốn, mỗi tài sản một dòng (gold ghi là "vàng"):
   ```
   btc bán 0.67583773 BTC ≈ 54.488,11 USDT
   vàng mua 9.09365166 oz ≈ 36.325,41 USDT
   cash giữ 18.162,70 USDT
   ```
   **Chép nguyên văn số lượng và số tiền CLI in ra**, không làm tròn lại (làm tròn lên có thể thành bán quá mức
   hoặc mua vượt tiền mặt). Kèm tỷ trọng hiện tại → mục tiêu. **Luôn chuyển nguyên văn mọi dòng "Cảnh báo:"** (vd khoản mua đã bị thu nhỏ
   vì không đủ tiền mặt), và nhắc: đây là theo giá lúc này, chưa trừ phí. Mua/bán thật xong thì ghi lại bằng
   `/cmd sell …` / `/cmd buy …` với số USDT thực tế.
