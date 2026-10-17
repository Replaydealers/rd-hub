// Tsumiki V1.0 – Demo-Backend: dieselbe Geschäftslogik wie der Server, aber im Browser gespeichert.
// Wird nur in der Online-Vorschau benutzt (window.TSUMIKI_MODE = 'demo').
import { emptyDb } from '../core/schema.js';
import { defaultParams, EU_COUNTRIES, ITEM_TYPES, PLATFORMS } from '../core/params.js';
import { quote, nextCutoff } from '../core/pricing.js';
import { createOrder, markAuthorized, markPaymentCancelled, dispatch, publicOrderView, invoiceFor, ustva, orderProfit, datevCsv } from '../core/workflow.js';
import { seedDemo } from '../core/demo-seed.js';

const KEY = 'tsumiki-demo-db-v1';
let mem = null;

let seeding = null;
function load() {
  if (mem) return mem;
  try { const s = localStorage.getItem(KEY); if (s) mem = JSON.parse(s); } catch (e) { /* kein Speicher */ }
  if (!mem) { mem = emptyDb(defaultParams()); seeding = seedDemo(mem, ctx()).then(save); }
  return mem;
}
async function ready() { load(); if (seeding) await seeding; return mem; }
function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* nur im Speicher */ } }

const payments = { capture: async () => ({ ok: true }), void: async () => ({ ok: true }), refund: async () => ({ ok: true }) };
const notify = (title, msg) => {
  try { const n = JSON.parse(sessionStorage.getItem('tsumiki-push') || '[]'); n.push({ title, msg, at: Date.now() }); sessionStorage.setItem('tsumiki-push', JSON.stringify(n)); } catch (e) { /* egal */ }
};
const baseUrl = () => location.href.replace(/\/(admin\/)?[^/]*$/, '');
const ctx = () => ({ payments, notify, baseUrl: baseUrl() });

export function boxStats(db) {
  const waiting = db.orders.filter((o) => ['neu', 'gekauft'].includes(o.status)).length;
  return { orders: waiting, min: Number(db.params.mindestmenge_sendung) || 10 };
}

export const demo = {
  async config() {
    const db = await ready();
    return { mode: 'demo', fx: { rate: Number(db.params.kurs_jpy_je_eur_fallback), source: 'Demo-Kurs' }, cutoff: nextCutoff(db.params), payments: { paypal: 'demo', stripe: 'demo', ueberweisung: 'manuell' }, countries: EU_COUNTRIES, itemTypes: ITEM_TYPES, platforms: PLATFORMS, params: db.params };
  },
  async quote(items, country) { const db = await ready(); return quote(items, country, db.params, Number(db.params.kurs_jpy_je_eur_fallback)); },
  async createOrder(body) {
    const db = await ready();
    const o = createOrder(db, body, ctx()); save();
    return { token: o.token, id: o.id, redirect: body.paymentMethod === 'ueberweisung' ? `status.html?b=${o.token}&neu=1` : `bezahlen.html?b=${o.token}&m=${body.paymentMethod}` };
  },
  async payDemo(token, action) {
    const db = await ready();
    if (action === 'cancel') markPaymentCancelled(db, { token }, ctx()); else markAuthorized(db, { token, ref: 'DEMO-' + Date.now() }, ctx());
    save(); return { ok: true };
  },
  async order(token) { const v = publicOrderView(await ready(), token); if (!v) throw new Error('Bestellung nicht gefunden'); return v; },
  async invoiceHtml(token, id) { return invoiceFor(await ready(), token, id); },
  // Verwaltung
  async adminState() { const db = await ready(); return { ...db, fx: { rate: Number(db.params.kurs_jpy_je_eur_fallback), source: 'Demo-Kurs' }, cutoff: nextCutoff(db.params), payments: { paypal: 'demo', stripe: 'demo' }, ustva: ustva(db), profits: Object.fromEntries(db.orders.map((o) => [o.id, orderProfit(db, o)])) }; },
  async adminAction(action, payload) {
    const db = await ready();
    if (action === 'resetDemo') { mem = emptyDb(defaultParams()); save(); return { ok: true }; }
    if (action === 'seedDemo') { mem = emptyDb(defaultParams()); await seedDemo(mem, ctx()); save(); return { ok: true }; }
    const result = await dispatch(db, action, payload, ctx()); save(); return { ok: true, result };
  },
  async datev() { return datevCsv(await ready()); },
  async mailHtml(id) { const m = (await ready()).outbox.find((x) => String(x.id) === String(id)); return m ? m.html : ''; },
  async adminInvoiceHtml(id) { const db = await ready(); const inv = db.invoices.find((i) => i.id === id); const o = inv && db.orders.find((x) => x.id === inv.orderId); return o ? invoiceFor(db, o.token, id) : ''; },
};
