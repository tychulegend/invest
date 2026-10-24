// Số liệu thay đổi theo thời gian của quỹ.
// Mục "Góp vốn" / "Rút vốn" trên trang xuất ra nguyên file này: sao chép rồi dán đè toàn bộ.
// Sửa tay được (vd đổi tiền mặt sang BTC) nhưng chỉ sửa giá trị, không thêm trường mới
// (trường lạ sẽ bị bỏ ở lần xuất sau); tổng shares phải đúng bằng totalShares.
window.CALCULATED = {
  updatedAt: "2026-10-24",

  // Tổng số cổ phần đang lưu hành; tăng khi có người góp, giảm khi có người rút.
  totalShares: 1000000,

  // Số lượng từng tài sản, theo id và đơn vị khai báo trong portfolio.js.
  amounts: {
    "btc": 1.12639625,
    "gold": 0,
    "cash": 0,
  },

  // Đơn vị đã dùng cho số lượng ở trên; phải khớp unit trong portfolio.js.
  units: {
    "btc": "BTC",
    "gold": "oz",
    "cash": "USDT",
  },

  shareholders: [
    { name: "Legend", shares: 1000000 },
    { name: "Cam", shares: 0 },
    { name: "Bến Tre", shares: 0 },
    { name: "Tóc Vàng Hoe", shares: 0 },
  ],

  // Lịch sử góp ('gop') và rút ('rut') vốn, để cả nhà đối chiếu.
  history: [

  ],

  // Lịch sử mua ('mua') / bán ('ban') tài sản bằng tiền mặt; không đổi cổ phần của ai.
  trades: [

  ],
};
