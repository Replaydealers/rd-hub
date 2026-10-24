/**
 * PIMP-Automation V2.1 - Replay Dealers
 * Läuft als Airtable-Automation (z.B. alle 15 Minuten)
 * Verarbeitet automatisch: eBay + Shopify Bestellungen → VK
 *
 * ─────────────────────────────────────────────────────────────
 * ÄNDERUNG V2.1: Echte Verknüpfung PIMP → Verkauf_2026
 *   Überall, wo PIMP_VK_Lot (Text) gesetzt wird, wird zusätzlich das
 *   Verknüpfungsfeld PIMP_VK_2026 gesetzt. Ein Link-Repair-Pass trägt die
 *   Verknüpfung für Zeilen nach, die nur den Text-Lot haben (max. 500 je Lauf).
 *   PIMP_VK_Lot bleibt vorerst als Arbeitsfeld bestehen.
 * ─────────────────────────────────────────────────────────────
 * ÄNDERUNGEN GEGENÜBER V1.1 (Fehlerbehebung "verkauft-Geister" / leere Lots):
 *
 *  1. REPAIR-PASS zu Beginn: VK-Sätze ohne VK_Lot werden geheilt
 *     (VK_Lot wird aus VK_ID abgeleitet). So bleibt ein abgebrochener
 *     Lauf nicht als "leerer Lot" liegen und der manuelle Batch kann
 *     keine Nummer mehr doppelt vergeben.
 *
 *  2. ORDER-IDEMPOTENZ über neues Feld VK_OrderId:
 *     Pro Bestellung entsteht maximal EIN VK. Ein abgebrochener Lauf
 *     wird beim nächsten Lauf VERVOLLSTÄNDIGT statt den Artikel
 *     fälschlich als "schon verkauft" ins Clearing zu kippen.
 *
 *  3. SICHERE REIHENFOLGE: VK anlegen → Lot setzen → Artikel verkaufen
 *     → Bestellung=true. Jeder Abbruch hinterlässt einen wiederholbaren
 *     Zustand (dank Idempotenz + Repair-Pass).
 *
 *  4. Parameter werden als Kontext-Objekt (ctx) übergeben
 *     → behebt den Argument-Reihenfolge-Bug aus V1.1
 *       (verarbeiteteEtiketten / orderIdToVkLot waren vertauscht).
 *
 * ─────────────────────────────────────────────────────────────
 * EINMALIGE VORAUSSETZUNG (in Airtable anlegen, sonst bricht das Skript ab):
 *   Tabelle "Verkauf_2026"  →  neues Feld  "VK_OrderId"  (Single line text)
 * ─────────────────────────────────────────────────────────────
 *
 * Kein CSV-Import (läuft über GCF eBay-Sync). Kein interaktiver Input.
 */

const CONFIG = {
    tables: {
        import: 'PlattformImport_2026',
        verkauf: 'Verkauf_2026',
        artikel: 'Artikel_2026',
        partner: 'Partnerdaten_2026'
    },
    batchSize: 50,
    linkRepairMax: 500,
    titelMatchSchwelle: 0.30,
    plattformMapping: {
        'ebay': { vkPlattform: 'ebay', vkZahlweg: 'ebay' },
        'Shopify': { vkPlattform: 'Shop', vkZahlweg: null }
    }
};

// ============================================================
// HILFSFUNKTIONEN
// ============================================================

function parseNum(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    const n = parseFloat(String(value).replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
}

function splitName(fullName) {
    if (!fullName) return { vorname: '', nachname: '' };
    const parts = fullName.trim().split(/\s+/);
    return parts.length === 1
        ? { vorname: '', nachname: parts[0] }
        : { vorname: parts[0], nachname: parts.slice(1).join(' ') };
}

function matchScore(text1, text2) {
    if (!text1 || !text2) return 0;
    const norm = s => s.toLowerCase().replace(/[^a-z0-9äöüß\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    const w1 = norm(text1), w2 = norm(text2);
    if (!w1.length || !w2.length) return 0;
    return Math.max(
        w1.filter(w => w2.includes(w)).length / w1.length,
        w2.filter(w => w1.includes(w)).length / w2.length
    );
}

function getPlattformInfo(plattformName, payoutMethod, description) {
    const mapping = CONFIG.plattformMapping[plattformName] || CONFIG.plattformMapping['ebay'];
    let zahlweg = mapping.vkZahlweg;
    if (!zahlweg) {
        const pm = (payoutMethod || '').toLowerCase();
        const desc = (description || '').toLowerCase();
        zahlweg = (pm.includes('paypal') || desc.includes('paypal')) ? 'Paypal' : 'Shop';
    }
    return { vkPlattform: mapping.vkPlattform, vkZahlweg: zahlweg };
}

/** Einheitliche Lot-Nummer aus der VK_ID (autoNumber) – EINE Quelle der Wahrheit. */
function berechneVkLot(vkId, dateStr) {
    const jahr = new Date(dateStr || Date.now()).getFullYear().toString().slice(-2);
    return `VK${jahr}/${String(vkId).padStart(3, '0')}`;
}

async function setProcessed(table, records, status) {
    const now = new Date().toISOString();
    const updates = records.map(r => ({ id: r.id, fields: { 'PIMP_Processed': { name: status }, 'PIMP_ProcessedAt': now } }));
    for (let i = 0; i < updates.length; i += CONFIG.batchSize)
        await table.updateRecordsAsync(updates.slice(i, i + CONFIG.batchSize));
}

/** Felder für die Zuordnung PIMP → VK: Text-Lot + echte Verknüpfung (falls VK-Record bekannt). */
function vkFelder(vkLot, vkId) {
    const f = { 'PIMP_VK_Lot': vkLot };
    if (vkId) f['PIMP_VK_2026'] = [{ id: vkId }];
    return f;
}

async function setProcessedMitVkLot(table, records, status, vkLot, vkId) {
    const now = new Date().toISOString();
    const updates = records.map(r => ({ id: r.id, fields: { 'PIMP_Processed': { name: status }, 'PIMP_ProcessedAt': now, ...vkFelder(vkLot, vkId) } }));
    for (let i = 0; i < updates.length; i += CONFIG.batchSize)
        await table.updateRecordsAsync(updates.slice(i, i + CONFIG.batchSize));
}

function gruppiereNachOrderId(records) {
    const groups = new Map();
    for (const r of records) {
        const id = r.getCellValueAsString('PIMP_OrderId') || `SINGLE_${r.id}`;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(r);
    }
    return groups;
}

async function sucheOderErstellePartner(tblPartner, partnerRecords, buyerUser, buyerName) {
    if (buyerUser) {
        const found = partnerRecords.records.find(p =>
            p.getCellValueAsString('PD_KA_Name')?.toLowerCase() === buyerUser.toLowerCase()
        );
        if (found) return found;
    }
    if (buyerName && !buyerUser) {
        const found = partnerRecords.records.find(p => {
            const fn = [p.getCellValueAsString('PD_Vorname'), p.getCellValueAsString('PD_Name')].filter(Boolean).join(' ');
            return fn.toLowerCase() === buyerName.toLowerCase();
        });
        if (found) return found;
    }
    const { vorname, nachname } = splitName(buyerName);
    const id = await tblPartner.createRecordAsync({
        'PD_KA_Name': buyerUser || '',
        'PD_Vorname': vorname,
        'PD_Name': nachname,
        'PD_Typ': { name: 'Privatperson' },
        'PD_Rolle': { name: 'VK-Kunde' },
        'PD_Land': 'DE'
    });
    return { id };
}

// ============================================================
// REPAIR-PASS: VK-Sätze ohne Lot heilen (Folge abgebrochener Läufe)
// ============================================================

async function repariereLeereLots(tblVerkauf, verkaufRecords) {
    const kaputt = verkaufRecords.records.filter(vk =>
        !vk.getCellValueAsString('VK_Lot') && vk.getCellValue('VK_ID') != null
    );
    if (!kaputt.length) return 0;

    const updates = kaputt.map(vk => ({
        id: vk.id,
        fields: { 'VK_Lot': berechneVkLot(vk.getCellValue('VK_ID'), vk.getCellValueAsString('VK_Datum')) }
    }));
    for (let i = 0; i < updates.length; i += CONFIG.batchSize)
        await tblVerkauf.updateRecordsAsync(updates.slice(i, i + CONFIG.batchSize));

    console.log(`🔧 Repair: ${kaputt.length} VK ohne Lot geheilt`);
    return kaputt.length;
}

// ============================================================
// LINK-REPAIR-PASS: Text-Lot vorhanden, Verknüpfung PIMP_VK_2026 fehlt
// ============================================================

async function repariereVkLinks(tblImport, importRecords, vkIdByLot) {
    const offen = importRecords.records.filter(r =>
        r.getCellValueAsString('PIMP_VK_Lot').startsWith('VK26/')
        && !(r.getCellValue('PIMP_VK_2026') || []).length
        && vkIdByLot.has(r.getCellValueAsString('PIMP_VK_Lot'))
    ).slice(0, CONFIG.linkRepairMax);
    if (!offen.length) return 0;

    const updates = offen.map(r => ({ id: r.id, fields: { 'PIMP_VK_2026': [{ id: vkIdByLot.get(r.getCellValueAsString('PIMP_VK_Lot')) }] } }));
    for (let i = 0; i < updates.length; i += CONFIG.batchSize)
        await tblImport.updateRecordsAsync(updates.slice(i, i + CONFIG.batchSize));

    console.log(`🔗 Link-Repair: ${updates.length} PIMP-Zeilen mit Verkauf_2026 verknüpft`);
    return updates.length;
}

// ============================================================
// HAUPTVERARBEITUNG
// ============================================================

async function main() {
    console.log('# ⚙️ PIMP-Automation V2.1');

    const tblImport  = base.getTable(CONFIG.tables.import);
    const tblVerkauf = base.getTable(CONFIG.tables.verkauf);
    const tblArtikel = base.getTable(CONFIG.tables.artikel);
    const tblPartner = base.getTable(CONFIG.tables.partner);

    const importFields = [
        'PIMP_TransactionKey','PIMP_Plattform','PIMP_Processed','PIMP_VK_Lot','PIMP_VK_2026',
        'PIMP_RowType','PIMP_TransactionDate','PIMP_OrderId','PIMP_TransactionNo',
        'PIMP_Description','PIMP_BuyerUser','PIMP_BuyerName',
        'PIMP_ItemNo','PIMP_SKU','PIMP_Title','PIMP_Quantity',
        'PIMP_AmountNet','PIMP_AmountGross','PIMP_Shipping','PIMP_FeeSum',
        'PIMP_PayoutMethod'
    ];
    const verkaufFields = ['VK_Lot','VK_ID','VK_OrderId','VK_Datum','VK_Plattform','VK_Status','VK_Preis','VK_Versandkosten','VK_Plattform_Kosten'];

    console.log('Lade Daten...');
    const importRecords  = await tblImport.selectRecordsAsync({ fields: importFields });
    const artikelRecords = await tblArtikel.selectRecordsAsync({ fields: ['ITEM_Artikelnummer','ITEM_Artikel','ITEM_Status','ITEM_VK_Lot','ITEM_VK_Preis','ITEM_Konsole'] });
    const partnerRecords = await tblPartner.selectRecordsAsync({ fields: ['PD_KA_Name','PD_Vorname','PD_Name','PD_Typ','PD_Rolle'] });
    let   verkaufRecords = await tblVerkauf.selectRecordsAsync({ fields: verkaufFields });

    // (0) Repair-Pass – leere Lots heilen, danach frisch laden
    const repariert = await repariereLeereLots(tblVerkauf, verkaufRecords);
    if (repariert) verkaufRecords = await tblVerkauf.selectRecordsAsync({ fields: verkaufFields });

    // VK_Lot → Record-ID (für die echte Verknüpfung PIMP_VK_2026)
    const vkIdByLot = new Map();
    for (const vk of verkaufRecords.records) {
        const lot = vk.getCellValueAsString('VK_Lot');
        if (lot) vkIdByLot.set(lot, vk.id);
    }
    await repariereVkLinks(tblImport, importRecords, vkIdByLot);

    // OrderId → VK_Lot (aus bereits verarbeiteten Bestellungen; für Versand/Gebühren)
    const orderIdToVkLot = new Map();
    for (const r of importRecords.records) {
        if (r.getCellValueAsString('PIMP_Processed') === 'true'
            && r.getCellValueAsString('PIMP_RowType') === 'Bestellung'
            && r.getCellValueAsString('PIMP_VK_Lot')
            && r.getCellValueAsString('PIMP_OrderId'))
            orderIdToVkLot.set(r.getCellValueAsString('PIMP_OrderId'), r.getCellValueAsString('PIMP_VK_Lot'));
    }

    // OrderId → bestehender VK (Idempotenz-Schlüssel)
    const vkByOrderId = new Map();
    for (const vk of verkaufRecords.records) {
        const o = vk.getCellValueAsString('VK_OrderId');
        if (o) vkByOrderId.set(o, vk);
    }

    const ctx = {
        tblImport, tblVerkauf, tblArtikel, tblPartner,
        artikelRecords, partnerRecords, verkaufRecords,
        globalZugeordnet: new Set(),
        verarbeiteteEtiketten: new Set(),
        orderIdToVkLot, vkByOrderId, vkIdByLot
    };

    // Nur unverarbeitete eBay + Shopify Zeilen ('false')
    const unverarbeitet = importRecords.records.filter(r => {
        const p = r.getCellValue('PIMP_Plattform')?.name;
        return (p === 'ebay' || p === 'Shopify') && r.getCellValueAsString('PIMP_Processed') === 'false';
    });

    if (!unverarbeitet.length) {
        console.log('### ✅ Keine unverarbeiteten Transaktionen');
        await verarbeiteNachtraeglicheVersandetiketten(ctx, importRecords);
        await runVerkaufsbezogeneGebuehren(tblImport, tblVerkauf, importRecords);
        return;
    }

    console.log(`${unverarbeitet.length} unverarbeitete Zeilen`);
    const orderGroups = gruppiereNachOrderId(unverarbeitet);
    console.log(`${orderGroups.size} Bestellungen/Transaktionen`);

    const stats = { vkErstellt: 0, vkRepariert: 0, auszahlungOk: 0, einbehaltenOk: 0, clearing: 0, fehler: 0 };

    for (const [orderId, zeilen] of orderGroups) {
        try {
            const result = await verarbeiteOrderGroup(ctx, orderId, zeilen);
            if ((result.type === 'vkErstellt' || result.type === 'vkRepariert') && result.vkLot)
                ctx.orderIdToVkLot.set(orderId, result.vkLot);
            stats[result.type] = (stats[result.type] || 0) + 1;
        } catch (e) {
            console.log(`❌ ${orderId}: ${e.message}`);
            stats.fehler++;
        }
    }

    await verarbeiteNachtraeglicheVersandetiketten(ctx, importRecords);
    await runVerkaufsbezogeneGebuehren(tblImport, tblVerkauf, importRecords);

    console.log(`Ergebnis: VK neu: ${stats.vkErstellt} | VK repariert: ${stats.vkRepariert} | Auszahlung: ${stats.auszahlungOk} | Einbehalten: ${stats.einbehaltenOk} | Clearing: ${stats.clearing} | Fehler: ${stats.fehler}`);
}

// ============================================================
// ORDER-GRUPPE VERARBEITEN
// ============================================================

async function verarbeiteOrderGroup(ctx, orderId, zeilen) {
    const { tblImport } = ctx;
    const typen = new Set(zeilen.map(z => z.getCellValueAsString('PIMP_RowType')));

    if (typen.has('Auszahlung') && typen.size === 1) {
        await setProcessed(tblImport, zeilen, 'true');
        return { type: 'auszahlungOk' };
    }

    if (typen.has('Einbehalten') && !typen.has('Bestellung') && !typen.has('Rückerstattung')) {
        await setProcessed(tblImport, zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Einbehalten'), 'true');
        console.log(`✅ ${orderId}: Einbehalten → erledigt`);
        return { type: 'einbehaltenOk' };
    }

    if (typen.has('Fall') && !typen.has('Rückerstattung')) {
        await setProcessed(tblImport, zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Fall'), 'true');
        return { type: 'einbehaltenOk' };
    }

    // Rückerstattungen → immer Clearing (mit VK_Lot wenn vorhanden)
    if (typen.has('Rückerstattung')) {
        const rueckZeilen = zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Rückerstattung');
        const andereZeilen = zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') !== 'Rückerstattung');
        const vkLot = ctx.orderIdToVkLot.get(orderId);
        if (andereZeilen.length) await setProcessed(tblImport, andereZeilen, 'true');
        if (vkLot) await setProcessedMitVkLot(tblImport, rueckZeilen, 'clearing', vkLot, ctx.vkIdByLot.get(vkLot));
        else await setProcessed(tblImport, rueckZeilen, 'clearing');
        console.log(`⚠️ ${orderId}: Rückerstattung → Clearing${vkLot ? ` (${vkLot})` : ''}`);
        return { type: 'clearing' };
    }

    if (typen.has('Bestellung'))
        return await verarbeiteBestellung(ctx, orderId, zeilen);

    if (typen.has('Versandetikett') && typen.size === 1)
        return { type: 'clearing' };

    return { type: 'clearing' };
}

// ============================================================
// SKU-Zeilen einer Bestellung einsammeln
// ============================================================

function sammleSkuListe(bestellZeilen) {
    const skuListe = [];
    let hatKeineSku = false, hatMehrereSku = false;
    for (const zeile of bestellZeilen) {
        const skuRaw = zeile.getCellValueAsString('PIMP_SKU');
        if (!skuRaw) { hatKeineSku = true; break; }
        if (skuRaw.includes(',')) {
            const einzeln = skuRaw.split(',').map(s => s.trim()).filter(Boolean);
            if (einzeln.length > 1) hatMehrereSku = true;
            for (const sku of einzeln) skuListe.push({ sku, importZeile: zeile });
        } else {
            skuListe.push({ sku: skuRaw, importZeile: zeile });
        }
    }
    return { skuListe, hatKeineSku, hatMehrereSku };
}

// ============================================================
// BESTELLUNG → VK
// ============================================================

async function verarbeiteBestellung(ctx, orderId, zeilen) {
    const { tblImport, tblVerkauf, tblArtikel, tblPartner, artikelRecords, partnerRecords, globalZugeordnet, verarbeiteteEtiketten, vkByOrderId, vkIdByLot } = ctx;

    const ersteZeile = zeilen.find(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung') || zeilen[0];
    const plattformName = ersteZeile.getCellValue('PIMP_Plattform')?.name || 'ebay';
    const istShopify = plattformName === 'Shopify';

    let bestellZeilen = istShopify
        ? zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung')
        : zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung' && z.getCellValueAsString('PIMP_ItemNo'));
    if (!bestellZeilen.length)
        bestellZeilen = zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung');

    if (!bestellZeilen.length) {
        await setProcessed(tblImport, zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung'), 'clearing');
        return { type: 'clearing' };
    }

    const versandZeilen = zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Versandetikett');
    const { skuListe, hatKeineSku, hatMehrereSku } = sammleSkuListe(bestellZeilen);

    // ── IDEMPOTENZ: existiert für diese OrderId schon ein VK? → vervollständigen, NICHT neu anlegen ──
    if (orderId && !orderId.startsWith('SINGLE_') && vkByOrderId.has(orderId)) {
        return await vervollstaendigeBestellung(ctx, orderId, bestellZeilen, versandZeilen, skuListe, vkByOrderId.get(orderId));
    }

    // Kein SKU oder (Shopify) mehrere → Clearing
    if (hatKeineSku || (istShopify && hatMehrereSku)) {
        const grund = hatKeineSku ? 'keine SKU' : 'mehrere SKUs';
        console.log(`⚠️ ${orderId}: ${grund} → Clearing`);
        await setProcessed(tblImport, bestellZeilen, 'clearing');
        return { type: 'clearing' };
    }

    // Artikel zuordnen (auf Lager)
    const artikelZuordnung = [];
    for (const { sku, importZeile } of skuListe) {
        const importTitel = importZeile.getCellValueAsString('PIMP_Title') || '';
        const zeilenPreis = parseNum(importZeile.getCellValue('PIMP_AmountGross')) || parseNum(importZeile.getCellValue('PIMP_AmountNet'));

        const alleMitSku = artikelRecords.records.filter(a =>
            a.getCellValueAsString('ITEM_Artikelnummer') === sku &&
            a.getCellValueAsString('ITEM_Status') === 'auf Lager' &&
            !globalZugeordnet.has(a.id)
        );

        if (!alleMitSku.length) {
            console.log(`⚠️ ${orderId}: ${sku} nicht gefunden/auf Lager → Clearing`);
            await setProcessed(tblImport, bestellZeilen, 'clearing');
            return { type: 'clearing' };
        }

        if (alleMitSku.length > 1) {
            const ep = zeilenPreis ? zeilenPreis / alleMitSku.length : null;
            for (const a of alleMitSku) artikelZuordnung.push({ artikelRecord: a, einzelpreis: ep });
        } else {
            const artikel = alleMitSku[0];
            if (matchScore(importTitel, artikel.getCellValueAsString('ITEM_Artikel') || '') < CONFIG.titelMatchSchwelle) {
                console.log(`⚠️ ${orderId}: Titel-Match zu niedrig für ${sku} → Clearing`);
                await setProcessed(tblImport, bestellZeilen, 'clearing');
                return { type: 'clearing' };
            }
            artikelZuordnung.push({ artikelRecord: artikel, einzelpreis: zeilenPreis });
        }
    }

    // Partner
    const buyerUser = ersteZeile.getCellValueAsString('PIMP_BuyerUser') || '';
    const buyerName = ersteZeile.getCellValueAsString('PIMP_BuyerName') || '';
    const partner = await sucheOderErstellePartner(tblPartner, partnerRecords, buyerUser, buyerName);

    // Preise
    const transactionDate = ersteZeile.getCellValueAsString('PIMP_TransactionDate');
    const kopfZeile = zeilen.find(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung' && !z.getCellValueAsString('PIMP_ItemNo'));
    let vkPreis = parseNum(kopfZeile?.getCellValue('PIMP_AmountGross')) || 0;
    if (!vkPreis) vkPreis = bestellZeilen.reduce((s, z) => s + (parseNum(z.getCellValue('PIMP_AmountGross')) || 0), 0);

    let versandBerechnet = parseNum(ersteZeile.getCellValue('PIMP_Shipping')) || 0;
    if (versandBerechnet > 0 && Math.abs(versandBerechnet - vkPreis) < 0.01) { // eBay-Export-Fehler
        for (const z of bestellZeilen) await tblImport.updateRecordAsync(z.id, { 'PIMP_Shipping': 0 });
        versandBerechnet = 0;
    }

    let versandkosten = 0;
    for (const vz of versandZeilen) versandkosten += Math.abs(parseNum(vz.getCellValue('PIMP_AmountGross')) || 0);

    let plattformKosten = 0;
    for (const z of bestellZeilen) plattformKosten += Math.abs(parseNum(z.getCellValue('PIMP_FeeSum')) || 0);

    const plattformInfo = getPlattformInfo(plattformName, ersteZeile.getCellValueAsString('PIMP_PayoutMethod'), ersteZeile.getCellValueAsString('PIMP_Description'));

    // ── Schritt 1: VK anlegen – INKL. VK_OrderId (Idempotenz-Anker), noch ohne Lot ──
    const vkRecordId = await tblVerkauf.createRecordAsync({
        'VK_OrderId': orderId,
        'VK_Datum': transactionDate ? new Date(transactionDate) : new Date(),
        'VK_Plattform': { name: plattformInfo.vkPlattform },
        'VK_Status': { name: 'versendet' },
        'VK_Zahlstatus': { name: 'Zahlung erfolgt' },
        'VK_Zahlweg': { name: plattformInfo.vkZahlweg },
        'VK_PartnerID': partner ? [{ id: partner.id }] : undefined,
        'VK_Preis': vkPreis,
        'VK_Versandkosten': versandkosten,
        'VK_Versand_Berechnet': versandBerechnet,
        'VK_Plattform_Kosten': plattformKosten
    });

    // ── Schritt 2: Lot aus VK_ID ableiten und setzen ──
    const neuerRecord = await tblVerkauf.selectRecordAsync(vkRecordId, { fields: ['VK_ID'] });
    const vkLot = berechneVkLot(neuerRecord.getCellValue('VK_ID'), transactionDate);
    await tblVerkauf.updateRecordAsync(vkRecordId, { 'VK_Lot': vkLot });

    // Idempotenz-Map sofort aktualisieren (falls dieselbe OrderId nochmal käme)
    vkByOrderId.set(orderId, neuerRecord);
    vkIdByLot.set(vkLot, vkRecordId);

    // ── Schritt 3: Artikel auf verkauft setzen + verknüpfen ──
    for (const z of artikelZuordnung) {
        await tblArtikel.updateRecordAsync(z.artikelRecord.id, {
            'ITEM_Status': { name: 'verkauft' },
            'ITEM_VK_Lot': [{ id: vkRecordId }],
            'ITEM_VK_Preis': z.einzelpreis
        });
        globalZugeordnet.add(z.artikelRecord.id);
    }

    // ── Schritt 4: Import-Zeilen als erledigt markieren ──
    await setProcessedMitVkLot(tblImport, bestellZeilen, 'true', vkLot, vkRecordId);
    if (versandZeilen.length) {
        await setProcessedMitVkLot(tblImport, versandZeilen, 'true', vkLot, vkRecordId);
        for (const vz of versandZeilen) verarbeiteteEtiketten.add(vz.id);
    }

    const rueck = zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Rückerstattung');
    if (rueck.length) {
        await setProcessedMitVkLot(tblImport, rueck, 'clearing', vkLot, vkRecordId);
        console.log(`⚠️ ${rueck.length} Rückerstattung(en) → Clearing`);
    }

    console.log(`✅ ${vkLot} [${istShopify ? 'Shop' : 'eBay'}]: ${artikelZuordnung.length} Artikel, ${vkPreis.toFixed(2)} €`);
    return { type: 'vkErstellt', vkLot };
}

// ============================================================
// BESTELLUNG VERVOLLSTÄNDIGEN (Reparatur eines halbfertigen Laufs)
// – wird aufgerufen, wenn für die OrderId bereits ein VK existiert
// ============================================================

async function vervollstaendigeBestellung(ctx, orderId, bestellZeilen, versandZeilen, skuListe, vkRecord) {
    const { tblImport, tblVerkauf, tblArtikel, artikelRecords, globalZugeordnet, verarbeiteteEtiketten } = ctx;

    // Lot sicherstellen
    let vkLot = vkRecord.getCellValueAsString('VK_Lot');
    if (!vkLot) {
        vkLot = berechneVkLot(vkRecord.getCellValue('VK_ID'), vkRecord.getCellValueAsString('VK_Datum'));
        await tblVerkauf.updateRecordAsync(vkRecord.id, { 'VK_Lot': vkLot });
    }

    // Noch nicht verknüpfte Artikel dieser Bestellung nachziehen (die "auf Lager" sind)
    let nachgezogen = 0;
    for (const { sku, importZeile } of skuListe) {
        const kandidaten = artikelRecords.records.filter(a =>
            a.getCellValueAsString('ITEM_Artikelnummer') === sku &&
            a.getCellValueAsString('ITEM_Status') === 'auf Lager' &&
            !globalZugeordnet.has(a.id)
        );
        for (const a of kandidaten) {
            const preis = parseNum(importZeile.getCellValue('PIMP_AmountGross')) || parseNum(importZeile.getCellValue('PIMP_AmountNet'));
            await tblArtikel.updateRecordAsync(a.id, {
                'ITEM_Status': { name: 'verkauft' },
                'ITEM_VK_Lot': [{ id: vkRecord.id }],
                'ITEM_VK_Preis': preis
            });
            globalZugeordnet.add(a.id);
            nachgezogen++;
        }
    }

    await setProcessedMitVkLot(tblImport, bestellZeilen, 'true', vkLot, vkRecord.id);
    if (versandZeilen.length) {
        await setProcessedMitVkLot(tblImport, versandZeilen, 'true', vkLot, vkRecord.id);
        for (const vz of versandZeilen) verarbeiteteEtiketten.add(vz.id);
    }

    console.log(`♻️ ${orderId}: bestehender ${vkLot} vervollständigt (${nachgezogen} Artikel nachgezogen)`);
    return { type: 'vkRepariert', vkLot };
}

// ============================================================
// NACHTRÄGLICHE VERSANDETIKETTEN
// ============================================================

async function verarbeiteNachtraeglicheVersandetiketten(ctx, importRecords) {
    const { tblImport, tblVerkauf, verarbeiteteEtiketten } = ctx;

    const unverarbeitet = importRecords.records.filter(r => {
        const p = r.getCellValue('PIMP_Plattform')?.name;
        return (p === 'ebay' || p === 'Shopify')
            && r.getCellValueAsString('PIMP_Processed') === 'false'
            && r.getCellValueAsString('PIMP_RowType') === 'Versandetikett'
            && !verarbeiteteEtiketten.has(r.id);
    });
    if (!unverarbeitet.length) return;

    console.log(`${unverarbeitet.length} unzugeordnete Versandetiketten`);

    const orderMap = new Map();
    for (const r of importRecords.records) {
        if (r.getCellValueAsString('PIMP_Processed') === 'true'
            && r.getCellValueAsString('PIMP_RowType') === 'Bestellung'
            && r.getCellValueAsString('PIMP_VK_Lot')
            && r.getCellValueAsString('PIMP_OrderId'))
            orderMap.set(r.getCellValueAsString('PIMP_OrderId'), r.getCellValueAsString('PIMP_VK_Lot'));
    }

    const verkaufRecords = await tblVerkauf.selectRecordsAsync({ fields: ['VK_Lot', 'VK_Versandkosten'] });
    const vkMap = new Map(), vkVersand = new Map();
    for (const vk of verkaufRecords.records) {
        const lot = vk.getCellValueAsString('VK_Lot');
        if (lot) { vkMap.set(lot, vk); vkVersand.set(lot, vk.getCellValue('VK_Versandkosten') || 0); }
    }

    let zugeordnet = 0, nichtGefunden = 0;
    for (const etikett of unverarbeitet) {
        const orderId = etikett.getCellValueAsString('PIMP_OrderId');
        if (!orderId) { nichtGefunden++; continue; }
        const vkLot = orderMap.get(orderId);
        if (!vkLot) { nichtGefunden++; continue; }
        const vkRecord = vkMap.get(vkLot);
        if (!vkRecord) { nichtGefunden++; continue; }

        const betrag = parseNum(etikett.getCellValue('PIMP_AmountGross'));
        const now = new Date().toISOString();

        if (!betrag || betrag === 0) {
            await tblImport.updateRecordAsync(etikett.id, { 'PIMP_Processed': { name: 'true' }, 'PIMP_ProcessedAt': now, ...vkFelder(vkLot, vkRecord.id) });
            zugeordnet++; continue;
        }

        const istStorno = betrag > 0;
        const aktuell = vkVersand.get(vkLot) || 0;
        const neu = istStorno ? Math.max(0, aktuell - Math.abs(betrag)) : aktuell + Math.abs(betrag);
        if (neu !== aktuell) {
            await tblVerkauf.updateRecordAsync(vkRecord.id, { 'VK_Versandkosten': neu });
            console.log(`📦 ${vkLot}: Versand ${aktuell.toFixed(2)} → ${neu.toFixed(2)} €`);
        }
        vkVersand.set(vkLot, neu);
        await tblImport.updateRecordAsync(etikett.id, { 'PIMP_Processed': { name: 'true' }, 'PIMP_ProcessedAt': now, ...vkFelder(vkLot, vkRecord.id) });
        zugeordnet++;
    }

    if (zugeordnet) console.log(`✅ ${zugeordnet} Versandetiketten zugeordnet`);
    if (nichtGefunden) console.log(`⏳ ${nichtGefunden} ohne passenden VK → nächster Lauf`);
}

// ============================================================
// VERKAUFSBEZOGENE GEBÜHREN → VK_Plattform_Kosten
// ============================================================

async function runVerkaufsbezogeneGebuehren(tblImport, tblVerkauf, importRecords) {
    const vkGebuehren = importRecords.records.filter(r => {
        const s = r.getCellValueAsString('PIMP_Processed');
        return r.getCellValueAsString('PIMP_RowType') === 'Andere Gebühr'
            && (s === 'false' || s === 'clearing')
            && r.getCellValueAsString('PIMP_BuyerName')?.trim();
    });
    if (!vkGebuehren.length) return;
    console.log(`${vkGebuehren.length} verkaufsbezogene Gebühren`);

    const orderIdToVkLot = new Map();
    for (const r of importRecords.records) {
        if (r.getCellValueAsString('PIMP_Processed') === 'true'
            && r.getCellValueAsString('PIMP_RowType') === 'Bestellung'
            && r.getCellValueAsString('PIMP_VK_Lot')
            && r.getCellValueAsString('PIMP_OrderId'))
            orderIdToVkLot.set(r.getCellValueAsString('PIMP_OrderId'), r.getCellValueAsString('PIMP_VK_Lot'));
    }

    const verkaufRecords = await tblVerkauf.selectRecordsAsync({ fields: ['VK_Lot', 'VK_Plattform_Kosten'] });
    const vkMap = new Map();
    for (const vk of verkaufRecords.records) {
        const lot = vk.getCellValueAsString('VK_Lot');
        if (lot) vkMap.set(lot, vk);
    }

    let zugeordnet = 0, offen = 0;
    for (const zeile of vkGebuehren) {
        if (zeile.getCellValueAsString('PIMP_VK_Lot')) continue; // bereits zugeordnet (idempotent)
        const orderId = zeile.getCellValueAsString('PIMP_OrderId');
        const betrag = Math.abs(parseNum(zeile.getCellValue('PIMP_AmountGross')) || 0);
        if (!orderId || !betrag) { offen++; continue; }
        const vkLot = orderIdToVkLot.get(orderId);
        if (!vkLot) { offen++; continue; }
        const vkRecord = vkMap.get(vkLot);
        if (!vkRecord) { offen++; continue; }

        const aktuell = vkRecord.getCellValue('VK_Plattform_Kosten') || 0;
        await tblVerkauf.updateRecordAsync(vkRecord.id, { 'VK_Plattform_Kosten': aktuell + betrag });
        const now = new Date().toISOString();
        await tblImport.updateRecordAsync(zeile.id, { 'PIMP_Processed': { name: 'true' }, 'PIMP_ProcessedAt': now, ...vkFelder(vkLot, vkRecord.id) });
        console.log(`✅ ${vkLot}: +${betrag.toFixed(2)} € Gebühr`);
        zugeordnet++;
    }

    if (zugeordnet) console.log(`✅ ${zugeordnet} Gebühren zugeordnet`);
    if (offen) console.log(`⏳ ${offen} Gebühren ohne passenden VK`);
}

// ============================================================
// START
// ============================================================

await main();
