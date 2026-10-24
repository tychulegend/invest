---
name: cmd
description: Ghi giao dịch vào sổ quỹ gia đình (góp/rút vốn, mua/bán tài sản) rồi commit và push lên main, hoặc in khuyến nghị cân bằng danh mục. Chỉ chạy khi người dùng gõ /cmd.
argument-hint: gop|rut <USDT|all> <tên> · ban|mua <số lượng> <tài sản> <USDT thực tế> · cân bằng danh mục
disable-model-invocation: true
---

# /cmd: lệnh tắt cho sổ quỹ

Lệnh người dùng gõ: `/cmd $ARGUMENTS`

| Người dùng gõ | Ý nghĩa | Lệnh chạy |
|---|---|---|
| `/cmd gop 1000 cam` | Cam góp 1.000 USDT | `node tools/tx.js gop "cam" 1000 --write` |
| `/cmd rut 500 cam`, `/cmd rut all cam` | Cam rút 500 USDT / rút hết | `node tools/tx.js rut "cam" 500 --write` |
| `/cmd ban 0.01 btc 806.50` | Bán 0.01 BTC, thực nhận 806.50 USDT | `node tools/tx.js ban btc 0.01 806.50 --write` |
| `/cmd mua 0.5 gold 2000` | Mua 0.5 oz vàng, thực trả 2.000 USDT | `node tools/tx.js mua gold 0.5 2000 --write` |
| `/cmd cân bằng danh mục` | Khuyến nghị mua/bán để về tỷ trọng mục tiêu | `node tools/tx.js canbang` (chỉ in, không ghi) |

Chấp nhận cả có dấu và không dấu: `góp`/`gop`, `rút`/`rut`, `bán`/`ban`, `mua`, `cân bằng`/`can bang`.
Tài sản: `btc`, `gold` (cũng hiểu `vàng`/`vang` là `gold`), theo id trong `portfolio.js`.

Với góp/rút/mua/bán: người dùng gõ `/cmd` **chính là sự đồng ý**: ghi, commit và push lên `main` không hỏi lại.
Nhưng đây là tiền thật. Gặp bất kỳ điều gì dưới đây thì **dừng, không ghi, báo lại và hỏi**: tham số không rõ,
lệnh/test/git báo lỗi hay "Cảnh báo:"/"Chặn:", số tiền lớn hơn toàn bộ quỹ, hoặc bất cứ điều gì bất thường.
Không bao giờ sửa `calculated.js` bằng tay, không thêm `--offline`, không bỏ qua test.

## Đọc tham số

- Số tiền là **USDT**, chỉ gồm chữ số, tối đa 2 số lẻ. Số lượng tài sản tối đa 8 số lẻ. Có dấu ngăn cách
  hàng nghìn (`1.000`, `1,000`), chữ `k`/`tr`/`triệu`, hoặc ghi VNĐ: dừng và hỏi lại, không tự quy đổi.
- Góp/rút: tên cổ đông gõ tắt không dấu cũng được (`cam`, `ben tre`). Tên mơ hồ thì CLI báo lỗi.
- **Mua/bán phải có số USDT thực nhận/thực trả trên sàn** (đã trừ phí). Thiếu thì chạy lệnh **không** có
  `--write` để xem ước tính theo giá hiện tại, báo người dùng, rồi hỏi số thực tế. Không bao giờ ghi theo ước tính.

## Ghi giao dịch (góp, rút, mua, bán)

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
   git commit -m "<mô tả>"     # vd "Cam góp 1000 USDT", "Bán 0.01 BTC lấy 806.50 USDT"
   git push origin main
   gh run watch <id> -R tychulegend/invest --exit-status
   ```
   Thân commit ghi các con số chính, rồi dòng attribution theo quy định.
5. Báo lại ngắn gọn, bằng tiếng Việt:
   - Góp/rút: ai, bao nhiêu USDT, giá mỗi cổ phần lúc tính, số cổ phần nhận/huỷ, tiền mặt và tổng cổ phần
     trước → sau, bảng tỷ lệ sở hữu. Với rút: **số USDT cần chuyển cho người đó**.
   - Mua/bán: số lượng tài sản và tiền mặt trước → sau; cổ phần mọi người không đổi.
   - Đã push và deploy xong (hoặc lỗi ở đâu).

## Cân bằng danh mục

1. `git pull --ff-only origin main`, rồi `node tools/tx.js canbang`. Lệnh này **chỉ in khuyến nghị, không ghi
   gì**, nên không commit.
2. Nếu báo thiếu `targetWeights`: hỏi người dùng tỷ trọng mục tiêu (%) cho từng tài sản, tổng 100%, rồi
   thêm vào `portfolio.js` (vd `targetWeights: { btc: 70, gold: 20, cash: 10 }`), chạy `npm test`, commit, push.
3. Báo lại đúng dạng người dùng muốn, mỗi tài sản một dòng:
   ```
   btc bán 0.33791887 BTC ≈ 27.033,51 USDT
   vàng mua 4.505585 oz ≈ 18.022,34 USDT
   cash giữ 9.011,17 USDT
   ```
   kèm tỷ trọng hiện tại → mục tiêu, và nhắc: đây là theo giá lúc này, chưa trừ phí. Mua/bán thật xong thì
   ghi lại bằng `/cmd ban …` / `/cmd mua …` với số USDT thực tế.
