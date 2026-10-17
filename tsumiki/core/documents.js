// Tsumiki V1.0 – Rechnung (HTML, druckbar) und E-Mail-Texte
import { fmtEUR, fmtDate } from './pricing.js';
import { EU_COUNTRIES } from './params.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => `${Math.round(Number(x) * 1000) / 10} %`;

export function invoiceHtml(inv, order, params) {
  const lines = JSON.parse(inv.linesJson || '[]');
  const isCredit = inv.kind === 'Gutschrift';
  const land = EU_COUNTRIES[order.country] ? EU_COUNTRIES[order.country][0] : order.country;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(inv.id)}</title>
<style>
body{font-family:'Albert Sans',system-ui,sans-serif;color:#17171A;margin:0;background:#fff}
.page{max-width:780px;margin:0 auto;padding:48px 40px}
h1{font-size:26px;margin:0 0 4px}.muted{color:#5C5C63}.row{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}
table{width:100%;border-collapse:collapse;margin-top:28px;font-size:14px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #E4E1DB;vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#5C5C63}td.n,th.n{text-align:right;white-space:nowrap}
.tot td{border:0;padding:4px 6px}.grand td{font-weight:700;font-size:16px;border-top:2px solid #17171A;padding-top:10px}
.mark{display:inline-block;border:2px solid #B4341C;color:#B4341C;border-radius:6px;font-weight:900;padding:2px 7px;margin-right:8px}
.foot{margin-top:40px;font-size:12px;color:#5C5C63;line-height:1.6}
@media print{.noprint{display:none}}
</style></head><body><div class="page">
<p class="noprint"><button onclick="window.print()">Drucken / als PDF speichern</button></p>
<div class="row"><div><span class="mark">積</span><strong>${esc(params.marke_name)}</strong><div class="muted">${esc(params.firma_inhaber)} · ${esc(params.firma_strasse)} · ${esc(params.firma_plz_ort)}</div></div>
<div class="muted" style="text-align:right">${esc(params.firma_email)}<br>${esc(params.firma_ustid)}</div></div>
<div style="margin-top:36px">${esc(order.name)}<br>${esc(order.street)}<br>${esc(order.zip)} ${esc(order.city)}<br>${esc(land)}</div>
<div class="row" style="margin-top:32px;align-items:flex-end"><div><h1>${isCredit ? 'Gutschrift' : 'Rechnung'} ${esc(inv.id)}</h1>
<div class="muted">Bestellung ${esc(order.id)}${inv.refInvoice ? ' · zu Rechnung ' + esc(inv.refInvoice) : ''}</div></div>
<div class="muted" style="text-align:right">Rechnungsdatum: ${fmtDate(inv.date)}<br>Lieferdatum: ${fmtDate(inv.serviceDate)}</div></div>
<table><thead><tr><th>Pos.</th><th>Beschreibung</th><th class="n">Netto</th></tr></thead><tbody>
${lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.text)}${l.sub ? `<div class="muted" style="font-size:12px">${esc(l.sub)}</div>` : ''}</td><td class="n">${fmtEUR(l.net)}</td></tr>`).join('')}
</tbody></table>
<table style="width:auto;margin-left:auto;margin-top:12px">
<tr class="tot"><td>Summe netto</td><td class="n">${fmtEUR(inv.net)}</td></tr>
<tr class="tot"><td>Umsatzsteuer ${pct(inv.vatRate)}${order.country !== 'DE' && Number(params.oss_aktiv) === 1 ? ` (${esc(land)})` : ''}</td><td class="n">${fmtEUR(inv.vat)}</td></tr>
<tr class="grand"><td>${isCredit ? 'Gutschriftbetrag' : 'Gesamtbetrag'}</td><td class="n">${fmtEUR(inv.gross)}</td></tr></table>
<p style="margin-top:24px">${isCredit ? 'Der Betrag wird auf dem ursprünglichen Zahlungsweg erstattet.' : 'Der Betrag wurde bereits bezahlt (' + esc(order.paymentMethod) + '). Vielen Dank!'}</p>
<div class="foot">Die Ware wurde im Auftrag des Kunden in Japan eingekauft (Einkaufskommission) und gebündelt eingeführt. Einfuhrabgaben sind im Preis enthalten.<br>
${esc(params.firma_inhaber)} · ${esc(params.firma_strasse)} · ${esc(params.firma_plz_ort)} · ${esc(params.firma_ustid)} · IBAN ${esc(params.firma_iban)}</div>
</div></body></html>`;
}

const wrap = (params, title, body, cta) => `<div style="font-family:Arial,sans-serif;max-width:560px;color:#17171A;line-height:1.55">
<p style="font-weight:900;font-size:18px;margin:0 0 18px"><span style="border:2px solid #B4341C;color:#B4341C;border-radius:5px;padding:0 5px;margin-right:6px">積</span>${esc(params.marke_name)}</p>
<h2 style="font-size:20px;margin:0 0 12px">${esc(title)}</h2>${body}
${cta ? `<p style="margin:22px 0"><a href="${esc(cta.href)}" style="background:#B4341C;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">${esc(cta.label)}</a></p>` : ''}
<p style="color:#5C5C63;font-size:13px;margin-top:28px">${esc(params.marke_name)} · ${esc(params.firma_inhaber)} · ${esc(params.firma_plz_ort)}</p></div>`;

export function mail(kind, order, ctx) {
  const { params, baseUrl = '', positions = [], extra = {} } = ctx;
  const statusUrl = `${baseUrl}/status.html?b=${order.token}`;
  const list = positions.map((p) => `<li>${esc(p.title || p.platform)} – ${fmtEUR(p.grossPriceEUR)}</li>`).join('');
  const T = {
    eingang: ['Deine Bestellung ist eingegangen', `<p>Hallo ${esc(order.name)},</p><p>danke für deine Bestellung <strong>${esc(order.id)}</strong>. Wir kaufen deine Artikel in den nächsten Stunden in Japan. Den Betrag von <strong>${fmtEUR(order.gross)}</strong> haben wir nur vorgemerkt – abgebucht wird erst, wenn unser Kauf geklappt hat.</p><ul>${list}</ul>`],
    ueberweisung: ['Bitte überweise den Betrag', `<p>Hallo ${esc(order.name)},</p><p>bitte überweise <strong>${fmtEUR(order.gross)}</strong> an:<br>${esc(params.firma_inhaber)}<br>IBAN ${esc(params.firma_iban)}<br>Verwendungszweck: <strong>${esc(order.id)}</strong></p><p>Sobald das Geld da ist, kaufen wir für dich ein. Ist ein Artikel bis dahin weg, erstatten wir den Betrag sofort.</p>`],
    gekauft: ['Gekauft! Deine Artikel liegen in Japan bereit', `<p>Hallo ${esc(order.name)},</p><p>wir haben für dich gekauft. Abgebucht wurden <strong>${fmtEUR(order.capturedGross)}</strong>.</p><ul>${list}</ul><p>Deine Artikel kommen mit der nächsten Kiste aus Japan${extra.delivery ? `, voraussichtlich bei dir ${esc(extra.delivery)}` : ''}.</p>`],
    teilweise: ['Ein Artikel war leider schon weg', `<p>Hallo ${esc(order.name)},</p><p>einer oder mehrere Artikel waren nicht mehr verfügbar. Wir haben nur die verfügbaren gekauft und <strong>${fmtEUR(order.capturedGross)}</strong> statt ${fmtEUR(order.authorizedGross)} abgebucht.</p><ul>${list}</ul>`],
    storniert: ['Leider war nichts mehr verfügbar', `<p>Hallo ${esc(order.name)},</p><p>deine Artikel waren beim Kauf schon weg. Es wurde <strong>nichts abgebucht</strong>${order.paymentMethod === 'ueberweisung' ? ' – deine Überweisung erstatten wir in den nächsten Tagen' : ''}. Schau gern nach Alternativen!</p>`],
    unterwegs: ['Deine Sammelsendung ist unterwegs', `<p>Hallo ${esc(order.name)},</p><p>die Kiste mit deinen Artikeln hat Japan verlassen. In etwa einer Woche ist sie in Wuppertal, dann packen wir sofort für dich.</p>`],
    versendet: ['Dein Paket ist auf dem Weg', `<p>Hallo ${esc(order.name)},</p><p>wir haben deine Bestellung verschickt. Sendungsnummer: <strong>${esc(order.trackingNo)}</strong>.</p><p>Deine Rechnung findest du auf deiner Bestellseite.</p>`],
    retoure: ['Dein Widerruf ist bearbeitet', `<p>Hallo ${esc(order.name)},</p><p>wir haben deine Rücksendung erhalten und erstatten <strong>${fmtEUR(extra.amount)}</strong>. Die Gutschrift findest du auf deiner Bestellseite.</p>`],
  };
  const [subject, body] = T[kind];
  return { subject: `${subject} (${order.id})`, html: wrap(params, subject, body, { href: statusUrl, label: 'Bestellung ansehen' }) };
}
