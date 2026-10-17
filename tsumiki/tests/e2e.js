// Tsumiki V1.0 – Ende-zu-Ende-Test gegen den laufenden Server (npm start in zweitem Fenster)
// Spielt eine Bestellung mit zwei Artikeln durch: bestellen → bezahlen (Demo) → kaufen (1x nicht verfügbar)
// → Sammelsendung → Ankunft → versenden → Rechnung → Buchungen → Excel prüfen.
import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const AUTH = 'Basic ' + Buffer.from('admin:' + (process.env.ADMIN_PASSWORD || 'tsumiki')).toString('base64');
const ok = (c, m) => { if (!c) { console.error('✗ ' + m); process.exitCode = 1; } else console.log('✓ ' + m); };
async function j(method, p, body, admin) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: AUTH } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  if (!r.ok) throw new Error(`${p}: ${d.error || r.status}`);
  return d;
}
const act = (action, payload) => j('POST', '/admin/api/action', { action, payload }, true);

const cfg = await j('GET', '/api/config');
ok(cfg.fx.rate > 100, `Kurs geladen: ${cfg.fx.rate} (${cfg.fx.source})`);

const items = [
  { url: 'https://jp.mercari.com/item/m11111111111', priceJPY: 9250, type: 'einzelkarte', title: 'Testkarte A' },
  { url: 'https://www.suruga-ya.jp/product/detail/1', priceJPY: 4000, type: 'booster', title: 'Test-Booster B', domesticIncluded: false },
];
const q = await j('POST', '/api/quote', { items, country: 'DE' });
ok(q.summary.gross > 0 && q.problems.length === 0, `Angebot: ${q.summary.gross} € (allein ca. ${q.summary.solo} €)`);

const bad = await j('POST', '/api/quote', { items: [{ url: 'https://example.com/x', priceJPY: 500 }], country: 'DE' });
ok(bad.problems.length >= 1, 'Unbekannter Shop und Mindestwert werden erkannt');

const o = await j('POST', '/api/orders', { customer: { name: 'Test Kunde', email: 'test@example.de', street: 'Teststr. 1', zip: '42103', city: 'Wuppertal' }, items, country: 'DE', paymentMethod: 'paypal' });
ok(o.redirect.includes('bezahlen.html'), 'Bestellung angelegt, Weiterleitung zur (Demo-)Zahlung: ' + o.id);
await j('POST', `/api/pay/demo/${o.token}`, { action: 'approve' });
let v = await j('GET', `/api/orders/${o.token}`);
ok(v.status === 'neu' && v.paymentStatus === 'reserviert', 'Zahlung vorgemerkt, Status neu');

let st = await j('GET', '/admin/api/state', null, true);
const pos = st.positions.filter((p) => p.orderId === o.id);
await act('purchasePosition', { positionId: pos[0].id, sendicoNo: 'Z-999001', actualPriceJPY: 9250 });
await act('purchasePosition', { positionId: pos[1].id, unavailable: true });
v = await j('GET', `/api/orders/${o.token}`);
ok(v.status === 'gekauft' && v.capturedGross < v.authorizedGross, `Teilkauf: ${v.capturedGross} € statt ${v.authorizedGross} € abgebucht`);

const s = (await act('createShipment', {})).result;
ok(s.id && s.positionsCount >= 1, 'Sammelsendung gebildet: ' + s.id);
await act('sendShipment', { shipmentId: s.id, carrier: 'FedEx', trackingNo: 'TEST1', weightKg: 0.5, freightJPY: 3000 });
await act('arriveShipment', { shipmentId: s.id, dutyEUR: 1.5, eustEUR: 11.2, clearanceEUR: 15, otherEUR: 0 });
await act('togglePositionChecked', { positionId: 'Z-999001' });
const shipped = (await act('shipOrder', { orderId: o.id, trackingNo: '00340434TEST' })).result;
ok(shipped.invoice.id.startsWith('RE-'), 'Versendet, Rechnung ' + shipped.invoice.id);

const inv = await fetch(`${BASE}/rechnung/${o.token}/${shipped.invoice.id}`).then((r) => r.text());
ok(inv.includes(shipped.invoice.id) && inv.includes('Umsatzsteuer'), 'Rechnung als HTML abrufbar');

st = await j('GET', '/admin/api/state', null, true);
const pr = st.profits[o.id];
ok(pr.final, `Ergebnis Auftrag: ${pr.profit} € (Erlös netto ${pr.revenueNet} €)`);
ok(st.journal.filter((x) => x.ref === o.id || x.ref.startsWith(o.id)).length >= 5, 'Buchungen erzeugt');
ok(st.outbox.filter((m) => m.orderId === o.id).length >= 4, 'Kunden-Mails im Postausgang');
const csv = await fetch(`${BASE}/admin/api/export/datev.csv`, { headers: { Authorization: AUTH } }).then((r) => r.text());
ok(csv.split('\n').length > 3, 'DATEV-Export erzeugt');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(process.env.EXCEL_FILE || path.join(__dirname, '..', 'data', 'Tsumiki_Datenbank.xlsx'));
const be = wb.getWorksheet('Bestellungen');
let found = false; be.eachRow((r) => { if (r.getCell(1).value === o.id) found = true; });
ok(found, 'Bestellung steht in der Excel-Datei');
console.log(process.exitCode ? '\nFEHLER gefunden.' : '\nAlles grün.');
