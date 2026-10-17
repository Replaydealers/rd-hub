// Tsumiki V1.0 – gemeinsamer Kopf, Fuß und Hilfsfunktionen aller Seiten
export const LOGO = `<svg viewBox="0 0 132 104" aria-hidden="true"><rect x="4" y="56" width="58" height="44" rx="6" fill="currentColor"/><rect x="70" y="56" width="58" height="44" rx="6" fill="currentColor"/><rect x="37" y="4" width="58" height="44" rx="6" fill="#B4341C"/></svg>`;

export const eur = (x) => (Number(x) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
export const jpy = (x) => '¥' + (Number(x) || 0).toLocaleString('de-DE');
export const date = (iso, opts = { day: 'numeric', month: 'long' }) => (iso ? new Date(iso).toLocaleDateString('de-DE', opts) : '');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const NAV = [
  ['so-gehts.html', "So geht's"],
  ['preise.html', 'Preise'],
  ['ueber-uns.html', 'Über uns'],
  ['faq.html', 'Fragen'],
  ['bestellen.html', 'Bestellen', 'cta'],
];

export function brandName() { return (window.TSUMIKI_BRAND || 'Tsumiki'); }

export function renderChrome() {
  const here = location.pathname.split('/').pop() || 'index.html';
  const demo = window.TSUMIKI_MODE === 'demo';
  const head = document.createElement('div');
  head.innerHTML = `
  ${demo ? `<div class="demo-bar"><div class="wrap"><span>Vorschau: Bestellungen werden nur in diesem Browser gespeichert, Zahlungen sind simuliert.</span><a href="admin/index.html">Zur Verwaltung</a></div></div>` : ''}
  <header class="site-head"><div class="wrap">
    <a class="brand" href="index.html" aria-label="${brandName()} Startseite">${LOGO}<span>${brandName().toLowerCase()}</span></a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="nav">Menü</button>
    <nav class="nav" id="nav" aria-label="Hauptmenü">
      ${NAV.map(([href, label, cls]) => `<a href="${href}" class="${cls || ''}" ${href === here ? 'aria-current="page"' : ''}>${label}${cls === 'cta' ? '<span class="cart-count"></span>' : ''}</a>`).join('')}
    </nav>
  </div></header>`;
  document.body.prepend(...head.children);
  const btn = $('.menu-btn');
  btn.addEventListener('click', () => { const n = $('#nav'); n.classList.toggle('open'); btn.setAttribute('aria-expanded', n.classList.contains('open')); });

  const foot = document.createElement('footer');
  foot.className = 'site-foot';
  foot.innerHTML = `<div class="wrap"><div class="foot-grid">
    <div><a class="brand" href="index.html">${LOGO.replace('currentColor', '#fff').replace('currentColor', '#fff')}<span>${brandName().toLowerCase()}</span></a>
      <p style="margin-top:14px;max-width:42ch">Sammelimport japanischer Sammelkarten. Wir kaufen für dich in Japan ein und schicken alles gebündelt nach Europa.</p></div>
    <ul><li><a href="bestellen.html">Bestellen</a></li><li><a href="so-gehts.html">So geht's</a></li><li><a href="preise.html">Preise</a></li><li><a href="faq.html">Fragen</a></li><li><a href="ueber-uns.html">Über uns</a></li></ul>
    <ul><li><a href="impressum.html">Impressum</a></li><li><a href="datenschutz.html">Datenschutz</a></li><li><a href="agb.html">AGB</a></li><li><a href="widerruf.html">Widerruf</a></li></ul>
  </div><p class="small" style="margin-top:32px;color:#A9A7A2">Ein Angebot von Bastian Karlshaus, Wuppertal.</p></div>`;
  document.body.append(foot);
  updateCartCount();
}

// ---------- Warenkorb im Browser ----------
const CART = 'tsumiki-cart-v1';
export function getCart() {
  try { return JSON.parse(localStorage.getItem(CART)) || { items: [], country: 'DE' }; } catch (e) { return window.__cart || { items: [], country: 'DE' }; }
}
export function setCart(c) {
  window.__cart = c;
  try { localStorage.setItem(CART, JSON.stringify(c)); } catch (e) { /* nur im Speicher */ }
  updateCartCount();
}
export function updateCartCount() {
  const n = getCart().items.length;
  $$('.cart-count').forEach((el) => { el.textContent = n ? ` (${n})` : ''; });
}

// ---------- Preisblock: die gestapelten Bausteine ----------
export function priceStack(summary, { details = true } = {}) {
  if (!summary || !summary.count) return '';
  return `<div class="stack" aria-live="polite">
    <div class="block ware"><span class="k">Warenwert in Japan<span class="sub">${summary.count} ${summary.count === 1 ? 'Artikel' : 'Artikel'} zum Tageskurs</span></span><span class="v">${eur(summary.displayGoods)}</span></div>
    <div class="block import"><span class="k">Import, Steuern und Service<span class="sub">Einkauf, Fracht, Zoll, Versand zu dir, MwSt.</span></span><span class="v">+ ${eur(summary.displayImportService)}</span></div>
    <div class="block total"><span class="k">Endpreis<span class="sub">inkl. ${Math.round(summary.vatRate * 100)} % MwSt. und Versand</span></span><span class="v">${eur(summary.gross)}</span></div>
  </div>
  ${summary.savings > 0 ? `<div class="compare"><span>Allein bestellt ca. <s>${eur(summary.solo)}</s></span><span>du sparst ca. ${eur(summary.savings)}</span></div>` : ''}
  ${details ? `<details class="details"><summary>Woraus sich der Preis zusammensetzt</summary><dl>
    <dt>Warenwert (Japan, umgerechnet)</dt><dd>${eur(summary.goodsTotal)}</dd>
    <dt>Einkauf in Japan, Fracht und Zoll</dt><dd>${eur(summary.importCost)}</dd>
    <dt>Versand zu dir (${esc(summary.shippingMethod)})</dt><dd>${eur(summary.shipping)}</dd>
    <dt>Servicegebühr (fix + ${Math.round(summary.serviceFeePct * 100)} % vom Warenwert)</dt><dd>${eur(summary.serviceFee)}</dd>
    <dt>Umsatzsteuer ${Math.round(summary.vatRate * 100)} %</dt><dd>${eur(summary.vat)}</dd>
  </dl><p class="small muted">Einfuhrumsatzsteuer und Zoll zahlen wir bei der Einfuhr. Für dich gibt es keine Nachzahlung an der Haustür.</p></details>` : ''}`;
}

// ---------- Kiste: Füllstand der nächsten Sammelsendung ----------
export function boxWidget(cfg, { mine = false } = {}) {
  const min = (cfg.box && cfg.box.min) || 10;
  const n = Math.min((cfg.box && cfg.box.orders) || 0, min);
  const slots = Array.from({ length: min }, (_, i) => `<span class="slot ${i < n ? 'full' : ''} ${mine && i === n ? 'mine' : ''}"></span>`).join('');
  const days = cfg.cutoff ? cfg.cutoff.daysLeft : '';
  return `<div class="kiste">
    <div><h3>Nächste Kiste aus Japan</h3><div class="muted small">Bestellschluss ${date(cfg.cutoff.cutoff)}, bei dir voraussichtlich ${date(cfg.cutoff.deliveryFrom)} bis ${date(cfg.cutoff.deliveryTo)}</div></div>
    <div class="days">${days}<small>${days === 1 ? 'Tag' : 'Tage'}</small></div>
    <div class="slots" role="img" aria-label="${n} von ${min} Bestellungen in der Kiste">${slots}</div>
    <div class="small muted" style="grid-column:1/-1">${n} von ${min} Bestellungen drin. Die Kiste geht los, sobald sie voll ist, spätestens einen Monat nach dem Bestellschluss.</div>
  </div>`;
}

export const ITEM_TYPE_OPTIONS = [
  ['einzelkarte', 'Einzelkarte'], ['slab', 'Gegradete Karte (PSA, BGS, CGC)'], ['booster', 'Booster oder Packs'], ['display', 'Display oder Box (versiegelt)'], ['sonstiges', 'Deck, Promo-Set, Zubehör'],
];

// Zeigt eine Rechnung, Mail oder ein Etikett in einem Fenster über der Seite (funktioniert auch dort, wo Pop-ups gesperrt sind)
export function showHtmlOverlay(html, title = 'Vorschau') {
  const wrap = document.createElement('div');
  wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-label', title);
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(27,26,31,.55);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px';
  wrap.innerHTML = `<div style="background:#fff;border-radius:14px;width:min(860px,100%);height:min(92vh,1000px);display:flex;flex-direction:column;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #E4E1DB"><strong>${esc(title)}</strong><button type="button" class="btn secondary" style="min-height:40px">Schließen</button></div>
    <iframe title="${esc(title)}" style="border:0;flex:1;width:100%"></iframe></div>`;
  wrap.querySelector('iframe').srcdoc = html;
  const close = () => wrap.remove();
  wrap.querySelector('button').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  document.body.append(wrap);
}

// Zweistufige Bestätigung im Knopf selbst (statt confirm(), das nicht überall funktioniert)
export function confirmClick(btn, question, fn) {
  let armed = false; const label = btn.textContent;
  btn.addEventListener('click', () => {
    if (!armed) { armed = true; btn.textContent = question; setTimeout(() => { armed = false; btn.textContent = label; }, 4000); return; }
    armed = false; btn.textContent = label; fn();
  });
}
