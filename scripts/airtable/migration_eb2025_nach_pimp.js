/**
 * Import eBay-Transaktionsbericht 2025 → PlattformImport_2026 (PIMP)
 * ─────────────────────────────────────────────────────────────
 * Ausführen in Airtable: Erweiterungen → „Scripting“ → Skript einfügen → Run.
 * (NICHT als Automation – dort fehlen Datei-Upload und Buttons.)
 *
 * Quelle der Daten: ebay_2025_fuer_pimp.json – aus dem eBay-Transaktionsbericht
 *   01.01.–31.12.2025 aufbereitet (eine Zeile pro Berichtszeile, fertige PIMP-Felder).
 * eBay_Transaktionen_2025 wird nur noch gelesen, um die Zuordnung Bestellung → Verkauf_2025
 *   zu übernehmen. Sie landet als echte Verknüpfung in PIMP_VK_2025.
 * Zusätzlich: Alle PIMP-Zeilen mit Text-Lot „VK26/…“ in PIMP_VK_Lot bekommen die passende
 *   Verknüpfung in PIMP_VK_2026 (Abgleich über VK_Lot in Verkauf_2026).
 * Die Verbindung zum Kontoimport läuft über die Auszahlungs-Nr.
 *   (PIMP_PayoutNo ↔ KIMP-Verwendungszweck „P.<Nr>“).
 * Voraussetzung: Verknüpfungsfelder PIMP_VK_2025 (→ Verkauf_2025) und PIMP_VK_2026 (→ Verkauf_2026).
 *
 * Ablauf:
 *   1. Analyse (schreibt nichts): Abgleich Bericht ↔ PIMP und Bericht ↔ EB, Summenprobe.
 *   2. Erst nach Klick auf „Import ausführen“:
 *        - Berichtszeilen, die in PIMP schon stehen → nur leeres PIMP_VK_2025 füllen
 *        - alle übrigen Berichtszeilen → neu in PIMP anlegen (Processed = true!)
 *        - leeres PIMP_VK_2026 aus dem Text-Lot „VK26/…“ füllen
 *   Gelöscht wird NICHTS.
 *
 * Idempotent: Zeilen, deren PIMP_TransactionKey („CSV25|…“) schon existiert, werden übersprungen.
 *
 * WICHTIG: Neue Zeilen bekommen PIMP_Processed = "true". Die Automation
 * „PIMP-Verarbeitung 15 Min“ fasst nur "false"/"clearing" an – sonst würden für
 * 2025-Bestellungen neue Verkauf_2026-Sätze entstehen.
 */

const T = {
    eb: 'eBay_Transaktionen_2025',
    pimp: 'PlattformImport_2026',
    vk26: 'Verkauf_2026'
};
// Zuordnungsfelder über Feld-ID → unempfindlich gegen Umbenennen in Airtable
const F_VK_LOT  = 'fldDLyYgaHskBU6tY'; // Text-Lot „VK26/…“ (aktuell „PIMP_VK“)
const F_VK_2025 = 'fldmM1JYkd9djKGZh'; // Verknüpfung → Verkauf_2025
const F_VK_2026 = 'fldQCizhd9RvD54bq'; // Verknüpfung → Verkauf_2026
const NUMMER_FELDER = ['PIMP_AmountGross', 'PIMP_AmountNet', 'PIMP_Shipping', 'PIMP_FeeSum', 'PIMP_Quantity'];
const BATCH = 50;

// ── Hilfsfunktionen ──────────────────────────────────────────
const s = (r, f) => (r.getCellValueAsString(f) || '').trim();
const num = (r, f) => { const v = r.getCellValue(f); return typeof v === 'number' ? v : null; };
const datum = (r, f) => r.getCellValue(f) || '';   // Datumsfeld roh = ISO "YYYY-MM-DD"
const cent = v => (v === null || v === undefined) ? '' : (Math.round(v * 100) / 100).toFixed(2);
const links = (r, f) => (r.getCellValue(f) || []).map(l => ({ id: l.id, name: l.name }));
const lotText = ls => ls.map(l => l.name).filter(Boolean).join(', ');

/** Multiset-Abgleich in mehreren Stufen: jede Zielzeile wird höchstens einmal vergeben. */
function abgleich(quellen, ziele, stufen) {
    const vergeben = new Set(), paare = new Map(), proStufe = {};
    let rest = quellen;
    for (const { name, q, z } of stufen) {
        const idx = new Map();
        for (const ziel of ziele) {
            if (vergeben.has(ziel)) continue;
            const k = z(ziel); if (k === null) continue;
            if (!idx.has(k)) idx.set(k, []);
            idx.get(k).push(ziel);
        }
        const nochOffen = [];
        for (const quelle of rest) {
            const k = q(quelle);
            const kand = k === null ? [] : (idx.get(k) || []).filter(x => !vergeben.has(x));
            if (kand.length) { vergeben.add(kand[0]); paare.set(quelle, kand[0]); proStufe[name] = (proStufe[name] || 0) + 1; }
            else nochOffen.push(quelle);
        }
        rest = nochOffen;
    }
    return { paare, rest, vergeben, proStufe };
}

// ── 1. Laden ─────────────────────────────────────────────────
output.markdown('# Import eBay-Transaktionsbericht 2025 → PlattformImport_2026');
const datei = await input.fileAsync('Datei „ebay_2025_fuer_pimp.json“ auswählen', { allowedFileTypes: ['.json', 'application/json'] });
const bericht = (datei.parsedContents || []).map((z, i) => {
    const f = z.f;
    return {
        i, f, ebBetrag: z.eb,
        datum: f.PIMP_TransactionDate, typ: f.PIMP_RowType, order: f.PIMP_OrderId || '',
        txn: f.PIMP_TransactionNo || '', payout: f.PIMP_PayoutNo || '',
        brutto: f.PIMP_AmountGross ?? null, netto: f.PIMP_AmountNet ?? null
    };
});
if (bericht.length < 1000 || bericht.some(z => !z.datum.startsWith('2025') || !z.f.PIMP_TransactionKey)) {
    output.markdown('❌ **Abbruch:** Datei sieht nicht nach dem aufbereiteten 2025-Bericht aus.');
    throw new Error('Falsche Datei');
}

const tblPimp = base.getTable(T.pimp);
const tblEb = base.getTable(T.eb);
for (const f of [F_VK_2025, F_VK_2026]) {
    if (!tblPimp.fields.some(x => x.id === f && x.type === 'multipleRecordLinks')) {
        output.markdown(`❌ **Abbruch:** Verknüpfungsfeld **${f}** (Verknüpfungsfeld) fehlt in ${T.pimp}.`);
        throw new Error('Feld fehlt: ' + f);
    }
}
const pimpFelder = ['PIMP_TransactionKey', 'PIMP_TransactionDate', 'PIMP_RowType', 'PIMP_OrderId',
    'PIMP_TransactionNo', 'PIMP_AmountGross', 'PIMP_PayoutNo', 'PIMP_Plattform', F_VK_LOT,
    F_VK_2025, F_VK_2026];
const vk26Query = await base.getTable(T.vk26).selectRecordsAsync({ fields: ['VK_Lot'] });
const pimpQuery = await tblPimp.selectRecordsAsync({ fields: pimpFelder });
const ebQuery = await tblEb.selectRecordsAsync({ fields: [
    'EB_ID', 'EB_Datum', 'EB_Typ', 'EB_Bestellnummer', 'EB_Betrag', 'EB_Auszahlung_Nr',
    'EB_KIMP_Link', 'EB_VK25_Link', 'EB_VK_Link', 'EB_BA_Link', 'EB_EK_Link', 'Kopie von Verkauf_2026'
] });

const pimp = pimpQuery.records.map(r => ({
    rec: r,
    key: s(r, 'PIMP_TransactionKey'),
    datum: s(r, 'PIMP_TransactionDate').slice(0, 10),
    typ: s(r, 'PIMP_RowType'),
    order: s(r, 'PIMP_OrderId'),
    txn: s(r, 'PIMP_TransactionNo'),
    brutto: num(r, 'PIMP_AmountGross'),
    payout: s(r, 'PIMP_PayoutNo'),
    plattform: r.getCellValue('PIMP_Plattform')?.name || '',
    vkLot: s(r, F_VK_LOT),
    hatVk25: links(r, F_VK_2025).length > 0,
    hatVk26: links(r, F_VK_2026).length > 0
}));
const pimpKeys = new Set(pimp.map(p => p.key));
const pimp2025 = pimp.filter(p => p.plattform === 'ebay' && p.datum.startsWith('2025') && !p.key.startsWith('CSV25|'));

const ebAlle = ebQuery.records.map(r => ({
    rec: r,
    ebId: s(r, 'EB_ID'),
    datum: datum(r, 'EB_Datum'),
    typ: s(r, 'EB_Typ'),
    order: s(r, 'EB_Bestellnummer'),
    betrag: num(r, 'EB_Betrag'),
    payout: s(r, 'EB_Auszahlung_Nr'),
    vk25: links(r, 'EB_VK25_Link'),
    sonstige: ['EB_VK_Link', 'EB_BA_Link', 'EB_EK_Link', 'Kopie von Verkauf_2026'].reduce((n, f) => n + links(r, f).length, 0)
}));
const ebLeer = ebAlle.filter(e => !e.typ && !e.datum && e.betrag === null && !e.order);
const eb = ebAlle.filter(e => !ebLeer.includes(e));
if (eb.some(e => e.sonstige > 0)) {
    output.markdown('❌ **Abbruch:** EB-Zeilen mit Verknüpfungen zu VK/BA/EK gefunden – im Skript nicht vorgesehen.');
    throw new Error('Unerwartete Verknüpfungen');
}

// ── 2a. Bericht ↔ vorhandene PIMP-2025-Zeilen ────────────────
const offen = bericht.filter(z => !pimpKeys.has(z.f.PIMP_TransactionKey));
const bereitsImportiert = bericht.length - offen.length;
const P = abgleich(offen, pimp2025, [
    { name: 'mit Transaktions-Nr.', q: z => z.txn ? [z.datum, z.typ, z.order, z.txn, z.payout].join('|') : null,
                                    z: p => p.txn ? [p.datum, p.typ, p.order, p.txn, p.payout].join('|') : null },
    { name: 'Betrag + Auszahlung', q: z => [z.datum, z.typ, z.order, cent(z.brutto), z.payout].join('|'),
                                   z: p => [p.datum, p.typ, p.order, cent(p.brutto), p.payout].join('|') },
    { name: 'Nettobetrag', q: z => [z.datum, z.typ, z.order, cent(z.netto), z.payout].join('|'),
                           z: p => [p.datum, p.typ, p.order, cent(p.brutto), p.payout].join('|') },
    { name: 'ohne Auszahlungs-Nr.', q: z => [z.datum, z.typ, z.order, cent(z.brutto)].join('|'),
                                    z: p => [p.datum, p.typ, p.order, cent(p.brutto)].join('|') }
]);
const pimpOhneBericht = pimp2025.filter(p => !P.vergeben.has(p));

// ── 2b. Bericht ↔ EB (nur für die Verknüpfungen) ─────────────
const E = abgleich(bericht, eb, [
    { name: 'mit Auszahlung', q: z => [z.datum, z.typ, z.order, cent(z.ebBetrag), z.payout].join('|'),
                              z: e => [e.datum, e.typ, e.order, cent(e.betrag), e.payout].join('|') },
    { name: 'ohne Auszahlung', q: z => [z.datum, z.typ, z.order, cent(z.ebBetrag)].join('|'),
                               z: e => [e.datum, e.typ, e.order, cent(e.betrag)].join('|') }
]);
const ebOhneBericht = eb.filter(e => !E.vergeben.has(e));
const ebLinksVerloren = ebOhneBericht.filter(e => e.vk25.length);
// Mehrdeutige Gruppen (gleicher Schlüssel) mit unterschiedlichen VK25-Zuordnungen → prüfen
const gruppen = new Map();
for (const e of eb) {
    const k = [e.datum, e.typ, e.order, cent(e.betrag), e.payout].join('|');
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(e);
}
const mehrdeutig = [...gruppen.values()].filter(g => g.length > 1 &&
    g.some(e => lotText(e.vk25) !== lotText(g[0].vk25)));
// Vorhandene PIMP-Zeilen mit VK26-Lot, die laut EB zusätzlich einem VK25 zugeordnet sind → Doppelbuchung?
const konflikte = [...P.paare].filter(([z, p]) => p.vkLot && E.paare.get(z)?.vk25.length && p.vkLot !== lotText(E.paare.get(z).vk25));

// ── 2c. Text-Lot „VK26/…“ → Verknüpfung PIMP_VK_2026 ─────────
const vk26ByLot = new Map(), vk26Doppelt = new Set();
for (const r of vk26Query.records) {
    const lot = s(r, 'VK_Lot'); if (!lot) continue;
    if (vk26ByLot.has(lot)) vk26Doppelt.add(lot);
    vk26ByLot.set(lot, r.id);
}
const vk26Offen = pimp.filter(p => !p.hatVk26 && p.vkLot.startsWith('VK26/'));
const vk26Treffer = vk26Offen.filter(p => vk26ByLot.has(p.vkLot) && !vk26Doppelt.has(p.vkLot));
const vk26Fehlt = vk26Offen.filter(p => !vk26ByLot.has(p.vkLot) || vk26Doppelt.has(p.vkLot));
const vkLotSonstige = pimp.filter(p => p.vkLot && !p.vkLot.startsWith('VK26/'));

// ── 3. Bericht ───────────────────────────────────────────────
const neu = P.rest;
const proTyp = {};
const zeile = typ => proTyp[typ] = proTyp[typ] || { Typ: typ, 'Bericht': 0, 'schon in PIMP': 0, 'neu': 0, 'Summe Bericht €': 0, 'Summe PIMP 2025 nachher €': 0 };
for (const z of bericht) { zeile(z.typ)['Bericht']++; proTyp[z.typ]['Summe Bericht €'] += z.brutto || 0; }
for (const z of P.paare.keys()) zeile(z.typ)['schon in PIMP']++;
for (const z of neu) { zeile(z.typ)['neu']++; proTyp[z.typ]['Summe PIMP 2025 nachher €'] += z.brutto || 0; }
for (const p of pimp2025) zeile(p.typ)['Summe PIMP 2025 nachher €'] += p.brutto || 0;
for (const p of pimp.filter(p => p.key.startsWith('CSV25|'))) zeile(p.typ)['Summe PIMP 2025 nachher €'] += p.brutto || 0;
output.markdown(`## Analyse
- Berichtszeilen: **${bericht.length}** (bereits mit diesem Skript importiert: ${bereitsImportiert})
- davon schon in PIMP vorhanden: **${P.paare.size}** – ${JSON.stringify(P.proStufe)} → werden nicht neu angelegt
- **neu anzulegen: ${neu.length}**
- PIMP-2025-Zeilen ohne Gegenstück im Bericht: **${pimpOhneBericht.length}** (Dubletten-Kandidaten, bleiben unverändert)
- EB: ${eb.length} Zeilen + ${ebLeer.length} leere; dem Bericht zugeordnet: **${E.paare.size}** – ${JSON.stringify(E.proStufe)}
- EB-Zeilen ohne Gegenstück im Bericht: **${ebOhneBericht.length}**, davon mit Verknüpfung (würde fehlen): **${ebLinksVerloren.length}**
- VK25-Zuordnungen, die als Verknüpfung PIMP_VK_2025 übernommen werden: ${[...E.paare.values()].filter(e => e.vk25.length).length} / ${eb.filter(e => e.vk25.length).length}
- PIMP_VK_2026 aus Text-Lot nachtragen: **${vk26Treffer.length}** (Lot nicht/doppelt in Verkauf_2026: **${vk26Fehlt.length}**, PIMP_VK mit anderem Format: ${vkLotSonstige.length})
- mehrdeutige EB-Gruppen mit unterschiedlichen VK25-Zuordnungen: **${mehrdeutig.length}**
- ⚠️ vorhandene PIMP-Zeilen mit VK26-Lot UND VK25-Zuordnung (mögliche Doppelbuchung): **${konflikte.length}**`);
output.table(Object.values(proTyp).map(z => ({ ...z,
    'Summe Bericht €': cent(z['Summe Bericht €']), 'Summe PIMP 2025 nachher €': cent(z['Summe PIMP 2025 nachher €']),
    'Probe': cent(z['Summe Bericht €']) === cent(z['Summe PIMP 2025 nachher €']) ? '✅' : '⚠️' })));
if (pimpOhneBericht.length) {
    output.markdown('### PIMP-2025-Zeilen ohne Gegenstück im Bericht (max. 50)');
    output.table(pimpOhneBericht.slice(0, 50).map(p => ({ id: p.rec.id, Datum: p.datum, Typ: p.typ, Order: p.order, Betrag: cent(p.brutto), Auszahlung: p.payout, VK_Lot: p.vkLot })));
}
if (konflikte.length) {
    output.markdown('### Mögliche Doppelbuchungen VK26 ↔ VK25 (werden NICHT verändert)');
    output.table(konflikte.map(([z, p]) => ({ id: p.rec.id, Datum: p.datum, Order: p.order, PIMP_VK: p.vkLot, 'laut EB': lotText(E.paare.get(z).vk25) })));
}
if (vk26Fehlt.length) {
    output.markdown('### PIMP_VK ohne (eindeutigen) Verkauf_2026-Satz (max. 50) – bleiben ohne Verknüpfung');
    output.table(vk26Fehlt.slice(0, 50).map(p => ({ id: p.rec.id, Datum: p.datum, Typ: p.typ, Order: p.order, PIMP_VK: p.vkLot, Grund: vk26Doppelt.has(p.vkLot) ? 'Lot doppelt' : 'Lot fehlt' })));
}
if (vkLotSonstige.length) {
    output.markdown('### PIMP_VK mit anderem Format (max. 20)');
    output.table(vkLotSonstige.slice(0, 20).map(p => ({ id: p.rec.id, Datum: p.datum, Typ: p.typ, PIMP_VK: p.vkLot })));
}
if (ebLinksVerloren.length) {
    output.markdown('### EB-Zeilen mit VK25-Zuordnung ohne Gegenstück im Bericht (max. 50)');
    output.table(ebLinksVerloren.slice(0, 50).map(e => ({ EB: e.ebId, Datum: e.datum, Typ: e.typ, Order: e.order, Betrag: cent(e.betrag) })));
}
if (mehrdeutig.length) {
    output.markdown('### Mehrdeutige EB-Gruppen (max. 20)');
    output.table(mehrdeutig.slice(0, 20).map(g => ({ EB: g.map(e => e.ebId).join(', '), Datum: g[0].datum, Typ: g[0].typ, Order: g[0].order })));
}

const wahl = await input.buttonsAsync('Import jetzt ausführen?', [
    { label: 'Abbrechen', value: 'nein' },
    { label: 'Import ausführen', value: 'ja', variant: 'danger' }
]);
if (wahl === 'ja') await ausfuehren();
else output.markdown('Abgebrochen – es wurde nichts geändert.');

async function ausfuehren() {
    const vk25 = z => (E.paare.get(z)?.vk25 || []).map(l => ({ id: l.id }));

    // ── 4. Vorhandene PIMP-Zeilen: nur leere Verknüpfungen füllen ─
    const upd = new Map();
    const setze = (id, feld, wert) => { if (!upd.has(id)) upd.set(id, {}); upd.get(id)[feld] = wert; };
    // 2025: VK25 nur, wenn die Zeile nicht schon einem VK26 zugeordnet ist (sonst Doppelbuchung)
    for (const [z, p] of P.paare) if (!p.hatVk25 && !p.vkLot && vk25(z).length) setze(p.rec.id, F_VK_2025, vk25(z));
    for (const p of vk26Treffer) setze(p.rec.id, F_VK_2026, [{ id: vk26ByLot.get(p.vkLot) }]);
    const updates = [...upd].map(([id, fields]) => ({ id, fields }));
    for (let i = 0; i < updates.length; i += BATCH) await tblPimp.updateRecordsAsync(updates.slice(i, i + BATCH));
    output.markdown(`✏️ ${updates.length} vorhandene PIMP-Zeilen verknüpft (VK_2025: ${updates.filter(u => u.fields[F_VK_2025]).length}, VK_2026: ${updates.filter(u => u.fields[F_VK_2026]).length})`);

    // ── 5. Neue Zeilen anlegen ───────────────────────────────
    const jetzt = new Date().toISOString();
    const creates = neu.map(z => {
        const fields = {};
        for (const [k, v] of Object.entries(z.f)) fields[k] = NUMMER_FELDER.includes(k) ? Number(v) : String(v);
        fields['PIMP_Plattform'] = { name: 'ebay' };
        fields['PIMP_Processed'] = { name: 'true' };
        fields['PIMP_ProcessedAt'] = jetzt;
        if (vk25(z).length) fields[F_VK_2025] = vk25(z);
        return { fields };
    });
    for (let i = 0; i < creates.length; i += BATCH) {
        await tblPimp.createRecordsAsync(creates.slice(i, i + BATCH));
        if ((i / BATCH) % 20 === 0) output.text(`… ${Math.min(i + BATCH, creates.length)} / ${creates.length} angelegt`);
    }
    output.markdown(`➕ ${creates.length} neue PIMP-Zeilen angelegt

## ✅ Fertig
eBay_Transaktionen_2025 wurde **nicht** verändert. Nach Kontrolle kann die Tabelle gelöscht werden.`);
}
