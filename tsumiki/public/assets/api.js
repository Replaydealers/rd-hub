// Tsumiki V1.0 – eine Schnittstelle für Website und Verwaltung.
// Im Server-Modus spricht sie mit dem lokalen Server (Excel), im Demo-Modus mit dem Browser-Speicher.
const isDemo = () => window.TSUMIKI_MODE === 'demo';
let demoMod = null;
async function demo() { if (!demoMod) demoMod = (await import('./demo-backend.js')).demo; return demoMod; }

// Pfad-Präfix: Seiten liegen im Wurzelverzeichnis, die Verwaltung in /admin/
const root = location.pathname.includes('/admin/') ? '../' : '';

async function http(method, path, body) {
  const r = await fetch(root + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Fehler ${r.status}`);
  return j;
}

async function openHtml(html, title) {
  const { showHtmlOverlay } = await import('./site.js');
  showHtmlOverlay(html, title);
}

export const api = {
  isDemo,
  openHtml,
  config: async () => (isDemo() ? (await demo()).config() : http('GET', 'api/config')),
  quote: async (items, country) => (isDemo() ? (await demo()).quote(items, country) : http('POST', 'api/quote', { items, country })),
  createOrder: async (body) => (isDemo() ? (await demo()).createOrder(body) : http('POST', 'api/orders', body)),
  payDemo: async (token, action) => (isDemo() ? (await demo()).payDemo(token, action) : http('POST', `api/pay/demo/${token}`, { action })),
  waitlist: async (email) => (isDemo() ? { ok: true } : http('POST', 'api/warteliste', { email })),
  order: async (token) => (isDemo() ? (await demo()).order(token) : http('GET', `api/orders/${token}`)),
  async openInvoice(token, id) {
    if (isDemo()) return openHtml(await (await demo()).invoiceHtml(token, id), id);
    window.open(`${root}rechnung/${token}/${id}`, '_blank');
  },
  // Verwaltung
  adminState: async () => (isDemo() ? (await demo()).adminState() : http('GET', 'admin/api/state')),
  adminAction: async (action, payload) => (isDemo() ? (await demo()).adminAction(action, payload) : http('POST', 'admin/api/action', { action, payload })),
  async openMail(id) {
    if (isDemo()) return openHtml(await (await demo()).mailHtml(id), 'E-Mail');
    window.open(`${root}admin/api/mail/${id}`, '_blank');
  },
  async openAdminInvoice(id) {
    if (isDemo()) return openHtml(await (await demo()).adminInvoiceHtml(id), id);
    window.open(`${root}admin/api/rechnung/${id}`, '_blank');
  },
  downloadExcel() { if (!isDemo()) window.location.href = `${root}admin/api/export/excel`; },
  async downloadDatev() {
    if (!isDemo()) { window.location.href = `${root}admin/api/export/datev.csv`; return; }
    const csv = await (await demo()).datev();
    const safe = csv.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    openHtml(`<p style="font-family:Arial">In der Vorschau als Text. Auf dem lokalen Server wird die Datei heruntergeladen.</p><pre style="font-size:12px;white-space:pre">${safe}</pre>`, 'Buchungsstapel (CSV)');
  },
};
