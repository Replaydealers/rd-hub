/**
 * Migration eBay_Transaktionen_2025 → PlattformImport_2026 (PIMP)
 * ─────────────────────────────────────────────────────────────
 * Ausführen in Airtable: Erweiterungen → „Scripting“ → Skript einfügen → Run.
 * (NICHT als Automation – dort fehlen createFieldAsync und die Bestätigungs-Buttons.)
 *
 * Ablauf:
 *   1. Analyse (schreibt nichts): Abgleich EB ↔ PIMP, Dubletten, Leerzeilen, Summenprüfung.
 *   2. Erst nach Klick auf „Migration ausführen“ wird geschrieben:
 *        - fehlende Felder in PIMP anlegen: PIMP_KIMP_Link, PIMP_VK25_Link, PIMP_EB_ID
 *        - EB-Zeilen, die es in PIMP schon gibt → nur Verknüpfungen + EB-ID übertragen
 *        - EB-Zeilen, die in PIMP fehlen → neu in PIMP anlegen (Processed = true!)
 *   Gelöscht wird NICHTS. eBay_Transaktionen_2025 bleibt bis zur Kontrolle bestehen.
 *
 * Idempotent: EB-Zeilen, deren EB_ID schon in PIMP_EB_ID steht, werden übersprungen.
 *
 * WICHTIG: Neue Zeilen bekommen PIMP_Processed = "true". Die Automation
 * „PIMP-Verarbeitung 15 Min“ fasst nur "false"/"clearing" an – sonst würden für
 * 2025-Bestellungen neue Verkauf_2026-Sätze entstehen.
 */

const T = {
    eb: 'eBay_Transaktionen_2025',
    pimp: 'PlattformImport_2026',
    kimp: 'KontoImport_2026',
    vk25: 'Verkauf_2025'
};
const NEUE_FELDER = [
    { name: 'PIMP_KIMP_Link', type: 'multipleRecordLinks', linkTo: T.kimp },
    { name: 'PIMP_VK25_Link', type: 'multipleRecordLinks', linkTo: T.vk25 },
    { name: 'PIMP_EB_ID', type: 'singleLineText' }
];
const BATCH = 50;

// ── Hilfsfunktionen ──────────────────────────────────────────
const s = (r, f) => (r.getCellValueAsString(f) || '').trim();
const num = (r, f) => { const v = r.getCellValue(f); return typeof v === 'number' ? v : null; };
const cent = v => (v === null || v === undefined) ? '' : (Math.round(v * 100) / 100).toFixed(2);
const datum = (r, f) => r.getCellValue(f) || '';   // Datumsfeld roh = ISO "YYYY-MM-DD"
const links = (r, f) => (r.getCellValue(f) || []).map(l => ({ id: l.id }));
const hatFeld = (tbl, name) => tbl.fields.some(f => f.name === name);

function keyStrikt(d) { return [d.datum, d.typ, d.order, cent(d.betrag), d.payout].join('|'); }
function keyLocker(d) { return [d.datum, d.typ, d.order, cent(d.betrag)].join('|'); }

function ebDaten(r) {
    return {
        rec: r,
        ebId: s(r, 'EB_ID'),
        datum: datum(r, 'EB_Datum'),
        typ: s(r, 'EB_Typ'),
        order: s(r, 'EB_Bestellnummer'),
        betrag: num(r, 'EB_Betrag'),
        payout: s(r, 'EB_Auszahlung_Nr'),
        payoutDatum: datum(r, 'EB_Auszahlung_Datum'),
        notiz: s(r, 'EB_Notizen'),
        kaeufer: s(r, 'EB_Kaeufername'),
        user: s(r, 'EB_Username'),
        titel: s(r, 'EB_Artikel_Ebay'),
        kimp: links(r, 'EB_KIMP_Link'),
        vk25: links(r, 'EB_VK25_Link'),
        // Diese Verknüpfungen sind laut Analyse leer – falls doch befüllt, wird abgebrochen.
        sonstigeLinks: ['EB_VK_Link', 'EB_BA_Link', 'EB_EK_Link', 'Kopie von Verkauf_2026']
            .reduce((n, f) => n + links(r, f).length, 0)
    };
}

function pimpDaten(r, mitEbId) {
    return {
        rec: r,
        datum: s(r, 'PIMP_TransactionDate').slice(0, 10),
        typ: s(r, 'PIMP_RowType'),
        order: s(r, 'PIMP_OrderId'),
        betrag: num(r, 'PIMP_AmountGross'),
        payout: s(r, 'PIMP_PayoutNo'),
        payoutDatum: s(r, 'PIMP_PayoutDate'),
        plattform: r.getCellValue('PIMP_Plattform')?.name || '',
        transactionKey: s(r, 'PIMP_TransactionKey'),
        ebId: mitEbId ? s(r, 'PIMP_EB_ID') : ''
    };
}

// ── 1. Laden ─────────────────────────────────────────────────
output.markdown('# Migration eBay_Transaktionen_2025 → PlattformImport_2026');
let tblEb = base.getTable(T.eb);
let tblPimp = base.getTable(T.pimp);
const pimpHatEbId = hatFeld(tblPimp, 'PIMP_EB_ID');

const ebQuery = await tblEb.selectRecordsAsync({ fields: [
    'EB_ID', 'EB_Datum', 'EB_Typ', 'EB_Bestellnummer', 'EB_Betrag', 'EB_Auszahlung_Nr',
    'EB_Auszahlung_Datum', 'EB_Notizen', 'EB_Kaeufername', 'EB_Username', 'EB_Artikel_Ebay',
    'EB_KIMP_Link', 'EB_VK25_Link', 'EB_VK_Link', 'EB_BA_Link', 'EB_EK_Link', 'Kopie von Verkauf_2026'
] });
const pimpFelder = ['PIMP_TransactionKey', 'PIMP_TransactionDate', 'PIMP_RowType', 'PIMP_OrderId',
    'PIMP_AmountGross', 'PIMP_PayoutNo', 'PIMP_PayoutDate', 'PIMP_Plattform'];
if (pimpHatEbId) pimpFelder.push('PIMP_EB_ID');
const pimpQuery = await tblPimp.selectRecordsAsync({ fields: pimpFelder });

const alleEb = ebQuery.records.map(ebDaten);
const leer = alleEb.filter(d => !d.typ && !d.datum && d.betrag === null && !d.order);
const eb = alleEb.filter(d => !leer.includes(d));
const pimp = pimpQuery.records.map(r => pimpDaten(r, pimpHatEbId));
const pimpEbay = pimp.filter(p => p.plattform === 'ebay');

if (eb.some(d => d.sonstigeLinks > 0)) {
    output.markdown('❌ **Abbruch:** EB-Zeilen mit Verknüpfungen zu VK/BA/EK gefunden – diese Felder sind im Skript nicht vorgesehen.');
    throw new Error('Unerwartete Verknüpfungen');
}

// ── 2. Abgleich (Multiset: jede PIMP-Zeile wird höchstens einmal verbraucht) ──
const schonMigriert = new Set(pimp.map(p => p.ebId).filter(Boolean));
const offen = eb.filter(d => !schonMigriert.has(d.ebId));

function baueIndex(liste, keyFn) {
    const m = new Map();
    for (const p of liste) { const k = keyFn(p); if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
    return m;
}
const verbraucht = new Set(pimp.filter(p => p.ebId).map(p => p.rec.id));
const paare = [];   // { eb, pimp, stufe }
let rest = offen;
for (const [stufe, keyFn] of [['strikt', keyStrikt], ['locker', keyLocker]]) {
    const idx = baueIndex(pimpEbay.filter(p => !verbraucht.has(p.rec.id)), keyFn);
    const nochOffen = [];
    for (const d of rest) {
        const kandidaten = (idx.get(keyFn(d)) || []).filter(p => !verbraucht.has(p.rec.id));
        if (kandidaten.length) { verbraucht.add(kandidaten[0].rec.id); paare.push({ eb: d, pimp: kandidaten[0], stufe }); }
        else nochOffen.push(d);
    }
    rest = nochOffen;
}
const neu = rest;

// PIMP-Zeilen aus 2025 ohne EB-Gegenstück (bleiben unverändert, nur Info)
const pimpNur2025 = pimpEbay.filter(p => p.datum.startsWith('2025') && !verbraucht.has(p.rec.id));

// Bestehende Dubletten in PIMP (gleicher TransactionKey mehrfach)
const tkZaehler = new Map();
for (const p of pimp) if (p.transactionKey) tkZaehler.set(p.transactionKey, (tkZaehler.get(p.transactionKey) || 0) + 1);
const pimpDubletten = [...tkZaehler].filter(([, n]) => n > 1);

// ── 3. Bericht ───────────────────────────────────────────────
const proTyp = {};
const zaehle = (typ, spalte, betrag) => {
    proTyp[typ] = proTyp[typ] || { Typ: typ, 'EB gesamt': 0, 'schon in PIMP': 0, 'neu nach PIMP': 0, 'Summe EB €': 0, 'Summe PIMP 2025 nachher €': 0 };
    proTyp[typ][spalte]++;
    if (spalte === 'EB gesamt') proTyp[typ]['Summe EB €'] += betrag || 0;
};
for (const d of eb) zaehle(d.typ || '(leer)', 'EB gesamt', d.betrag);
for (const p of paare) zaehle(p.eb.typ, 'schon in PIMP');
for (const d of neu) zaehle(d.typ, 'neu nach PIMP');
// Summenprobe: PIMP-2025 (ebay) nachher = bisherige PIMP-2025-Zeilen + neue EB-Zeilen
for (const p of pimpEbay.filter(p => p.datum.startsWith('2025'))) {
    proTyp[p.typ] = proTyp[p.typ] || { Typ: p.typ, 'EB gesamt': 0, 'schon in PIMP': 0, 'neu nach PIMP': 0, 'Summe EB €': 0, 'Summe PIMP 2025 nachher €': 0 };
    proTyp[p.typ]['Summe PIMP 2025 nachher €'] += p.betrag || 0;
}
for (const d of neu) proTyp[d.typ]['Summe PIMP 2025 nachher €'] += d.betrag || 0;
const tabelle = Object.values(proTyp).map(z => ({ ...z,
    'Summe EB €': cent(z['Summe EB €']), 'Summe PIMP 2025 nachher €': cent(z['Summe PIMP 2025 nachher €']),
    'Probe': cent(z['Summe EB €']) === cent(z['Summe PIMP 2025 nachher €']) ? '✅' : '⚠️' }));

output.markdown(`## Analyse
- EB-Zeilen gesamt: **${alleEb.length}**, davon komplett leer: **${leer.length}** (werden nicht übertragen)
- bereits früher migriert (PIMP_EB_ID gesetzt): **${eb.length - offen.length}**
- in PIMP schon vorhanden: **${paare.length}** (strikt: ${paare.filter(p => p.stufe === 'strikt').length}, ohne Auszahlungs-Nr.: ${paare.filter(p => p.stufe === 'locker').length}) → nur Verknüpfungen werden übertragen
- fehlen in PIMP: **${neu.length}** → werden neu angelegt
- PIMP-2025-Zeilen ohne EB-Gegenstück: **${pimpNur2025.length}** (bleiben unverändert)
- doppelte PIMP_TransactionKeys in PIMP: **${pimpDubletten.length}**
- zu übertragende Verknüpfungen: KontoImport ${eb.filter(d => d.kimp.length).length}, Verkauf_2025 ${eb.filter(d => d.vk25.length).length}`);
output.table(tabelle);
if (pimpNur2025.length) {
    output.markdown('### PIMP-2025-Zeilen ohne EB-Gegenstück (max. 50)');
    output.table(pimpNur2025.slice(0, 50).map(p => ({ id: p.rec.id, Datum: p.datum, Typ: p.typ, Order: p.order, Betrag: cent(p.betrag), Auszahlung: p.payout })));
}
if (pimpDubletten.length) {
    output.markdown('### Doppelte PIMP_TransactionKeys (max. 50) – werden NICHT automatisch gelöscht');
    output.table(pimpDubletten.slice(0, 50).map(([k, n]) => ({ TransactionKey: k, Anzahl: n })));
}

const wahl = await input.buttonsAsync('Migration jetzt ausführen?', [
    { label: 'Abbrechen', value: 'nein' },
    { label: 'Migration ausführen', value: 'ja', variant: 'danger' }
]);
if (wahl === 'ja') await ausfuehren();
else output.markdown('Abgebrochen – es wurde nichts geändert.');

async function ausfuehren() {
// ── 4. Felder anlegen ────────────────────────────────────────
for (const f of NEUE_FELDER) {
    if (hatFeld(tblPimp, f.name)) continue;
    const opts = f.type === 'multipleRecordLinks' ? { linkedTableId: base.getTable(f.linkTo).id } : null;
    await tblPimp.createFieldAsync(f.name, f.type, opts);
    output.markdown(`➕ Feld **${f.name}** angelegt`);
}
tblPimp = base.getTable(T.pimp);

// ── 5. Bestehende PIMP-Zeilen ergänzen ───────────────────────
const updates = paare.map(({ eb: d, pimp: p }) => {
    const fields = { 'PIMP_EB_ID': d.ebId };
    if (d.kimp.length) fields['PIMP_KIMP_Link'] = d.kimp;
    if (d.vk25.length) fields['PIMP_VK25_Link'] = d.vk25;
    if (!p.payoutDatum && d.payoutDatum) fields['PIMP_PayoutDate'] = d.payoutDatum;
    return { id: p.rec.id, fields };
});
for (let i = 0; i < updates.length; i += BATCH) await tblPimp.updateRecordsAsync(updates.slice(i, i + BATCH));
output.markdown(`✏️ ${updates.length} bestehende PIMP-Zeilen ergänzt`);

// ── 6. Fehlende Zeilen anlegen ───────────────────────────────
const jetzt = new Date().toISOString();
const creates = neu.map(d => {
    const fields = {
        'PIMP_TransactionKey': ['EB', d.ebId, d.datum, d.typ, d.order, cent(d.betrag)].join('|'),
        'PIMP_TransactionDate': d.datum,
        'PIMP_RowType': d.typ,
        'PIMP_Plattform': { name: 'ebay' },
        'PIMP_Processed': { name: 'true' },
        'PIMP_ProcessedAt': jetzt,
        'PIMP_Description': d.notiz,
        'PIMP_OrderId': d.order,
        'PIMP_BuyerUser': d.user,
        'PIMP_BuyerName': d.kaeufer,
        'PIMP_Title': d.titel,
        'PIMP_Currency': 'EUR',
        'PIMP_PayoutDate': d.payoutDatum,
        'PIMP_PayoutNo': d.payout,
        'PIMP_EB_ID': d.ebId
    };
    if (d.betrag !== null) {
        fields['PIMP_AmountGross'] = d.betrag;
        // Bei Bestellungen fehlen in EB die Gebühren → Netto unbekannt, bleibt leer.
        if (d.typ !== 'Bestellung') fields['PIMP_AmountNet'] = d.betrag;
    }
    if (d.kimp.length) fields['PIMP_KIMP_Link'] = d.kimp;
    if (d.vk25.length) fields['PIMP_VK25_Link'] = d.vk25;
    return { fields };
});
for (let i = 0; i < creates.length; i += BATCH) {
    await tblPimp.createRecordsAsync(creates.slice(i, i + BATCH));
    if (i % 1000 === 0) output.text(`… ${i + Math.min(BATCH, creates.length - i)} / ${creates.length} angelegt`);
}
output.markdown(`➕ ${creates.length} neue PIMP-Zeilen angelegt

## ✅ Fertig
eBay_Transaktionen_2025 wurde **nicht** verändert. Nach Kontrolle kann die Tabelle gelöscht werden.`);
}
