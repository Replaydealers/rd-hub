// Tsumiki V1.0 – Beispieldaten: spielt den kompletten Ablauf einmal durch,
// damit Verwaltung, Excel und Buchhaltung sofort etwas zeigen.
import { createOrder, markAuthorized, markTransferPaid, purchasePosition, createShipment, sendShipment, arriveShipment, togglePositionChecked, shipOrder } from './workflow.js';

const C = (name, email, city, zip, country = 'DE') => ({ name, email, street: 'Musterstraße 1', zip, city, country });
const M = (id) => `https://jp.mercari.com/item/m${id}`;

export async function seedDemo(db, baseCtx = {}) {
  const day = (d, h = 10) => { const x = new Date(); x.setDate(x.getDate() - d); x.setHours(h, 15, 0, 0); return x.toISOString(); };
  const ctx = (d, h) => ({ ...baseCtx, now: day(d, h), notify: null, mailer: null });

  const orders = [
    { d: 40, c: C('Lena Hoffmann', 'lena@example.de', 'Köln', '50667'), pay: 'paypal', items: [
      { url: M('81234567011'), priceJPY: 9250, type: 'einzelkarte', title: 'Pikachu Promo (japanisch)' },
      { url: M('81234567012'), priceJPY: 4200, type: 'einzelkarte', title: 'Evoli Illustration Rare' }] },
    { d: 38, c: C('Jonas Becker', 'jonas@example.de', 'Wuppertal', '42103'), pay: 'stripe', items: [
      { url: 'https://page.auctions.yahoo.co.jp/jp/auction/x123456789', priceJPY: 26800, type: 'slab', title: 'PSA 10 Gengar (japanisch)' }] },
    { d: 36, c: C('Mia Wagner', 'mia@example.de', 'Wien', '1010', 'AT'), pay: 'ueberweisung', items: [
      { url: 'https://www.suruga-ya.jp/product/detail/602000001', priceJPY: 6900, type: 'display', title: 'One Piece Card Game Booster Display' },
      { url: M('81234567031'), priceJPY: 2400, type: 'booster', title: 'Yu-Gi-Oh! OCG Booster (3 Packs)', qty: 1 }] },
    { d: 9, c: C('Tim Schulz', 'tim@example.de', 'Düsseldorf', '40210'), pay: 'paypal', items: [
      { url: M('81234567041'), priceJPY: 15800, type: 'einzelkarte', title: 'Glurak SAR (japanisch)' },
      { url: M('81234567042'), priceJPY: 3500, type: 'einzelkarte', title: 'Mew Promo (japanisch)' },
      { url: M('81234567043'), priceJPY: 2800, type: 'einzelkarte', title: 'Relaxo Art Rare' }] },
    { d: 5, c: C('Sara Klein', 'sara@example.de', 'Essen', '45127'), pay: 'stripe', items: [
      { url: M('81234567051'), priceJPY: 7400, type: 'einzelkarte', title: 'Nachtara Alt Art (japanisch)' }] },
    { d: 0, c: C('Paul Neumann', 'paul@example.de', 'Bochum', '44787'), pay: 'paypal', items: [
      { url: M('81234567061'), priceJPY: 11200, type: 'slab', title: 'PSA 10 Bisasam (japanisch)' },
      { url: 'https://item.fril.jp/abc123', priceJPY: 1800, type: 'einzelkarte', title: 'Digimon Card Game Promo' }] },
  ];

  const made = [];
  for (const o of orders) {
    const order = createOrder(db, { customer: o.c, items: o.items, country: o.c.country, paymentMethod: o.pay }, ctx(o.d, 9));
    if (o.pay === 'ueberweisung') await markTransferPaid(db, { orderId: order.id }, ctx(o.d - 1, 18));
    else markAuthorized(db, { token: order.token, ref: 'DEMO-' + order.id }, ctx(o.d, 9));
    made.push({ order, d: o.d });
  }
  const buy = async (list) => {
    for (const { order, d } of list) {
      const pos = db.positions.filter((p) => p.orderId === order.id);
      for (const [i, p] of pos.entries()) {
        const unavailable = order.id.endsWith('0004') && i === 2; // ein Artikel war schon weg → Teilabbuchung
        await purchasePosition(db, { positionId: p.id, sendicoNo: unavailable ? '' : `Z-${160000 + Math.floor(Math.random() * 9000)}`, unavailable }, ctx(Math.max(d - 1, 0), 20));
      }
    }
  };
  // Bestellungen 1–3: gekauft, Sammelsendung angekommen, an Kunden versendet
  await buy(made.slice(0, 3));
  const s1 = createShipment(db, {}, ctx(30, 8));
  sendShipment(db, { shipmentId: s1.id, carrier: 'FedEx Economy (Sendico)', trackingNo: '7712 3456 0001', weightKg: 1.2, freightJPY: 4900 }, ctx(30, 9));
  arriveShipment(db, { shipmentId: s1.id, dutyEUR: 4.1, eustEUR: 63.4, clearanceEUR: 15, otherEUR: 0 }, ctx(24, 11));
  db.positions.filter((p) => p.shipmentId === s1.id).forEach((p) => togglePositionChecked(db, { positionId: p.id }, ctx(24, 12)));
  for (const { order } of made.slice(0, 3)) shipOrder(db, { orderId: order.id, trackingNo: '00340434' + Math.floor(1e9 + Math.random() * 8e9) }, ctx(23, 15));
  // Bestellungen 4–5: gekauft, liegen im Lager Japan und warten auf die nächste Kiste
  await buy(made.slice(3, 5));
  // Bestellung 6: neu – erscheint in der Verwaltung unter "Kaufen"
  return db;
}
