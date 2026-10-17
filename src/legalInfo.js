// Seller details for the 特定商取引法に基づく表記 page. Fill every 【要入力】
// before the shop is made public (see LEGAL_READY below).
export const LEGAL = {
  seller: '【要入力】販売事業者名（屋号）',
  representative: '【要入力】運営責任者名',
  address: '【要入力】所在地',
  phone: '【要入力】電話番号',
  email: '【要入力】メールアドレス',
  shippingFee: '【要入力】送料（例：全国一律〇〇円／地域により異なります）。ご注文後に確認し、メールでご案内します。',
  returns: '【要入力】返品・交換の条件（例：商品の不良・誤配送は到着後〇日以内にご連絡ください。お客様都合の返品はお受けできません。）',
};
export const LEGAL_READY = !Object.values(LEGAL).some(v => v.includes('【要入力】'));
