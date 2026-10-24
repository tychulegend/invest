// Cấu hình quỹ: ít khi phải sửa.
// Số lượng tài sản, tổng cổ phần và cổ phần từng người nằm ở calculated.js.
window.PORTFOLIO = {
  name: 'Quỹ Đầu tư Gia đình',

  // Mốc ban đầu của quỹ, trước mọi giao dịch góp/rút. Cổ phần từng người luôn phải bằng mốc này
  // cộng trừ lịch sử trong calculated.js; không sửa khi đã có giao dịch.
  initialShares: { Legend: 1000000 },

  // Tài sản nhận tiền khi có người góp vốn.
  contributionAsset: 'cash',

  // Tỷ giá quy đổi khi xem bằng VNĐ (1 USDT = ? VNĐ). Chỉ để hiển thị; sổ sách, góp/rút
  // vẫn tính bằng USDT. Sửa theo giá thực tế mua bán USDT. Viết liền 26000, không viết
  // 26.000 (trong JavaScript 26.000 nghĩa là 26).
  vndRate: 26000,

  assets: [
    {
      id: 'btc',
      name: 'Bitcoin',
      ticker: 'BTC',
      unit: 'BTC',
      pair: 'BTCUSDT',
    },
    {
      id: 'gold',
      name: 'Vàng',
      ticker: 'XAUT',
      // 'oz' (ounce), 'luong' (1 lượng = 37,5 g), 'chi' (0,1 lượng) hoặc 'gram'.
      // Giá lấy theo XAUT (1 XAUT = 1 troy ounce), tức giá vàng thế giới, chưa gồm chênh lệch SJC.
      unit: 'oz',
      pair: 'XAUTUSDT',
    },
    {
      id: 'cash',
      name: 'Tiền mặt',
      ticker: 'USDT',
      unit: 'USDT',
      price: 1,
    },
  ],
};
