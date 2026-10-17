// Tsumiki V1.0 – Verwaltung
import { api } from '../assets/api.js';
import { eur, jpy, esc, date, $, $$, confirmClick } from '../assets/site.js';
import { ORDER_STATUS, POS_STATUS } from '../core/schema.js';
import { DEFAULT_PARAMS } from '../core/params.js';

let S = null; // aktueller Datenstand
const view = $('#view');
const dt = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
const statusTag = (s) => {
  const cls = { zahlung_offen: 'warn', neu: 'red', gekauft: 'ok', storniert: '', unterwegs: 'blue', angekommen: 'red', versendet: 'ok', retoure: 'warn' }[s] || '';
  return `<span class="tag ${cls}">${esc(ORDER_STATUS[s] || s)}</span>`;
};
const posTag = (s) => `<span class="tag ${{ angefragt: 'red', gekauft: 'ok', nicht_verfuegbar: '', unterwegs: 'blue', angekommen: 'warn', versendet: 'ok', retoure: 'warn' }[s] || ''}">${esc(POS_STATUS[s] || s)}</span>`;

function toast(msg, err = false) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), err ? 6000 : 3000);
}

async function act(action, payload, okMsg) {
  try { await api.adminAction(action, payload); if (okMsg) toast(okMsg); await load(); }
  catch (e) { toast(e.message, true); }
}

async function load() {
  S = await api.adminState();
  renderTabs(); route();
}

const TABS = [
  ['start', 'Übersicht'], ['kaufen', 'Kaufen'], ['lager', 'Japan & Kiste'], ['eingang', 'Ankunft & Versand'],
  ['bestellungen', 'Bestellungen'], ['buchhaltung', 'Buchhaltung'], ['post', 'Postausgang'], ['einstellungen', 'Einstellungen'],
];
const counts = () => ({
  kaufen: S.orders.filter((o) => o.status === 'neu' || (o.status === 'zahlung_offen' && o.paymentMethod === 'ueberweisung' && o.paymentStatus === 'warten_auf_zahlung')).length,
  lager: S.positions.filter((p) => p.status === 'gekauft' && !p.shipmentId).length,
  eingang: S.orders.filter((o) => o.status === 'angekommen').length,
});
function renderTabs() {
  const c = counts(); const here = (location.hash || '#start').slice(1);
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<a href="#${k}" class="${k === here ? 'on' : ''}">${l}${c[k] ? `<span class="badge">${c[k]}</span>` : ''}</a>`).join('');
  $('#modeinfo').textContent = api.isDemo() ? 'Vorschau-Modus (Daten im Browser)' : `Excel-Datenbank · PayPal: ${S.payments.paypal} · Stripe: ${S.payments.stripe}`;
}
window.addEventListener('hashchange', () => { renderTabs(); route(); });

function route() {
  const k = (location.hash || '#start').slice(1);
  ({ start, kaufen, lager, eingang, bestellungen, buchhaltung, post, einstellungen }[k] || start)();
  window.scrollTo(0, 0);
}

// ---------- Übersicht ----------
function start() {
  const c = counts();
  const inJp = S.orders.filter((o) => o.status === 'gekauft').length;
  const min = Number(S.params.mindestmenge_sendung);
  const month = new Date().toISOString().slice(0, 7);
  const umsatz = S.orders.filter((o) => String(o.createdAt).startsWith(month)).reduce((a, o) => a + Number(o.capturedGross || 0), 0);
  const profit = Object.values(S.profits).filter((p) => p.final).reduce((a, p) => a + p.profit, 0);
  view.innerHTML = `
    <h1 style="font-size:32px">Übersicht</h1>
    <div class="kpis">
      <a class="kpi ${c.kaufen ? 'alert' : ''}" href="#kaufen"><b>${c.kaufen}</b><span>Bestellungen warten aufs Kaufen</span></a>
      <a class="kpi" href="#lager"><b>${inJp} / ${min}</b><span>Aufträge in der Kiste (Mindestmenge)</span></a>
      <a class="kpi ${c.eingang ? 'alert' : ''}" href="#eingang"><b>${c.eingang}</b><span>angekommen, zu versenden</span></a>
      <a class="kpi" href="#buchhaltung"><b>${eur(umsatz)}</b><span>abgebucht diesen Monat</span></a>
    </div>
    <div class="split">
      <div class="card"><h3>Nächster Stichtag</h3><p style="margin:0">${date(S.cutoff.cutoff, { weekday: 'long', day: 'numeric', month: 'long' })}, noch ${S.cutoff.daysLeft} Tage.<br>${inJp >= min ? '<span class="tag ok">Kiste ist voll genug</span>' : `<span class="tag warn">noch ${min - inJp} Aufträge bis zur Mindestmenge</span>`}</p>
        <p class="small muted" style="margin:10px 0 0">Kurs: ${S.fx.rate ? Number(S.fx.rate).toFixed(2) : '–'} ¥/€ (${esc(S.fx.source)})</p></div>
      <div class="card"><h3>Ergebnis abgeschlossener Aufträge</h3><p style="margin:0;font:900 28px var(--display)">${eur(profit)}</p><p class="small muted" style="margin:6px 0 0">Nach Ware, Sendico, Logistik (Ist), Zahlungsgebühr und Porto. Details unter Buchhaltung.</p></div>
    </div>
    <div class="card"><h3>So läuft ein Auftrag</h3>
      <ol style="margin:0;padding-left:20px;line-height:1.9">
        <li>Push aufs Handy → <a href="#kaufen">Kaufen</a>: Angebot öffnen, bei Sendico kaufen, „Gekauft“ tippen. Abgebucht wird automatisch.</li>
        <li>Am Stichtag → <a href="#lager">Japan &amp; Kiste</a>: Sammelsendung bilden, bei Sendico verschicken, Fracht eintragen.</li>
        <li>Kiste da → Zoll, EUSt und Gebühr aus der Kurierrechnung eintragen. Das System verteilt die Kosten.</li>
        <li><a href="#eingang">Ankunft &amp; Versand</a>: Artikel abhaken, Sendungsnummer eintragen, fertig. Rechnung und Buchung entstehen automatisch.</li>
      </ol></div>
    ${S.log.length ? `<div class="card"><h3>Zuletzt passiert</h3><div class="scroll"><table class="t"><tbody>${S.log.slice(-8).reverse().map((l) => `<tr><td>${dt(l.date)}</td><td>${esc(l.action)}</td><td>${esc(l.ref)}</td></tr>`).join('')}</tbody></table></div></div>` : `<div class="card"><p style="margin:0">Noch keine Bestellungen. Lege auf der <a href="../bestellen.html">Website</a> eine Testbestellung an oder lade unter <a href="#einstellungen">Einstellungen</a> Beispieldaten.</p></div>`}`;
}

// ---------- Kaufen ----------
function kaufen() {
  const waitTransfer = S.orders.filter((o) => o.paymentStatus === 'warten_auf_zahlung');
  const open = S.orders.filter((o) => o.status === 'neu');
  view.innerHTML = `<h1 style="font-size:32px">Kaufen</h1>
    <p class="muted">Angebot öffnen, bei Sendico zum genannten Preis kaufen, hier bestätigen. Sobald alle Artikel einer Bestellung entschieden sind, bucht das System ab und informiert den Kunden.</p>
    ${!open.length && !waitTransfer.length ? '<div class="card"><p style="margin:0">Nichts zu kaufen. Neue Bestellungen erscheinen hier und als Push-Nachricht.</p></div>' : ''}
    ${open.map((o) => `<div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h3 style="margin:0">${esc(o.id)} · ${esc(o.name)}</h3><span class="small muted">${dt(o.createdAt)} · ${esc(o.paymentMethod)} · ${eur(o.gross)} reserviert</span></div>
      ${S.positions.filter((p) => p.orderId === o.id).map((p) => `<div class="pos">
        <div><strong>${esc(p.title || p.type)}</strong> <span class="small muted">${esc(p.platform)} · ${p.qty} Stk.</span><br>
          <a href="${esc(p.url)}" target="_blank" rel="noopener">Angebot öffnen</a> · <button class="btn ghost s" data-copy="${esc(p.url)}" type="button">Link kopieren</button></div>
        <div style="text-align:right"><strong>${jpy(p.priceJPY)}</strong>${Number(p.domesticJPY) ? `<br><span class="small muted">+ ${jpy(p.domesticJPY)} Inland</span>` : ''}<br>${posTag(p.status)}</div>
        ${p.status === 'angefragt' ? `<div class="acts">
          <div class="field"><label for="sn-${p.id}">Sendico-Nr.</label><input id="sn-${p.id}" type="text" placeholder="optional"></div>
          <div class="field"><label for="jp-${p.id}">Bezahlt in ¥</label><input id="jp-${p.id}" type="number" value="${Number(p.priceJPY) * Number(p.qty) + Number(p.domesticJPY || 0)}"></div>
          <button class="btn s" data-buy="${p.id}" type="button">Gekauft</button>
          <button class="btn secondary s" data-na="${p.id}" type="button">Nicht verfügbar</button></div>` : ''}
      </div>`).join('')}</div>`).join('')}
    ${waitTransfer.length ? `<h2 style="font-size:22px;margin-top:28px">Warten auf Überweisung</h2>${waitTransfer.map((o) => `<div class="card" style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><span><strong>${esc(o.id)}</strong> · ${esc(o.name)} · ${eur(o.gross)} · seit ${dt(o.createdAt)}</span><button class="btn s" data-paid="${o.id}" type="button">Zahlung ist eingegangen</button></div>`).join('')}` : ''}`;
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link kopiert'); } catch (e) { toast('Kopieren nicht möglich', true); } }));
  $$('[data-buy]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.buy; act('purchasePosition', { positionId: id, sendicoNo: $(`#sn-${CSS.escape(id)}`).value.trim(), actualPriceJPY: Number($(`#jp-${CSS.escape(id)}`).value) }, 'Als gekauft markiert'); }));
  $$('[data-na]').forEach((b) => b.addEventListener('click', () => act('purchasePosition', { positionId: b.dataset.na, unavailable: true }, 'Als nicht verfügbar markiert')));
  $$('[data-paid]').forEach((b) => b.addEventListener('click', () => act('markTransferPaid', { orderId: b.dataset.paid }, 'Zahlung verbucht – jetzt kaufen')));
}

// ---------- Japan & Kiste ----------
function lager() {
  const ready = S.positions.filter((p) => p.status === 'gekauft' && !p.shipmentId);
  const orders = [...new Set(ready.map((p) => p.orderId))];
  const min = Number(S.params.mindestmenge_sendung);
  view.innerHTML = `<h1 style="font-size:32px">Japan &amp; Kiste</h1>
    <div class="card"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <div><h3 style="margin:0">Im Lager bei Sendico</h3><p class="muted" style="margin:4px 0 0">${ready.length} Artikel aus ${orders.length} Aufträgen · Stichtag ${date(S.cutoff.cutoff)} · Mindestmenge ${min} Aufträge</p></div>
      <button class="btn" id="mk" type="button" ${ready.length ? '' : 'disabled'}>Sammelsendung bilden</button></div>
      ${orders.length && orders.length < min ? `<p class="note" style="margin:14px 0 0">Erst ${orders.length} von ${min} Aufträgen. Laut Regel wartet die Kiste bis zum nächsten Stichtag (höchstens einen Monat).</p>` : ''}
      ${ready.length ? `<div class="scroll" style="margin-top:12px"><table class="t"><thead><tr><th>Position</th><th>Artikel</th><th>Sendico-Nr.</th><th class="n">Gewicht</th><th class="n">Ware</th></tr></thead><tbody>
        ${ready.map((p) => `<tr><td>${esc(p.id)}</td><td>${esc(p.title || p.type)}</td><td>${esc(p.sendicoNo || '–')}</td><td class="n">${Number(p.weightKg).toFixed(2)} kg</td><td class="n">${eur(p.actualGoodsEUR)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>
    <h2 style="font-size:22px">Sammelsendungen</h2>
    ${S.shipments.slice().reverse().map((s) => `<div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h3 style="margin:0">${esc(s.id)}</h3><span class="tag ${s.status === 'angekommen' ? 'ok' : s.status === 'unterwegs' ? 'blue' : 'warn'}">${esc(s.status)}</span></div>
      <p class="small muted" style="margin:6px 0 12px">${s.positionsCount} Artikel · ${s.ordersCount} Aufträge · ${Number(s.weightKg).toFixed(2)} kg · Ware ${eur(s.goodsEUR)} · Logistik kalkuliert ${eur(s.kalkLogisticsEUR)}${s.istLogisticsEUR !== '' ? ` · tatsächlich ${eur(s.istLogisticsEUR)} · <strong style="color:${Number(s.deltaEUR) >= 0 ? 'var(--ok)' : 'var(--hanko-dark)'}">${Number(s.deltaEUR) >= 0 ? 'Puffer ' : 'Mehrkosten '}${eur(Math.abs(s.deltaEUR))}</strong>` : ''}</p>
      ${s.status === 'offen' ? `<p class="small">Bei Sendico alle Artikel dieser Liste in ein Paket packen lassen und verschicken. Dann hier eintragen:</p>
        <div class="formrow">
          <div class="field"><label for="c-${s.id}">Kurier</label><input id="c-${s.id}" type="text" value="FedEx Economy (Sendico)"></div>
          <div class="field"><label for="tr-${s.id}">Sendungsnummer</label><input id="tr-${s.id}" type="text"></div>
          <div class="field"><label for="kg-${s.id}">Gewicht kg</label><input id="kg-${s.id}" type="number" step="0.01" value="${s.weightKg}"></div>
          <div class="field"><label for="fr-${s.id}">Fracht in ¥</label><input id="fr-${s.id}" type="number"></div>
          <button class="btn s" data-send="${s.id}" type="button">Ist losgeschickt</button></div>` : ''}
      ${s.status === 'unterwegs' ? `<p class="small">Kiste angekommen? Werte aus der Kurier-Rechnung eintragen:</p>
        <div class="formrow">
          <div class="field"><label for="du-${s.id}">Zoll €</label><input id="du-${s.id}" type="number" step="0.01" value="0"></div>
          <div class="field"><label for="eu-${s.id}">Einfuhrumsatzsteuer €</label><input id="eu-${s.id}" type="number" step="0.01" value="0"></div>
          <div class="field"><label for="cl-${s.id}">Verzollungsgebühr €</label><input id="cl-${s.id}" type="number" step="0.01" value="15"></div>
          <div class="field"><label for="ot-${s.id}">Sonstiges €</label><input id="ot-${s.id}" type="number" step="0.01" value="0"></div>
          <button class="btn s" data-arrive="${s.id}" type="button">Ist angekommen</button></div>` : ''}
    </div>`).join('') || '<p class="muted">Noch keine Sammelsendung.</p>'}`;
  const mk = $('#mk'); if (mk) mk.addEventListener('click', () => act('createShipment', {}, 'Sammelsendung gebildet'));
  $$('[data-send]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.send; const v = (k) => $(`#${k}-${CSS.escape(id)}`).value; act('sendShipment', { shipmentId: id, carrier: v('c'), trackingNo: v('tr'), weightKg: Number(v('kg')), freightJPY: Number(v('fr')), rate: S.fx.rate }, 'Als unterwegs markiert, Kunden informiert'); }));
  $$('[data-arrive]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.arrive; const v = (k) => Number($(`#${k}-${CSS.escape(id)}`).value) || 0; act('arriveShipment', { shipmentId: id, dutyEUR: v('du'), eustEUR: v('eu'), clearanceEUR: v('cl'), otherEUR: v('ot') }, 'Angekommen, Kosten verteilt'); }));
}

// ---------- Ankunft & Versand ----------
function eingang() {
  const ready = S.orders.filter((o) => o.status === 'angekommen');
  view.innerHTML = `<h1 style="font-size:32px">Ankunft &amp; Versand</h1>
    <div class="card"><label for="scan">Scannen oder eintippen: Sendico-Nr. oder Positionsnummer</label>
      <div class="formrow"><div class="field"><input id="scan" type="text" placeholder="z. B. Z-160637 oder T-2026-0004-1" autocomplete="off"></div><button class="btn s" id="scanbtn" type="button">Abhaken</button></div>
      <p class="hint">Jeder abgehakte Artikel ist geprüft. Sind alle Artikel einer Bestellung abgehakt, kannst du sie versenden.</p></div>
    ${ready.length ? '' : '<div class="card"><p style="margin:0">Nichts zu versenden.</p></div>'}
    ${ready.map((o) => {
      const pos = S.positions.filter((p) => p.orderId === o.id && p.status === 'angekommen');
      const all = pos.every((p) => p.checked === 'ja');
      return `<div class="card">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h3 style="margin:0">${esc(o.id)} · ${esc(o.name)}</h3><span class="small muted">${esc(o.zip)} ${esc(o.city)} (${esc(o.country)}) · Versand ${eur(o.shipping)}</span></div>
        ${pos.map((p) => `<label class="check" style="padding:8px 0"><input type="checkbox" data-chk="${p.id}" ${p.checked === 'ja' ? 'checked' : ''}><span><strong>${esc(p.title || p.type)}</strong> · ${esc(p.id)} · Sendico ${esc(p.sendicoNo || '–')}</span></label>`).join('')}
        <div class="formrow" style="margin-top:10px">
          <button class="btn secondary s" data-label="${o.id}" type="button">Adressetikett drucken</button>
          <div class="field"><label for="tn-${o.id}">Sendungsnummer</label><input id="tn-${o.id}" type="text" placeholder="DHL-Sendungsnummer"></div>
          <button class="btn s" data-ship="${o.id}" type="button" ${all ? '' : 'disabled'}>Versendet</button></div>
        ${all ? '' : '<p class="hint">Erst alle Artikel abhaken.</p>'}
      </div>`;
    }).join('')}`;
  const doScan = () => { const v = $('#scan').value.trim(); if (v) act('togglePositionChecked', { positionId: v }, `${v} abgehakt`); };
  $('#scanbtn').addEventListener('click', doScan);
  $('#scan').addEventListener('keydown', (e) => { if (e.key === 'Enter') doScan(); });
  $$('[data-chk]').forEach((c) => c.addEventListener('change', () => act('togglePositionChecked', { positionId: c.dataset.chk, value: c.checked })));
  $$('[data-ship]').forEach((b) => b.addEventListener('click', () => act('shipOrder', { orderId: b.dataset.ship, trackingNo: $(`#tn-${CSS.escape(b.dataset.ship)}`).value.trim() }, 'Versendet, Rechnung erstellt, Kunde informiert')));
  $$('[data-label]').forEach((b) => b.addEventListener('click', () => {
    const o = S.orders.find((x) => x.id === b.dataset.label);
    const html = `<html><head><title>Etikett ${esc(o.id)}</title></head><body style="font-family:Arial;padding:24px"><div style="border:2px solid #000;padding:20px;width:360px">
      <div style="font-size:12px">Absender: ${esc(S.params.marke_name)}, ${esc(S.params.firma_inhaber)}, ${esc(S.params.firma_strasse)}, ${esc(S.params.firma_plz_ort)}</div>
      <div style="font-size:20px;margin-top:18px;line-height:1.4"><b>${esc(o.name)}</b><br>${esc(o.street)}<br>${esc(o.zip)} ${esc(o.city)}<br>${esc(o.country)}</div>
      <div style="margin-top:18px;font-size:13px">Bestellung ${esc(o.id)}</div></div><p style="font-size:12px;color:#666">Vorlage. Echte DHL-Etiketten kommen später direkt über das DHL-Geschäftskundenkonto.</p></body></html>`;
    if (api.isDemo()) { api.openHtml(html, 'Adressetikett'); return; }
    const w = window.open('', '_blank'); if (!w) return;
    w.document.write(html.replace('</body>', '<script>print()<\/script></body>'));
    w.document.close();
  }));
}

// ---------- Bestellungen ----------
function bestellungen() {
  const open = new URLSearchParams(location.hash.split('?')[1] || '').get('id');
  view.innerHTML = `<h1 style="font-size:32px">Bestellungen</h1>
    <div class="card scroll"><table class="t"><thead><tr><th>Nr.</th><th>Datum</th><th>Kunde</th><th>Status</th><th>Zahlung</th><th class="n">Brutto</th><th class="n">Ergebnis</th><th></th></tr></thead><tbody>
    ${S.orders.slice().reverse().map((o) => { const pr = S.profits[o.id]; return `<tr><td><strong>${esc(o.id)}</strong></td><td>${dt(o.createdAt)}</td><td>${esc(o.name)}<br><span class="small muted">${esc(o.country)}</span></td><td>${statusTag(o.status)}</td><td class="small">${esc(o.paymentMethod)}<br>${esc(o.paymentStatus)}</td><td class="n">${eur(o.capturedGross || o.gross)}</td><td class="n">${pr && pr.final ? eur(pr.profit) : '<span class="muted">offen</span>'}</td><td><button class="btn ghost s" data-open="${o.id}" type="button">Details</button></td></tr>`; }).join('') || '<tr><td colspan="8">Noch keine Bestellungen.</td></tr>'}
    </tbody></table></div><div id="detail"></div>`;
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => detail(b.dataset.open)));
  if (open) detail(open);
}
function detail(id) {
  const o = S.orders.find((x) => x.id === id); const pr = S.profits[id];
  const pos = S.positions.filter((p) => p.orderId === id);
  $('#detail').innerHTML = `<div class="card" id="d-card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h2 style="font-size:24px;margin:0">${esc(o.id)}</h2>${statusTag(o.status)}</div>
    <p class="small muted">${esc(o.name)} · ${esc(o.email)} · ${esc(o.street)}, ${esc(o.zip)} ${esc(o.city)}, ${esc(o.country)}</p>
    <div class="scroll"><table class="t"><thead><tr><th>Pos.</th><th>Artikel</th><th>Status</th><th class="n">¥</th><th class="n">Kunde brutto</th><th class="n">Ware ist</th><th class="n">Logistik ist</th></tr></thead><tbody>
    ${pos.map((p) => `<tr><td>${esc(p.id)}</td><td>${esc(p.title || p.type)}<br><a class="small" href="${esc(p.url)}" target="_blank" rel="noopener">Angebot</a></td><td>${posTag(p.status)}</td><td class="n">${jpy(p.priceJPY)}</td><td class="n">${eur(p.grossPriceEUR)}</td><td class="n">${p.actualGoodsEUR !== '' ? eur(p.actualGoodsEUR) : '–'}</td><td class="n">${p.actualLogisticsEUR !== '' ? eur(p.actualLogisticsEUR) : '–'}</td></tr>`).join('')}</tbody></table></div>
    <div class="split" style="margin-top:14px"><div><h3>Kalkulation</h3><dl class="small" style="display:grid;grid-template-columns:1fr auto;gap:4px 12px;margin:0">
      <dt>Warenwert</dt><dd>${eur(o.goodsTotal)}</dd><dt>Import (kalk.)</dt><dd>${eur(o.importCost)}</dd><dt>Servicegebühr</dt><dd>${eur(o.serviceFee)}</dd><dt>Versand</dt><dd>${eur(o.shipping)}</dd><dt>Netto</dt><dd>${eur(o.net)}</dd><dt>USt</dt><dd>${eur(o.vat)}</dd><dt><strong>Brutto</strong></dt><dd><strong>${eur(o.gross)}</strong></dd><dt>Vergleich allein</dt><dd>${eur(o.solo)}</dd></dl></div>
    <div><h3>Ergebnis ${pr.final ? '' : '(vorläufig)'}</h3><dl class="small" style="display:grid;grid-template-columns:1fr auto;gap:4px 12px;margin:0">
      <dt>Erlös netto</dt><dd>${eur(pr.revenueNet)}</dd><dt>− Ware</dt><dd>${eur(pr.goods)}</dd><dt>− Sendico</dt><dd>${eur(pr.sendico)}</dd><dt>− Logistik</dt><dd>${eur(pr.logistics)}</dd><dt>− Zahlungsgebühr</dt><dd>${eur(pr.payment)}</dd><dt>− Porto</dt><dd>${eur(pr.shipping)}</dd><dt><strong>Ergebnis</strong></dt><dd><strong>${eur(pr.profit)}</strong></dd></dl></div></div>
    <div class="formrow" style="margin-top:16px">
      ${o.invoiceId ? `<button class="btn secondary s" data-inv="${o.invoiceId}" type="button">Rechnung ${esc(o.invoiceId)}</button>` : ''}
      <a class="btn secondary s" href="../status.html?b=${o.token}" target="_blank">Kundenansicht</a>
      ${o.status === 'versendet' ? `<button class="btn secondary s" data-ret="${o.id}" type="button">Widerruf buchen</button>` : ''}
    </div></div>`;
  $$('[data-inv]').forEach((b) => b.addEventListener('click', () => api.openAdminInvoice(b.dataset.inv)));
  $$('[data-ret]').forEach((b) => confirmClick(b, 'Wirklich? Nochmal tippen', () => act('returnOrder', { orderId: b.dataset.ret }, 'Gutschrift erstellt (Warenwert ohne Versand)')));
  $('#d-card').scrollIntoView({ behavior: 'smooth' });
}

// ---------- Buchhaltung ----------
function buchhaltung() {
  view.innerHTML = `<h1 style="font-size:32px">Buchhaltung</h1>
    <p class="note info">Kontenvorschlag SKR03 und Steuerlogik sind ein Entwurf. Bitte mit der Steuerberaterin abstimmen, vor allem Anzahlungen (Mindest-Ist-Versteuerung), §13b für die Sendico-Gebühren und OSS.</p>
    <div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><h3 style="margin:0">Umsatzsteuer je Monat</h3><button class="btn secondary s" id="datev" type="button">Buchungsstapel (CSV) herunterladen</button></div>
      <div class="scroll"><table class="t" style="margin-top:10px"><thead><tr><th>Monat</th><th class="n">Umsatz netto</th><th class="n">USt</th><th class="n">EUSt (Vorsteuer)</th><th class="n">§13b Bemessung</th><th class="n">Zahllast</th></tr></thead><tbody>
      ${S.ustva.map((m) => `<tr><td>${m.monat}</td><td class="n">${eur(m.umsatz19Netto)}</td><td class="n">${eur(m.ust)}</td><td class="n">${eur(m.eust)}</td><td class="n">${eur(m.p13b)}</td><td class="n"><strong>${eur(m.zahllast)}</strong></td></tr>`).join('') || '<tr><td colspan="6">Noch keine Buchungen.</td></tr>'}</tbody></table></div>
      <p class="hint">USt entsteht mit dem Zahlungseingang (Anzahlung), nicht erst mit dem Versand. §13b: Umsatzsteuer und Vorsteuer heben sich auf, müssen aber gemeldet werden.</p></div>
    <div class="card"><h3>Nachkalkulation je Sammelsendung</h3><div class="scroll"><table class="t"><thead><tr><th>Sendung</th><th class="n">Aufträge</th><th class="n">Ware</th><th class="n">Logistik kalk.</th><th class="n">Logistik ist</th><th class="n">Differenz</th><th class="n">EUSt</th></tr></thead><tbody>
      ${S.shipments.map((s) => `<tr><td>${esc(s.id)}</td><td class="n">${s.ordersCount}</td><td class="n">${eur(s.goodsEUR)}</td><td class="n">${eur(s.kalkLogisticsEUR)}</td><td class="n">${s.istLogisticsEUR !== '' ? eur(s.istLogisticsEUR) : '–'}</td><td class="n">${s.deltaEUR !== '' ? `<strong style="color:${Number(s.deltaEUR) >= 0 ? 'var(--ok)' : 'var(--hanko-dark)'}">${eur(s.deltaEUR)}</strong>` : '–'}</td><td class="n">${s.eustEUR !== '' ? eur(s.eustEUR) : '–'}</td></tr>`).join('') || '<tr><td colspan="7">Noch keine Sendung.</td></tr>'}</tbody></table></div>
      <p class="hint">Negativ heißt: Die Kiste war teurer als kalkuliert. Dann Parameter „Fracht je kg“ oder „Fixkosten je Sendung“ anpassen.</p></div>
    <div class="card"><h3>Rechnungen und Gutschriften</h3><div class="scroll"><table class="t"><thead><tr><th>Nr.</th><th>Datum</th><th>Kunde</th><th>Typ</th><th class="n">Netto</th><th class="n">USt</th><th class="n">Brutto</th><th></th></tr></thead><tbody>
      ${S.invoices.slice().reverse().map((i) => `<tr><td>${esc(i.id)}</td><td>${dt(i.date)}</td><td>${esc(i.customer)}</td><td>${esc(i.kind)}</td><td class="n">${eur(i.net)}</td><td class="n">${eur(i.vat)}</td><td class="n">${eur(i.gross)}</td><td><button class="btn ghost s" data-inv="${i.id}" type="button">Öffnen</button></td></tr>`).join('') || '<tr><td colspan="8">Noch keine Rechnung.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h3>Journal (neueste 40 Buchungen)</h3><div class="scroll"><table class="t"><thead><tr><th>Datum</th><th>Beleg</th><th>Text</th><th>Soll</th><th>Haben</th><th class="n">Betrag</th><th>Steuer</th></tr></thead><tbody>
      ${S.journal.slice(-40).reverse().map((j) => `<tr><td>${dt(j.date)}</td><td>${esc(j.beleg)}</td><td>${esc(j.text)}</td><td>${j.soll}</td><td>${j.haben}</td><td class="n">${eur(j.amount)}</td><td class="small">${esc(j.taxKey)}</td></tr>`).join('') || '<tr><td colspan="7">Noch keine Buchungen.</td></tr>'}</tbody></table></div></div>`;
  $('#datev').addEventListener('click', () => api.downloadDatev());
  $$('[data-inv]').forEach((b) => b.addEventListener('click', () => api.openAdminInvoice(b.dataset.inv)));
}

// ---------- Postausgang ----------
function post() {
  view.innerHTML = `<h1 style="font-size:32px">Postausgang</h1><p class="muted">Jede E-Mail an Kunden. ${api.isDemo() ? 'In der Vorschau werden sie nur gespeichert, nicht verschickt.' : 'Solange kein E-Mail-Versand eingerichtet ist, werden sie nur gespeichert.'}</p>
    <div class="card scroll"><table class="t"><thead><tr><th>Datum</th><th>An</th><th>Betreff</th><th></th></tr></thead><tbody>
    ${S.outbox.slice().reverse().map((m) => `<tr><td>${dt(m.date)}</td><td>${esc(m.to)}</td><td>${esc(m.subject)}</td><td><button class="btn ghost s" data-mail="${m.id}" type="button">Ansehen</button></td></tr>`).join('') || '<tr><td colspan="4">Noch keine E-Mails.</td></tr>'}</tbody></table></div>`;
  $$('[data-mail]').forEach((b) => b.addEventListener('click', () => api.openMail(b.dataset.mail)));
}

// ---------- Einstellungen ----------
function einstellungen() {
  view.innerHTML = `<h1 style="font-size:32px">Einstellungen</h1>
    <div class="card"><h3>Preise, Gebühren und Regeln</h3><p class="small muted">Gleiche Werte wie im Excel-Blatt „Parameter“. Prozentwerte als Dezimalzahl (0,05 = 5 %).</p>
      <form id="pf"><div class="params">${DEFAULT_PARAMS.map(([k, , unit, desc]) => `<div class="field"><label for="p-${k}">${esc(k)}${unit ? ` (${esc(unit)})` : ''}</label><input id="p-${k}" name="${k}" type="text" value="${esc(S.params[k])}">${desc ? `<div class="hint">${esc(desc)}</div>` : ''}</div>`).join('')}</div>
      <button class="btn" type="submit" style="margin-top:16px">Speichern</button></form></div>
    <div class="card"><h3>Testdaten</h3><p>${api.isDemo() ? 'Spielt sechs Beispielbestellungen durch alle Schritte, damit jede Ansicht etwas zeigt.' : 'Achtung: überschreibt alle Bestellungen, Rechnungen und Buchungen in der Excel-Datenbank. Nur vor dem echten Start benutzen.'}</p>
      <div class="formrow"><button class="btn secondary s" id="seed" type="button">Beispieldaten laden</button><button class="btn secondary s" id="reset" type="button">Alles leeren</button></div></div>
    <div class="card"><h3>Anbindungen</h3><p class="small" style="margin:0">PayPal: <strong>${esc(S.payments.paypal)}</strong> · Stripe: <strong>${esc(S.payments.stripe)}</strong><br>Zugangsdaten, Push-Benachrichtigung (ntfy) und Passwort stehen in der Datei <code>.env</code>. Anleitung: <code>ANLEITUNG.md</code>.</p></div>`;
  $('#pf').addEventListener('submit', (e) => { e.preventDefault(); const changes = Object.fromEntries(new FormData(e.target).entries()); act('updateParams', { changes }, 'Gespeichert'); });
  confirmClick($('#seed'), 'Ersetzt alle Daten. Nochmal tippen', () => act('seedDemo', {}, 'Beispieldaten geladen'));
  confirmClick($('#reset'), 'Löscht alles. Nochmal tippen', () => act('resetDemo', {}, 'Geleert'));
}

load().catch((e) => { view.innerHTML = `<div class="card"><h2>Verwaltung nicht erreichbar</h2><p>${esc(e.message)}</p></div>`; });
