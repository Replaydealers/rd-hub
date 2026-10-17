// Tsumiki V1.1 – Server (lokal oder online)
// Start: "npm start" (oder Doppelklick auf START-WINDOWS.bat / START-MAC.command) → http://localhost:3000
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExcelStore } from './store/excel-store.js';
import { quote, nextCutoff } from './core/pricing.js';
import { EU_COUNTRIES, ITEM_TYPES, PLATFORMS } from './core/params.js';
import { createOrder, markAuthorized, markPaymentCancelled, dispatch, publicOrderView, invoiceFor, ustva, orderProfit, datevCsv } from './core/workflow.js';
import { createPayments, paymentModes } from './server/payments.js';
import { createMailer } from './server/mailer.js';
import { emptyDb } from './core/schema.js';
import { seedDemo } from './core/demo-seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env einlesen (ohne Zusatzpaket)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tsumiki';
// SHOP_OFFEN=0: Preisrechner läuft, Bestellen ist zu, stattdessen Warteliste (für die Zeit vor dem Start)
const SHOP_OPEN = process.env.SHOP_OFFEN !== '0';
// Online (https): Standardpasswort und Demo-Zahlung sind gesperrt
const ONLINE = BASE_URL.startsWith('https://');
if (ONLINE && ADMIN_PASSWORD === 'tsumiki') {
  console.error('Online nur mit eigenem ADMIN_PASSWORD starten (Standardpasswort "tsumiki" ist gesperrt).');
  process.exit(1);
}
const store = new ExcelStore(process.env.EXCEL_FILE || path.join(__dirname, 'data', 'Tsumiki_Datenbank.xlsx'));
await store.init();
const payments = createPayments(BASE_URL);
const mailer = createMailer();

// ---------- Tageskurs (EZB über frankfurter.app), 6 h zwischengespeichert ----------
let fx = { rate: null, date: null, source: 'Fallback' };
async function getFx() {
  const fresh = fx.fetchedAt && Date.now() - fx.fetchedAt < 6 * 3600e3;
  if (!fresh) {
    try {
      const r = await fetch('https://api.frankfurter.app/latest?from=EUR&to=JPY', { signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      if (j.rates && j.rates.JPY) fx = { rate: j.rates.JPY, date: j.date, source: 'EZB', fetchedAt: Date.now() };
    } catch (e) { fx.fetchedAt = Date.now(); }
  }
  return { rate: fx.rate || Number(store.db.params.kurs_jpy_je_eur_fallback), date: fx.date, source: fx.rate ? fx.source : 'Fallback (Parameter)' };
}

// ---------- Push-Benachrichtigung aufs Handy (App "ntfy", kostenlos) ----------
function notify(title, message, pathPart) {
  console.log(`🔔 ${title} – ${message}`);
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  fetch(`https://ntfy.sh/${topic}`, { method: 'POST', body: message, headers: { Title: title.replace(/[^\x20-\x7E]/g, ''), Click: BASE_URL + (pathPart || '/admin/'), Priority: '4' } }).catch(() => {});
}

const ctx = () => ({ payments, notify, mailer: mailer.send, baseUrl: BASE_URL, fxRate: fx.rate || undefined });

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------- Öffentliche API ----------
app.get('/api/config', async (req, res) => {
  const p = store.db.params;
  res.json({
    mode: 'server', shopOpen: SHOP_OPEN, fx: await getFx(), cutoff: nextCutoff(p), payments: paymentModes(),
    box: { orders: store.db.orders.filter((o) => ['neu', 'gekauft'].includes(o.status)).length, min: Number(p.mindestmenge_sendung) || 10 },
    countries: EU_COUNTRIES, itemTypes: ITEM_TYPES, platforms: PLATFORMS.map(({ id, label }) => ({ id, label })),
    params: Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('zahlung_'))),
  });
});

app.post('/api/quote', async (req, res) => {
  const f = await getFx();
  res.json(quote(req.body.items || [], req.body.country || 'DE', store.db.params, f.rate));
});

app.post('/api/orders', async (req, res) => {
  try {
    if (!SHOP_OPEN) throw new Error('Bestellungen sind noch nicht freigeschaltet. Trag dich auf der Bestellseite in die Warteliste ein.');
    if (ONLINE && paymentModes()[req.body.paymentMethod] === 'demo') throw new Error('Diese Zahlart ist noch nicht verfügbar. Bitte wähle eine andere.');
    await getFx();
    const order = await store.transact((db) => createOrder(db, req.body, ctx()));
    const redirect = await payments.start(order);
    res.json({ token: order.token, id: order.id, redirect });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/warteliste', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse eintragen.' });
  await store.transact((db) => {
    if (db.waitlist.some((w) => w.email === email)) return;
    db.waitlist.push({ date: new Date().toISOString(), email, note: String(req.body.note || '').slice(0, 300) });
    notify('Neu auf der Warteliste', email, '/admin/');
  });
  res.json({ ok: true });
});

app.get('/api/orders/:token', (req, res) => {
  const v = publicOrderView(store.db, req.params.token);
  if (!v) return res.status(404).json({ error: 'Bestellung nicht gefunden' });
  res.json(v);
});

// Demo-Zahlung (wenn keine echten Schlüssel hinterlegt sind)
app.post('/api/pay/demo/:token', async (req, res) => {
  if (ONLINE) return res.status(403).json({ error: 'Demo-Zahlung ist online abgeschaltet.' });
  try {
    if (req.body.action === 'cancel') await store.transact((db) => markPaymentCancelled(db, { token: req.params.token }, ctx()));
    else await store.transact((db) => markAuthorized(db, { token: req.params.token, ref: 'DEMO-' + Date.now() }, ctx()));
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/pay/paypal/return', async (req, res) => {
  try {
    const r = await payments.confirmPaypal(req.query.token);
    await store.transact((db) => markAuthorized(db, { token: req.query.b, ref: r.ref, amount: r.amount }, ctx()));
    res.redirect(`/status.html?b=${req.query.b}&neu=1`);
  } catch (e) { res.redirect(`/status.html?b=${req.query.b}&fehler=${encodeURIComponent(e.message)}`); }
});
app.get('/api/pay/stripe/return', async (req, res) => {
  try {
    const r = await payments.confirmStripe(req.query.session_id);
    await store.transact((db) => markAuthorized(db, { token: req.query.b, ref: r.ref, amount: r.amount }, ctx()));
    res.redirect(`/status.html?b=${req.query.b}&neu=1`);
  } catch (e) { res.redirect(`/status.html?b=${req.query.b}&fehler=${encodeURIComponent(e.message)}`); }
});
app.get('/api/pay/cancel', async (req, res) => {
  await store.transact((db) => markPaymentCancelled(db, { token: req.query.b }, ctx())).catch(() => {});
  res.redirect(`/status.html?b=${req.query.b}`);
});

app.get('/rechnung/:token/:invoiceId', (req, res) => {
  const html = invoiceFor(store.db, req.params.token, req.params.invoiceId);
  if (!html) return res.status(404).send('Rechnung nicht gefunden');
  res.type('html').send(html);
});

// ---------- Verwaltung (Passwortschutz) ----------
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const [user, pass] = Buffer.from(h.replace('Basic ', ''), 'base64').toString().split(':');
  if (pass === ADMIN_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="Tsumiki Verwaltung"').status(401).send('Anmeldung erforderlich');
}
app.use('/admin', auth);


app.get('/admin/api/state', async (req, res) => {
  const db = store.db;
  res.json({
    ...db, fx: await getFx(), cutoff: nextCutoff(db.params), payments: paymentModes(),
    mail: mailer.mode, shopOpen: SHOP_OPEN, ustva: ustva(db), profits: Object.fromEntries(db.orders.map((o) => [o.id, orderProfit(db, o)])),
  });
});
app.post('/admin/api/action', async (req, res) => {
  try {
    await getFx();
    const { action, payload } = req.body;
    const result = await store.transact(async (db) => {
      if (action === 'resetDemo' || action === 'seedDemo') {
        const fresh = emptyDb(db.params);
        for (const k of Object.keys(fresh)) if (k !== 'params' && k !== 'waitlist') db[k] = fresh[k];
        if (action === 'seedDemo') await seedDemo(db, { ...ctx(), notify: null, mailer: null });
        return { ok: true };
      }
      return dispatch(db, action, payload, ctx());
    });
    res.json({ ok: true, result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/admin/api/export/excel', (req, res) => {
  res.download(store.file, `Tsumiki_Datenbank_${new Date().toISOString().slice(0, 10)}.xlsx`);
});
app.get('/admin/api/export/datev.csv', (req, res) => {
  res.set('Content-Disposition', 'attachment; filename="Tsumiki_Buchungsstapel.csv"').type('text/csv; charset=utf-8').send(datevCsv(store.db));
});
app.get('/admin/api/mail/:id', (req, res) => {
  const m = store.db.outbox.find((x) => String(x.id) === req.params.id);
  res.type('html').send(m ? m.html : 'nicht gefunden');
});
app.get('/admin/api/rechnung/:invoiceId', (req, res) => {
  const inv = store.db.invoices.find((i) => i.id === req.params.invoiceId);
  const o = inv && store.db.orders.find((x) => x.id === inv.orderId);
  if (!o) return res.status(404).send('nicht gefunden');
  res.type('html').send(invoiceFor(store.db, o.token, inv.id));
});

// ---------- Statische Seiten ----------
app.use('/core', express.static(path.join(__dirname, 'core')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`\n  Tsumiki läuft:  ${BASE_URL}`);
  console.log(`  Verwaltung:     ${BASE_URL}/admin/   (Passwort: ${ADMIN_PASSWORD === 'tsumiki' ? 'tsumiki – bitte in .env ändern' : 'aus .env'})`);
  console.log(`  Datenbank:      ${store.file}`);
  console.log(`  Zahlung:        PayPal ${paymentModes().paypal}, Stripe ${paymentModes().stripe}`);
  console.log(`  E-Mail-Versand: ${mailer.mode} · Shop: ${SHOP_OPEN ? 'offen' : 'Warteliste'}\n`);
});
