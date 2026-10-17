import React from 'react';
import {LEGAL} from './legalInfo.js';
import {BANK_DEADLINE_DAYS,SHIP_DAYS} from './customerOrders.js';
const rows=[
 ['販売事業者',LEGAL.seller],
 ['運営責任者',LEGAL.representative],
 ['所在地',LEGAL.address],
 ['電話番号',LEGAL.phone],
 ['メールアドレス',LEGAL.email],
 ['販売価格','各商品の表示価格（税込）です。'],
 ['商品代金以外の必要料金',`送料：${LEGAL.shippingFee}\n銀行振込の振込手数料はお客様のご負担となります。`],
 ['お支払い方法','クレジットカード（Squareの決済リンクをメールでご案内）／銀行振込'],
 ['お支払い時期',`クレジットカード：ご案内メールの決済リンクからお支払いください。\n銀行振込：ご注文日から${BANK_DEADLINE_DAYS}日以内にお振込みください。`],
 ['商品の引渡し時期',`ご入金（お支払い）確認後、${SHIP_DAYS}日以内に発送します。`],
 ['返品・交換',LEGAL.returns],
 ['ご注文のキャンセル','お支払い前であれば、メールでご連絡ください。お支払い後のキャンセルは、返金対応について個別にご案内します。'],
];
export default function LegalNotice(){
 return <><h1>特定商取引法に基づく表記</h1><dl className="retailLegal">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd style={{whiteSpace:'pre-line'}}>{v}</dd></div>)}</dl></>;
}
