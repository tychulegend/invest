---
name: cmd
description: Ghi một giao dịch góp/rút vốn vào sổ quỹ gia đình rồi commit và push lên main. Chỉ chạy khi người dùng gõ /cmd.
argument-hint: gop|rut <số tiền USDT|all> <tên cổ đông>
disable-model-invocation: true
---

# /cmd: ghi một giao dịch góp/rút

Lệnh người dùng gõ: `/cmd $ARGUMENTS`

Ví dụ: `/cmd gop 1000 cam`, `/cmd rut 500 ben tre`, `/cmd rut all toc vang hoe`.

Người dùng gõ `/cmd` **chính là sự đồng ý** cho giao dịch đó: không cần hỏi lại trước khi ghi, commit
và push lên `main`. Nhưng đây là tiền thật. Gặp bất kỳ điều gì dưới đây thì **dừng, không ghi, báo lại và hỏi**:
tham số không rõ, lệnh/test/git báo lỗi hay cảnh báo, số tiền lớn hơn toàn bộ quỹ, hoặc bất cứ điều gì bất thường.
Không bao giờ sửa `calculated.js` bằng tay, không thêm `--offline`, không bỏ qua test.

## 1. Đọc tham số

- Từ đầu tiên: `gop` hoặc `rut` (chấp nhận `góp`/`rút`). Khác thì dừng và hỏi.
- Từ thứ hai: số tiền **USDT**, hoặc `all` (chỉ với `rut`). Số chỉ gồm chữ số, tối đa 2 số lẻ.
  Nếu có dấu ngăn cách hàng nghìn (`1.000`, `1,000`), có chữ `k`/`tr`/`triệu`, hoặc ghi VNĐ: dừng và hỏi
  lại đúng số USDT, không tự quy đổi.
- Phần còn lại: tên cổ đông, gõ tắt không dấu cũng được (`cam`, `ben tre`). CLI tự tìm; tên mơ hồ thì CLI báo lỗi.

## 2. Đồng bộ và kiểm tra trước

Chạy lần lượt, dừng ngay nếu lệnh nào lỗi:

```bash
git status --short          # có thay đổi chưa commit ngoài ý muốn thì dừng và hỏi
git pull --ff-only origin main
npm test                    # phải qua hết
```

## 3. Ghi giao dịch

```bash
node tools/tx.js <gop|rut> "<tên>" <số tiền|all> --write
```

Không chạy bước xem trước riêng: `--write` tự lấy giá Binance ngay lúc chạy, in ra đầy đủ rồi mới ghi, và tự
từ chối nếu sổ trên máy cũ hơn GitHub. Dòng "Cảnh báo:" hay "Chặn:" nào xuất hiện thì coi như bất thường:
nếu file đã được ghi, khôi phục bằng `git checkout -- calculated.js`, rồi báo lại.

## 4. Kiểm tra sau

```bash
npm test
git diff --stat             # chỉ được đổi đúng calculated.js
```

## 5. Commit và push lên main

Người dùng đã cho phép push thẳng lên `main` cho lệnh này.

```bash
git add calculated.js
git commit -m "<Tên> góp <số tiền> USDT"      # hoặc "<Tên> rút <số tiền> USDT"
git push origin main
```

Thân commit ghi giá mỗi cổ phần, số cổ phần nhận/huỷ, tổng cổ phần trước → sau, rồi dòng attribution theo quy định.

## 6. Báo lại cho người dùng

Ngắn gọn, bằng tiếng Việt:
- Giao dịch đã ghi: ai, góp/rút bao nhiêu USDT, giá mỗi cổ phần lúc tính, số cổ phần nhận/huỷ.
- Với rút: **số USDT cần chuyển cho người đó**.
- Tiền mặt trước → sau, tổng cổ phần trước → sau.
- Bảng sở hữu sau giao dịch (tỷ lệ % từng người).
- Commit đã push; GitHub Actions sẽ chạy test rồi mới cập nhật trang.
