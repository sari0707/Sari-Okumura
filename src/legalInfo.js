// Seller details for the 特定商取引法に基づく表記 page. Fill every 【要入力】
// before the shop is made public (see LEGAL_READY below).
export const LEGAL = {
  seller: 'よもぎの環',
  representative: '奥村沙李',
  address: '大阪府大阪市住吉区苅田3-11-2',
  phone: 'ご請求があった場合、遅滞なく開示します。メールでお問い合わせください。',
  email: 'honeybagle1583@gmail.com',
  shippingFee: '全国一律800円（税込）',
  returns: '商品の不良・誤配送は、商品到着後7日以内にメールでご連絡ください。お客様都合による返品・交換はお受けできません。',
};
export const LEGAL_READY = !Object.values(LEGAL).some(v => v.includes('【要入力】'));
