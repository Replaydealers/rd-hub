// Tsumiki V1.0 – Geschäftsprozesse & Buchhaltung
// Reine Logik auf einem Datenobjekt `db` (Tabellen als Arrays). Speichern übernimmt der Aufrufer
// (Server → Excel, Online-Demo → Browser-Speicher). Zahlungen laufen über ctx.payments.
import { quote, nextCutoff, r2, fmtDate } from './pricing.js';
import { mail, invoiceHtml } from './documents.js';
import { EU_COUNTRIES } from './params.js';

// ---------- Konten (SKR03, Vorschlag – mit Steuerberaterin abstimmen) ----------
export const ACCOUNTS = {
  1200: 'Bank', 1210: 'Wise (Yen-Konto)', 1360: 'Geldtransit (PayPal/Stripe)', 1588: 'Einfuhrumsatzsteuer (Vorsteuer)',
  1718: 'Erhaltene Anzahlungen 19 % USt', 3200: 'Wareneingang Import (ohne Vorsteuer)', 3800: 'Bezugsnebenkosten',
  3850: 'Zölle und Einfuhrabgaben', 4970: 'Nebenkosten des Geldverkehrs', 4910: 'Porto (Versand an Kunden)',
  8400: 'Erlöse 19 % USt', 8320: 'Erlöse EU-Ausland (OSS)',
};

const nowIso = (ctx) => (ctx && ctx.now ? new Date(ctx.now) : new Date()).toISOString();
const year = (iso) => new Date(iso).getFullYear();
const pad = (n, l = 4) => String(n).padStart(l, '0');
const rnd = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

function nextId(list, prefix, iso) {
  const y = year(iso);
  const nums = list.map((x) => String(x.id)).filter((id) => id.startsWith(`${prefix}-${y}-`)).map((id) => parseInt(id.split('-')[2], 10) || 0);
  return `${prefix}-${y}-${pad((nums.length ? Math.max(...nums) : 0) + 1)}`;
}

function log(db, action, ref, details, ctx) {
  db.log.push({ date: nowIso(ctx), action, ref, details: typeof details === 'string' ? details : JSON.stringify(details) });
}

function book(db, e, ctx) {
  const id = db.journal.length ? Math.max(...db.journal.map((j) => Number(j.id) || 0)) + 1 : 1;
  db.journal.push({ id, date: e.date || nowIso(ctx), beleg: e.beleg, text: e.text, soll: e.soll, haben: e.haben, amount: r2(e.amount), taxKey: e.taxKey || '', taxAmount: r2(e.taxAmount || 0), ref: e.ref || '' });
}

function sendMail(db, kind, order, ctx, extra = {}) {
  const positions = db.positions.filter((p) => p.orderId === order.id && p.status !== 'nicht_verfuegbar');
  const m = mail(kind, order, { params: db.params, baseUrl: ctx.baseUrl || '', positions, extra });
  const id = db.outbox.length + 1;
  db.outbox.push({ id, date: nowIso(ctx), to: order.email, subject: m.subject, orderId: order.id, html: m.html });
  if (ctx.mailer) ctx.mailer(order.email, m.subject, m.html);
}

function notify(ctx, title, message, path) {
  if (ctx.notify) ctx.notify(title, message, path);
}

const orderPositions = (db, orderId) => db.positions.filter((p) => p.orderId === orderId);
const getOrder = (db, id) => {
  const o = db.orders.find((x) => x.id === id || x.token === id);
  if (!o) throw new Error('Bestellung nicht gefunden: ' + id);
  return o;
};

// ---------- 1. Bestellung anlegen ----------
export function createOrder(db, input, ctx = {}) {
  const at = nowIso(ctx);
  const country = input.country || 'DE';
  const q = quote(input.items, country, db.params, ctx.fxRate);
  if (!q.lines.length) throw new Error('Keine Artikel im Warenkorb.');
  if (q.problems.length) throw new Error(q.problems.map((p) => p.text).join(' '));
  for (const f of ['name', 'email', 'street', 'zip', 'city']) if (!String(input.customer?.[f] || '').trim()) throw new Error('Bitte alle Pflichtfelder ausfüllen.');
  const s = q.summary;
  const order = {
    id: nextId(db.orders, 'T', at), token: rnd(), createdAt: at,
    status: 'zahlung_offen',
    name: input.customer.name.trim(), email: input.customer.email.trim(), street: input.customer.street.trim(), zip: input.customer.zip.trim(), city: input.customer.city.trim(), country,
    paymentMethod: input.paymentMethod || 'paypal', paymentStatus: input.paymentMethod === 'ueberweisung' ? 'warten_auf_zahlung' : 'wird_reserviert', paymentRef: '',
    authorizedGross: 0, capturedGross: 0,
    goodsTotal: s.goodsTotal, importCost: s.importCost, serviceFee: s.serviceFee, shipping: s.shipping,
    net: s.net, vatRate: s.vatRate, vat: s.vat, gross: s.gross, solo: s.solo, fxRate: q.lines[0].rate,
    shipmentId: '', invoiceId: '', shippedAt: '', trackingNo: '', notes: input.notes || '',
  };
  db.orders.push(order);
  q.lines.forEach((l, i) => {
    const it = input.items[i];
    db.positions.push({
      id: `${order.id}-${i + 1}`, orderId: order.id, status: 'angefragt', url: it.url, platform: l.platform, title: (it.title || '').slice(0, 140),
      type: l.type, qty: l.qty, priceJPY: l.priceJPY, domesticJPY: l.domesticJPY, sendicoJPY: l.sendicoJPY, weightKg: l.weightKg,
      goodsEUR: l.goodsEUR, importCostEUR: l.importCostEUR, dutyEUR: l.dutyEUR, freightEUR: r2(l.freightEUR + l.fixedShareEUR),
      netPriceEUR: l.netPriceEUR, grossPriceEUR: l.grossPriceEUR,
      sendicoNo: '', purchasedAt: '', actualPriceJPY: '', actualRate: '', actualGoodsEUR: '', actualSendicoEUR: '', actualLogisticsEUR: '', shipmentId: '', checked: '',
    });
  });
  log(db, 'Bestellung angelegt', order.id, { gross: order.gross, items: q.lines.length, pay: order.paymentMethod }, ctx);
  if (order.paymentMethod === 'ueberweisung') sendMail(db, 'ueberweisung', order, ctx);
  return order;
}

// Zahlungsdienstleister hat den Betrag vorgemerkt (PayPal-Autorisierung / Stripe manual capture)
export function markAuthorized(db, { token, ref, amount }, ctx = {}) {
  const o = getOrder(db, token);
  if (o.paymentStatus !== 'wird_reserviert') return o; // doppelter Rücksprung
  o.paymentStatus = 'reserviert'; o.paymentRef = ref || o.paymentRef; o.authorizedGross = Number(amount) || o.gross; o.status = 'neu';
  log(db, 'Zahlung reserviert', o.id, { ref, amount: o.authorizedGross }, ctx);
  sendMail(db, 'eingang', o, ctx);
  const n = orderPositions(db, o.id).length;
  notify(ctx, `Neue Bestellung ${o.id}`, `${n} Artikel · ${o.gross.toFixed(2)} € – jetzt bei Sendico kaufen`, '/admin/#kaufen');
  return o;
}

// Kunde hat die Zahlung abgebrochen
export function markPaymentCancelled(db, { token }, ctx = {}) {
  const o = getOrder(db, token);
  if (o.paymentStatus !== 'wird_reserviert') return o;
  o.paymentStatus = 'abgebrochen'; o.status = 'storniert';
  orderPositions(db, o.id).forEach((p) => { p.status = 'nicht_verfuegbar'; });
  log(db, 'Zahlung abgebrochen', o.id, '', ctx);
  return o;
}

// Preis nur für die tatsächlich gekauften Positionen neu rechnen (Teil-Storno)
function repriceOrder(db, order) {
  const pos = orderPositions(db, order.id).filter((p) => p.status !== 'nicht_verfuegbar');
  if (!pos.length) return null;
  const items = pos.map((p) => ({ url: p.url, platform: p.platform, priceJPY: p.priceJPY, qty: p.qty, type: p.type, domesticIncluded: !(Number(p.domesticJPY) > 0), domesticJPY: p.domesticJPY }));
  return quote(items, order.country, db.params, order.fxRate / (1 - Number(db.params.kurs_puffer || 0)));
}

// ---------- 2. Zahlung per Überweisung eingegangen ----------
export async function markTransferPaid(db, { orderId }, ctx = {}) {
  const o = getOrder(db, orderId);
  o.paymentStatus = 'bezahlt'; o.capturedGross = o.gross; o.status = 'neu';
  book(db, { beleg: o.id, text: `Überweisung ${o.id} ${o.name}`, soll: 1200, haben: 1718, amount: o.gross, taxKey: `USt ${Math.round(o.vatRate * 100)} % (Anzahlung)`, taxAmount: o.vat, ref: o.id }, ctx);
  log(db, 'Überweisung eingegangen', o.id, o.gross, ctx);
  notify(ctx, `Zahlung da: ${o.id}`, 'Überweisung eingegangen – jetzt kaufen', '/admin/#kaufen');
  return o;
}

// ---------- 3. In Japan gekauft / nicht verfügbar ----------
export async function purchasePosition(db, { positionId, sendicoNo, actualPriceJPY, actualRate, unavailable }, ctx = {}) {
  const p = db.positions.find((x) => x.id === positionId);
  if (!p) throw new Error('Position nicht gefunden');
  if (p.status !== 'angefragt') throw new Error('Position ist schon bearbeitet');
  const o = getOrder(db, p.orderId);
  if (!['reserviert', 'bezahlt'].includes(o.paymentStatus)) throw new Error('Erst kaufen, wenn die Zahlung reserviert bzw. eingegangen ist.');
  const at = nowIso(ctx);
  if (unavailable) {
    p.status = 'nicht_verfuegbar';
    log(db, 'Nicht verfügbar', p.id, '', ctx);
  } else {
    const rate = Number(actualRate) || Number(o.fxRate) / (1 - Number(db.params.kurs_puffer || 0));
    const jpy = Number(actualPriceJPY) || (Number(p.priceJPY) * Number(p.qty) + Number(p.domesticJPY || 0));
    p.status = 'gekauft'; p.sendicoNo = sendicoNo || ''; p.purchasedAt = at; p.actualPriceJPY = jpy; p.actualRate = r2(rate);
    p.actualGoodsEUR = r2(jpy / rate); p.actualSendicoEUR = r2(Number(p.sendicoJPY) / rate);
    book(db, { date: at, beleg: p.id, text: `Wareneinkauf Japan ${p.platform} ${p.sendicoNo}`, soll: 3200, haben: 1210, amount: p.actualGoodsEUR, ref: p.id }, ctx);
    book(db, { date: at, beleg: p.id, text: `Sendico-Gebühr ${p.sendicoNo}`, soll: 3800, haben: 1210, amount: p.actualSendicoEUR, taxKey: '§13b (Leistung aus Drittland – prüfen)', ref: p.id }, ctx);
    log(db, 'Gekauft', p.id, { sendicoNo, jpy }, ctx);
  }
  // Sind alle Positionen der Bestellung entschieden?
  const all = orderPositions(db, o.id);
  if (all.some((x) => x.status === 'angefragt')) return { order: o, done: false };
  const bought = all.filter((x) => x.status === 'gekauft');
  if (!bought.length) {
    o.status = 'storniert';
    if (ctx.payments && o.paymentStatus === 'reserviert') await ctx.payments.void(o);
    o.paymentStatus = o.paymentMethod === 'ueberweisung' ? 'zu_erstatten' : 'freigegeben';
    if (o.paymentMethod === 'ueberweisung') book(db, { beleg: o.id, text: `Rückzahlung Überweisung ${o.id}`, soll: 1718, haben: 1200, amount: o.gross, taxKey: `USt ${Math.round(o.vatRate * 100)} % (Anzahlung storniert)`, taxAmount: -o.vat, ref: o.id }, ctx);
    sendMail(db, 'storniert', o, ctx);
    return { order: o, done: true };
  }
  const partial = bought.length < all.length;
  if (partial) {
    const q = repriceOrder(db, o);
    const s = q.summary;
    Object.assign(o, { goodsTotal: s.goodsTotal, importCost: s.importCost, serviceFee: s.serviceFee, shipping: s.shipping, net: s.net, vat: s.vat, gross: s.gross, solo: s.solo });
    q.lines.forEach((l, i) => { bought[i].netPriceEUR = l.netPriceEUR; bought[i].grossPriceEUR = l.grossPriceEUR; });
  }
  if (o.paymentMethod === 'ueberweisung') {
    if (partial) {
      const refund = r2(o.capturedGross - o.gross);
      book(db, { beleg: o.id, text: `Teilrückzahlung ${o.id}`, soll: 1718, haben: 1200, amount: refund, taxKey: `USt ${Math.round(o.vatRate * 100)} % (Anzahlung)`, taxAmount: -r2(refund - refund / (1 + o.vatRate)), ref: o.id }, ctx);
      o.capturedGross = o.gross; o.paymentStatus = 'bezahlt (Teil erstattet)';
    }
  } else {
    if (ctx.payments) await ctx.payments.capture(o, o.gross);
    o.capturedGross = o.gross; o.paymentStatus = 'abgebucht';
    book(db, { beleg: o.id, text: `Zahlung ${o.paymentMethod} ${o.id} ${o.name}`, soll: 1360, haben: 1718, amount: o.gross, taxKey: `USt ${Math.round(o.vatRate * 100)} % (Anzahlung)`, taxAmount: o.vat, ref: o.id }, ctx);
    const fee = r2(o.gross * Number(db.params.zahlung_prozent || 0) + Number(db.params.zahlung_fix_eur || 0));
    book(db, { beleg: o.id, text: `Zahlungsgebühr ${o.paymentMethod} (Schätzung, Ist laut Abrechnung)`, soll: 4970, haben: 1360, amount: fee, ref: o.id }, ctx);
  }
  o.status = 'gekauft';
  const c = nextCutoff(db.params, ctx.now ? new Date(ctx.now) : new Date());
  sendMail(db, partial ? 'teilweise' : 'gekauft', o, ctx, { delivery: `zwischen ${fmtDate(c.deliveryFrom)} und ${fmtDate(c.deliveryTo)}` });
  return { order: o, done: true };
}

// ---------- 4. Sammelsendung bilden und losschicken ----------
export function createShipment(db, _payload, ctx = {}) {
  const at = nowIso(ctx);
  const ready = db.positions.filter((p) => p.status === 'gekauft' && !p.shipmentId);
  if (!ready.length) throw new Error('Keine gekauften Artikel im Lager Japan.');
  const d = new Date(at);
  const base = `S-${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}`;
  const n = db.shipments.filter((s) => String(s.id).startsWith(base)).length + 1;
  const orders = [...new Set(ready.map((p) => p.orderId))];
  const s = {
    id: `${base}-${n}`, status: 'offen', createdAt: at, carrier: 'FedEx (über Sendico)', trackingNo: '', weightKg: r2(ready.reduce((a, p) => a + Number(p.weightKg), 0)),
    freightJPY: '', freightEUR: '', dutyEUR: '', eustEUR: '', clearanceEUR: '', otherEUR: '',
    positionsCount: ready.length, ordersCount: orders.length, goodsEUR: r2(ready.reduce((a, p) => a + Number(p.actualGoodsEUR || p.goodsEUR), 0)),
    kalkLogisticsEUR: r2(ready.reduce((a, p) => a + Number(p.freightEUR) + Number(p.dutyEUR), 0)), istLogisticsEUR: '', deltaEUR: '', sentAt: '', arrivedAt: '',
  };
  db.shipments.push(s);
  ready.forEach((p) => { p.shipmentId = s.id; });
  log(db, 'Sammelsendung gebildet', s.id, { positions: ready.length, orders: orders.length }, ctx);
  return s;
}

export function sendShipment(db, { shipmentId, carrier, trackingNo, weightKg, freightJPY, rate }, ctx = {}) {
  const s = db.shipments.find((x) => x.id === shipmentId);
  if (!s) throw new Error('Sendung nicht gefunden');
  const at = nowIso(ctx);
  const fx = Number(rate) || Number(db.params.kurs_jpy_je_eur_fallback);
  Object.assign(s, { status: 'unterwegs', carrier: carrier || s.carrier, trackingNo: trackingNo || '', weightKg: Number(weightKg) || s.weightKg, freightJPY: Number(freightJPY) || 0, freightEUR: r2((Number(freightJPY) || 0) / fx), sentAt: at });
  if (s.freightEUR) book(db, { date: at, beleg: s.id, text: `Fracht Sammelsendung ${s.id} (Sendico)`, soll: 3800, haben: 1210, amount: s.freightEUR, ref: s.id }, ctx);
  const pos = db.positions.filter((p) => p.shipmentId === s.id);
  pos.forEach((p) => { p.status = 'unterwegs'; });
  [...new Set(pos.map((p) => p.orderId))].forEach((oid) => {
    const o = getOrder(db, oid);
    if (orderPositions(db, oid).every((p) => ['unterwegs', 'nicht_verfuegbar'].includes(p.status))) { o.status = 'unterwegs'; o.shipmentId = s.id; sendMail(db, 'unterwegs', o, ctx); }
  });
  log(db, 'Sammelsendung versendet', s.id, { trackingNo, freightJPY }, ctx);
  return s;
}

// ---------- 5. Ankunft: Ist-Kosten erfassen, verteilen, Nachkalkulation ----------
export function arriveShipment(db, { shipmentId, dutyEUR, eustEUR, clearanceEUR, otherEUR }, ctx = {}) {
  const s = db.shipments.find((x) => x.id === shipmentId);
  if (!s) throw new Error('Sendung nicht gefunden');
  const at = nowIso(ctx);
  Object.assign(s, { status: 'angekommen', dutyEUR: r2(dutyEUR || 0), eustEUR: r2(eustEUR || 0), clearanceEUR: r2(clearanceEUR || 0), otherEUR: r2(otherEUR || 0), arrivedAt: at });
  if (s.dutyEUR) book(db, { date: at, beleg: s.id, text: `Zoll ${s.id}`, soll: 3850, haben: 1200, amount: s.dutyEUR, ref: s.id }, ctx);
  if (s.eustEUR) book(db, { date: at, beleg: s.id, text: `Einfuhrumsatzsteuer ${s.id}`, soll: 1588, haben: 1200, amount: s.eustEUR, taxKey: 'EUSt (Vorsteuer)', taxAmount: s.eustEUR, ref: s.id }, ctx);
  if (s.clearanceEUR) book(db, { date: at, beleg: s.id, text: `Verzollungsgebühr Kurier ${s.id}`, soll: 3800, haben: 1200, amount: s.clearanceEUR, ref: s.id }, ctx);
  if (s.otherEUR) book(db, { date: at, beleg: s.id, text: `Sonstige Kosten ${s.id}`, soll: 3800, haben: 1200, amount: s.otherEUR, ref: s.id }, ctx);
  const ist = r2(Number(s.freightEUR || 0) + s.dutyEUR + s.clearanceEUR + s.otherEUR); // EUSt nicht, die ist Vorsteuer
  s.istLogisticsEUR = ist; s.deltaEUR = r2(Number(s.kalkLogisticsEUR) - ist);
  const pos = db.positions.filter((p) => p.shipmentId === s.id);
  const totalKg = pos.reduce((a, p) => a + Number(p.weightKg), 0) || 1;
  let rest = ist;
  pos.forEach((p, i) => {
    const share = i === pos.length - 1 ? rest : r2(ist * Number(p.weightKg) / totalKg);
    rest = r2(rest - share); p.actualLogisticsEUR = share; p.status = 'angekommen';
  });
  [...new Set(pos.map((p) => p.orderId))].forEach((oid) => {
    const o = getOrder(db, oid);
    if (orderPositions(db, oid).every((p) => ['angekommen', 'nicht_verfuegbar'].includes(p.status))) o.status = 'angekommen';
  });
  log(db, 'Sammelsendung angekommen', s.id, { ist, kalk: s.kalkLogisticsEUR }, ctx);
  return s;
}

export function togglePositionChecked(db, { positionId, value }, ctx = {}) {
  const p = db.positions.find((x) => x.id === positionId || (x.sendicoNo && x.sendicoNo === positionId));
  if (!p) throw new Error('Keine Position zu dieser Nummer gefunden');
  p.checked = value === false ? '' : 'ja';
  return p;
}

// ---------- 6. An Kunden versenden → Rechnung + Erlösbuchung ----------
export function shipOrder(db, { orderId, trackingNo }, ctx = {}) {
  const o = getOrder(db, orderId);
  if (o.status !== 'angekommen') throw new Error('Bestellung ist noch nicht vollständig angekommen.');
  const at = nowIso(ctx);
  const pos = orderPositions(db, o.id).filter((p) => p.status === 'angekommen');
  const lines = pos.map((p) => ({ text: `${p.title || 'Artikel'} (${p.platform}, ${p.qty} Stk.)`, sub: `Beschaffung in Japan inkl. Import · Sendico-Nr. ${p.sendicoNo || '–'}`, net: r2(Number(p.netPriceEUR)) }));
  const inv = { id: nextId(db.invoices, 'RE', at), date: at, serviceDate: at, orderId: o.id, kind: 'Rechnung', refInvoice: '', customer: o.name, country: o.country, net: o.net, vatRate: o.vatRate, vat: o.vat, gross: o.gross, linesJson: JSON.stringify(lines) };
  db.invoices.push(inv);
  const oss = o.country !== 'DE' && Number(db.params.oss_aktiv) === 1;
  book(db, { date: at, beleg: inv.id, text: `Rechnung ${inv.id} ${o.name} – Auflösung Anzahlung`, soll: 1718, haben: oss ? 8320 : 8400, amount: o.gross, taxKey: oss ? `OSS ${o.country} ${Math.round(o.vatRate * 1000) / 10} %` : `USt ${Math.round(o.vatRate * 100)} % (bereits mit Anzahlung erfasst)`, taxAmount: 0, ref: o.id }, ctx);
  book(db, { date: at, beleg: inv.id, text: `Porto an Kunden ${o.id}`, soll: 4910, haben: 1200, amount: o.shipping, ref: o.id }, ctx);
  pos.forEach((p) => { p.status = 'versendet'; });
  Object.assign(o, { status: 'versendet', invoiceId: inv.id, shippedAt: at, trackingNo: trackingNo || 'DEMO-' + Math.floor(Math.random() * 1e9) });
  sendMail(db, 'versendet', o, ctx);
  log(db, 'An Kunden versendet', o.id, { invoice: inv.id }, ctx);
  return { order: o, invoice: inv };
}

// ---------- 7. Widerruf / Retoure ----------
export function returnOrder(db, { orderId, amount }, ctx = {}) {
  const o = getOrder(db, orderId);
  if (o.status !== 'versendet') throw new Error('Nur versendete Bestellungen können widerrufen werden.');
  const at = nowIso(ctx);
  const gross = r2(Number(amount) || Number(o.gross) - Number(o.shipping) * (1 + Number(o.vatRate)));
  const net = r2(gross / (1 + Number(o.vatRate)));
  const inv = { id: nextId(db.invoices, 'GS', at), date: at, serviceDate: at, orderId: o.id, kind: 'Gutschrift', refInvoice: o.invoiceId, customer: o.name, country: o.country, net: -net, vatRate: o.vatRate, vat: -r2(gross - net), gross: -gross, linesJson: JSON.stringify([{ text: `Widerruf zu Rechnung ${o.invoiceId}`, net: -net }]) };
  db.invoices.push(inv);
  book(db, { date: at, beleg: inv.id, text: `Gutschrift ${inv.id} (Widerruf)`, soll: 8400, haben: 1360, amount: gross, taxKey: `USt ${Math.round(o.vatRate * 100)} %`, taxAmount: -r2(gross - net), ref: o.id }, ctx);
  o.status = 'retoure';
  orderPositions(db, o.id).forEach((p) => { if (p.status === 'versendet') p.status = 'retoure'; });
  if (ctx.payments) ctx.payments.refund && ctx.payments.refund(o, gross);
  sendMail(db, 'retoure', o, ctx, { amount: gross });
  log(db, 'Widerruf', o.id, gross, ctx);
  return inv;
}

export function updateParams(db, { changes }, ctx = {}) {
  for (const [k, v] of Object.entries(changes || {})) {
    if (!(k in db.params)) continue;
    db.params[k] = typeof db.params[k] === 'number' ? Number(String(v).replace(',', '.')) : v;
  }
  log(db, 'Parameter geändert', '', changes, ctx);
  return db.params;
}

// ---------- Auswertungen ----------
export function ustva(db) {
  const months = {};
  const m = (iso) => String(iso).slice(0, 7);
  for (const j of db.journal) {
    const k = m(j.date);
    months[k] = months[k] || { monat: k, umsatz19Netto: 0, ust: 0, eust: 0, p13b: 0, ust13b: 0 };
    if (Number(j.haben) === 1718 || (Number(j.soll) === 1718 && Number(j.haben) !== 8400 && Number(j.haben) !== 8320) || (Number(j.soll) === 8400 && Number(j.haben) === 1360)) {
      const sign = Number(j.haben) === 1718 ? 1 : -1;
      months[k].ust += Math.abs(Number(j.taxAmount)) * sign;
      months[k].umsatz19Netto += (Math.abs(Number(j.amount)) - Math.abs(Number(j.taxAmount))) * sign;
    }
    if (Number(j.soll) === 1588) months[k].eust += Number(j.amount);
    if (String(j.taxKey).startsWith('§13b')) { months[k].p13b += Number(j.amount); months[k].ust13b += Number(j.amount) * 0.19; }
  }
  return Object.values(months).sort((a, b) => a.monat.localeCompare(b.monat)).map((x) => ({
    ...x, umsatz19Netto: r2(x.umsatz19Netto), ust: r2(x.ust), eust: r2(x.eust), p13b: r2(x.p13b), ust13b: r2(x.ust13b),
    zahllast: r2(x.ust - x.eust), // §13b: USt und Vorsteuer heben sich auf
  }));
}

export function orderProfit(db, o) {
  const pos = orderPositions(db, o.id).filter((p) => !['nicht_verfuegbar', 'angefragt'].includes(p.status));
  const revenueNet = Number(o.capturedGross || 0) / (1 + Number(o.vatRate));
  const goods = pos.reduce((a, p) => a + Number(p.actualGoodsEUR || 0), 0);
  const sendico = pos.reduce((a, p) => a + Number(p.actualSendicoEUR || 0), 0);
  const logistics = pos.reduce((a, p) => a + Number(p.actualLogisticsEUR || p.freightEUR + p.dutyEUR || 0), 0);
  const fee = o.paymentMethod === 'ueberweisung' ? 0 : Number(o.capturedGross || 0) * Number(db.params.zahlung_prozent || 0) + Number(db.params.zahlung_fix_eur || 0);
  const ship = Number(o.shipping || 0);
  return { revenueNet: r2(revenueNet), goods: r2(goods), sendico: r2(sendico), logistics: r2(logistics), payment: r2(fee), shipping: r2(ship), profit: r2(revenueNet - goods - sendico - logistics - fee - ship), final: !!pos.length && pos.every((p) => p.actualLogisticsEUR !== '') };
}

export function datevCsv(db) {
  const head = 'Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);Belegdatum;Belegfeld 1;Buchungstext;Steuerhinweis';
  const rows = db.journal.map((j) => [String(Math.abs(j.amount).toFixed(2)).replace('.', ','), Number(j.amount) < 0 ? 'H' : 'S', 'EUR', j.soll, j.haben,
    new Date(j.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }).replace('.', '').replace('.', ''), j.beleg, String(j.text).replace(/;/g, ','), j.taxKey].join(';'));
  return '﻿' + [head, ...rows].join('\r\n');
}

// ---------- Öffentliche Sicht für die Statusseite (keine internen Kosten) ----------
export function publicOrderView(db, token) {
  const o = db.orders.find((x) => x.token === token);
  if (!o) return null;
  const pos = orderPositions(db, o.id).map((p) => ({ id: p.id, title: p.title, platform: p.platform, type: p.type, qty: p.qty, status: p.status, grossPriceEUR: p.grossPriceEUR, url: p.url }));
  return {
    id: o.id, status: o.status, createdAt: o.createdAt, name: o.name, country: o.country, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus,
    gross: o.gross, goodsTotal: o.goodsTotal, capturedGross: o.capturedGross, authorizedGross: o.authorizedGross, solo: o.solo, shipping: o.shipping,
    trackingNo: o.trackingNo, shippedAt: o.shippedAt, invoiceId: o.invoiceId,
    credits: db.invoices.filter((i) => i.orderId === o.id && i.kind === 'Gutschrift').map((i) => i.id), positions: pos,
    iban: o.paymentMethod === 'ueberweisung' ? db.params.firma_iban : '', cutoff: nextCutoff(db.params),
  };
}

export function invoiceFor(db, token, invoiceId) {
  const o = db.orders.find((x) => x.token === token);
  if (!o) return null;
  const inv = db.invoices.find((i) => i.orderId === o.id && (!invoiceId || i.id === invoiceId));
  return inv ? invoiceHtml(inv, o, db.params) : null;
}

// ---------- Einheitlicher Einstieg für die Verwaltung ----------
export const ACTIONS = { markTransferPaid, markAuthorized, markPaymentCancelled, purchasePosition, createShipment, sendShipment, arriveShipment, togglePositionChecked, shipOrder, returnOrder, updateParams };

export async function dispatch(db, action, payload, ctx = {}) {
  const fn = ACTIONS[action];
  if (!fn) throw new Error('Unbekannte Aktion: ' + action);
  return fn(db, payload || {}, ctx);
}

export { EU_COUNTRIES };
