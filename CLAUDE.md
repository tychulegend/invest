# Sổ cổ phần gia đình

Trang tĩnh (HTML/CSS/JS thuần, không build) đăng lên GitHub Pages. Liệt kê danh mục đầu tư của gia đình
như một công ty cổ phần, định giá theo giá Binance, và tính góp/rút vốn.

**Đây là tiền thật của gia đình. Mọi thay đổi số liệu phải đi qua `core.js` và phải chạy test.**

## File

| File | Vai trò |
|---|---|
| `core.js` | Toàn bộ phần tính tiền, thuần logic, dùng chung cho trang và CLI (`prepareTx`, `validate`, …). |
| `app.js` | Giao diện, chỉ gọi `FundCore`; không tự tính tiền (ngoại lệ duy nhất: nhân `vndRate` để hiển thị VNĐ). |
| `portfolio.js` | Cấu hình ít đổi: tài sản, cặp giá Binance (phải là cặp USDT), đơn vị, `initialShares`, `contributionAsset`, `vndRate`. |
| `calculated.js` | Số liệu thay đổi: `totalShares`, `amounts`, `units`, `shareholders`, `history`. |
| `tools/test.js` | Test bất biến về tiền và kiểm tra chính sổ thật. `npm test` (`node:test`, không cần cài gì). |
| `tools/tx.js` | Góp/rút từ dòng lệnh với giá Binance live. |
| `.github/workflows/pages.yml` | Mỗi lần push: chạy `npm test` (kèm kiểm tra lịch sử chỉ nối thêm so với trước lần push), qua mới deploy Pages. |

## Mô hình (quỹ mở)

- Góp: mua cổ phần mới theo giá lúc tính, `totalShares` tăng. Rút: bán lại cho quỹ, cổ phần bị huỷ.
- Giá mỗi cổ phần = tổng tài sản / `totalShares`, không đổi vì góp/rút, chỉ đổi khi tài sản lời/lỗ.
- Tiền tính bằng cents nguyên; cổ phần là số nguyên.
- Làm tròn luôn có lợi cho quỹ: góp làm tròn **xuống** số cổ phần nhận, rút làm tròn **lên** số cổ phần huỷ,
  rút toàn bộ làm tròn **xuống** số tiền trả. Đừng đổi sang `Math.round`, test sẽ bắt. (Có sai số cho phép
  1e-9 để khử nhiễu số thực; ảnh hưởng dưới 1e-9 USDT.)
- Tiền góp/rút cộng trừ thẳng vào `contributionAsset` (mặc định `cash`), tài sản này phải có `price: 1`, không `pair`.
- `validate()` tự kiểm tra: cổ phần từng người = `initialShares` cộng trừ `history`, mỗi dòng lịch sử tính
  lại ra đúng số cổ phần, `units` khớp `portfolio.js`. Sai là trang khoá góp/rút và CLI dừng.

## Lệnh tắt `/cmd`

`/cmd gop 1000 cam`, `/cmd rut 500 cam`, `/cmd rut all cam`: skill ở `.claude/skills/cmd/SKILL.md`. Lệnh do
người dùng gõ là sự đồng ý: ghi, commit và push thẳng lên `main` không hỏi lại, nhưng dừng và hỏi khi có bất
thường (xem skill).

## Khi được nhờ ghi một giao dịch góp/rút (không qua `/cmd`)

1. `git pull` (sổ mới nhất có thể vừa được dán từ trang web), rồi `npm test`, phải qua hết.
2. Xem trước: `node tools/tx.js gop "<tên>" <số tiền>` (hoặc `rut ... <số tiền|all>`). Tên phải khớp đúng
   `shareholders`. Số tiền tính bằng **USDT**, chỉ gồm chữ số, tối đa 2 số lẻ, **không** có dấu ngăn cách hàng nghìn.
3. Báo lại cho người dùng giá lúc tính, số cổ phần, tiền mặt trước/sau, bảng sở hữu trước/sau. Chờ đồng ý.
4. Chạy lại với `--write`. Giá đã đổi so với lúc xem trước nên số có thể lệch nhẹ; báo con số thực tế đã ghi.
5. `npm test` lại, rồi mới commit/push (theo quy tắc chung: tạo nhánh nếu đang ở nhánh mặc định).
   CI chạy lại test trên GitHub; đỏ thì không deploy.
6. Rút mà tiền mặt không đủ: không tự bán tài sản. Hỏi người dùng đã bán gì, được bao nhiêu, sửa `amounts`, rồi mới rút.

Mỗi lần chỉ một giao dịch; không bao giờ tính giao dịch thứ hai trên `calculated.js` cũ. Không bao giờ để dữ liệu
test nằm lại trong `calculated.js`.

## Sửa tay `calculated.js`

Được phép khi đổi tài sản (vd tiền mặt sang BTC): chỉ sửa giá trị trong `amounts`, số thực không để trong dấu nháy,
dùng dấu chấm cho số lẻ, tiền mặt tối đa 2 số lẻ. Không đụng `shares`/`totalShares`/`history`. Đổi `unit` trong
`portfolio.js` thì phải quy đổi `amounts` và sửa `units` tương ứng.

## Lưu ý

- Nên để một người (Legend) làm mọi giao dịch: trang chặn được hầu hết trường hợp ghi đè, nhưng hai máy cùng làm
  trong lúc GitHub Pages đang cập nhật (khoảng 1 phút) chỉ bị CI chặn lúc deploy, không chặn được trên trang.
- Trang GitHub Pages là công khai: ai có link cũng thấy tài sản và tỷ lệ từng người.
- Vàng định giá theo XAUT (giá thế giới), chưa gồm chênh lệch SJC.
- Script được nạp kèm `?v=timestamp` để không dính cache GitHub Pages; đừng bỏ.
