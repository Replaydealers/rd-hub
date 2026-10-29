/**
 * Clearing V2.10.21 - Replay Dealers
 * V2.10.21 - Partner-Duplikat-Bug behoben: Cache wird live aktualisiert
 * V2.10.20 - Erklärungstext gekürzt
 * V2.10.19 - Storno-Option: Artikel verloren → Abschreibung
 * V2.10.18 - Bugfix: istVollstorno als Parameter
 * V2.10.17 - Storno-Buttons bei Vollstorno situationsgerecht
 * V2.10.16 - Bugfix: Versand-Scope + Info-Zeile fixeGebuehren
 */

const CONFIG = {
    tables: {
        import: 'PlattformImport_2026',
        artikel: 'Artikel_2026',
        verkauf: 'Verkauf_2026',
        partner: 'Partnerdaten_2026'
    },
    titelMatchSchwelle: 0.30,
    plattformMapping: {
        'ebay': { vkPlattform: 'ebay', vkZahlweg: 'ebay' },
        'Shopify': { vkPlattform: 'Shop', vkZahlweg: null }
    }
};

// ============================================================
// HAUPTLOGIK
// ============================================================

async function main() {
    output.markdown('# 🔍 Clearing V2.10.21');

    const tblImport = base.getTable(CONFIG.tables.import);
    const tblArtikel = base.getTable(CONFIG.tables.artikel);
    const tblVerkauf = base.getTable(CONFIG.tables.verkauf);
    const tblPartner = base.getTable(CONFIG.tables.partner);

    output.text('Lade Daten...');

    const importRecords = await tblImport.selectRecordsAsync({ fields: [
        'PIMP_TransactionKey','PIMP_Plattform','PIMP_Processed','PIMP_VK_Lot',
        'PIMP_RowType','PIMP_TransactionDate','PIMP_OrderId',
        'PIMP_BuyerUser','PIMP_BuyerName',
        'PIMP_ItemNo','PIMP_SKU','PIMP_Title','PIMP_Quantity',
        'PIMP_AmountGross','PIMP_AmountNet','PIMP_Shipping','PIMP_FeeSum',
        'PIMP_Reference','PIMP_Description','PIMP_PayoutMethod'
    ]});

    const artikelRecords = await tblArtikel.selectRecordsAsync({ fields: [
        'ITEM_Artikelnummer','ITEM_Artikel','ITEM_Status','ITEM_Konsole','ITEM_Komponente',
        'ITEM_VK_Lot','ITEM_VK_Preis'
    ]});

    const verkaufRecords = await tblVerkauf.selectRecordsAsync({ fields: [
        'VK_Lot','VK_Plattform','VK_Status','VK_Preis','VK_Plattform_Kosten','VK_Versandkosten'
    ]});

    const partnerRecords = await tblPartner.selectRecordsAsync({ fields: [
        'PD_KA_Name','PD_Name','PD_Vorname','PD_Firmenname'
    ]});

    // V2.10.21: Partner-Lookup-Cache (überlebt neue Partner innerhalb desselben Runs)
    const partnerCache = {
        byKaName: new Map(),
        byFullName: new Map()
    };
    for (const p of partnerRecords.records) {
        const ka = p.getCellValueAsString('PD_KA_Name');
        if (ka?.trim()) partnerCache.byKaName.set(ka.trim().toLowerCase(), p.id);
        const v = p.getCellValueAsString('PD_Vorname') || '';
        const n = p.getCellValueAsString('PD_Name') || '';
        const full = [v, n].filter(Boolean).join(' ').trim().toLowerCase();
        if (full) partnerCache.byFullName.set(full, p.id);
    }

    const clearingZeilen = importRecords.records.filter(r =>
        r.getCellValueAsString('PIMP_Processed') === 'clearing'
    );

    if (!clearingZeilen.length) {
        output.markdown('### ✅ Keine Clearing-Einträge vorhanden');
        return;
    }

    const orderGroups = new Map();
    for (const z of clearingZeilen) {
        const oid = z.getCellValueAsString('PIMP_OrderId') || `SINGLE_${z.id}`;
        if (!orderGroups.has(oid)) orderGroups.set(oid, []);
        orderGroups.get(oid).push(z);
    }

    output.text(`${orderGroups.size} Fälle im Clearing\n`);

    let fallNr = 0;

    for (const [orderId, zeilen] of orderGroups) {
        fallNr++;
        const result = await verarbeiteClearingFall(
            fallNr, orderGroups.size, orderId, zeilen,
            tblImport, tblArtikel, tblVerkauf, tblPartner,
            artikelRecords, verkaufRecords, partnerRecords, partnerCache, importRecords
        );
        if (result === 'stop') { output.text('Clearing abgebrochen'); return; }
    }

    output.clear();
    output.markdown('# ✅ Alle Clearing-Fälle durchgegangen!');
}

// ============================================================
// PLATTFORM-INFO ERMITTELN
// ============================================================

function getPlattformInfo(zeilen) {
    const ersteZeile = zeilen.find(z => z.getCellValueAsString('PIMP_Plattform')) || zeilen[0];
    const plattform = ersteZeile.getCellValueAsString('PIMP_Plattform') || 'ebay';
    const mapping = CONFIG.plattformMapping[plattform] || CONFIG.plattformMapping['ebay'];

    let zahlweg = mapping.vkZahlweg;
    if (!zahlweg) {
        const pm = (ersteZeile.getCellValueAsString('PIMP_PayoutMethod') || '').toLowerCase();
        const desc = (ersteZeile.getCellValueAsString('PIMP_Description') || '').toLowerCase();
        if (pm.includes('paypal') || desc.includes('paypal')) zahlweg = 'Paypal';
        else zahlweg = 'Shop';
    }

    return { plattform, vkPlattform: mapping.vkPlattform, vkZahlweg: zahlweg };
}

// ============================================================
// EINZELNEN FALL VERARBEITEN
// ============================================================

async function verarbeiteClearingFall(fallNr, total, orderId, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, verkaufRecords, partnerRecords, partnerCache, importRecords) {
    output.clear();
    const plattformInfo = getPlattformInfo(zeilen);
    output.markdown(`# 🔍 Clearing-Fall ${fallNr} / ${total} [${plattformInfo.plattform}]`);
    zeigeBestellungsInfo(orderId, zeilen);

    const typen = new Set(zeilen.map(z => z.getCellValueAsString('PIMP_RowType')));

    if (typen.has('Fall') && !typen.has('Rückerstattung')) {
        output.markdown('## ℹ️ Käuferschutz-Fall (nur Ankündigung)');
        zeigeZeilenTabelle(zeilen);
        output.text('"Fall" ist nur eine Statusmeldung. Kann als erledigt markiert werden.');
        return await standardAktionen(zeilen, tblImport);
    }

    if (typen.has('Fall') && typen.has('Rückerstattung'))
        return await handleFall(orderId, zeilen, tblImport, tblArtikel, tblVerkauf, artikelRecords, verkaufRecords, importRecords);

    if (typen.has('Rückerstattung'))
        return await handleRueckerstattung(orderId, zeilen, tblImport, tblArtikel, tblVerkauf, artikelRecords, verkaufRecords, importRecords);

    if (typen.has('Einbehalten') && !typen.has('Bestellung'))
        return await handleEinbehalten(orderId, zeilen, tblImport, verkaufRecords, importRecords);

    if (typen.has('Versandetikett') && !typen.has('Bestellung'))
        return await handleVersandetikett(orderId, zeilen, tblImport, tblVerkauf, verkaufRecords, importRecords);

    if (typen.has('Andere Gebühr'))
        return await handleAndereGebuehr(zeilen, tblImport);

    if (typen.has('Bestellung'))
        return await handleBestellung(orderId, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords);

    output.markdown('## ❓ Unbekannter Fall');
    output.text(`Typen: ${[...typen].join(', ')}`);
    return await standardAktionen(zeilen, tblImport);
}

// ============================================================
// BESTELLÜBERSICHT
// ============================================================

function zeigeBestellungsInfo(orderId, zeilen) {
    const bz = zeilen.find(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung') || zeilen[0];
    const buyerUser = bz.getCellValueAsString('PIMP_BuyerUser') || '-';
    const buyerName = bz.getCellValueAsString('PIMP_BuyerName') || '-';
    const datum = bz.getCellValueAsString('PIMP_TransactionDate') || '-';

    let summeGross = 0, summeShipping = 0, summeFees = 0;
    const artikel = [];

    for (const z of zeilen) {
        const typ = z.getCellValueAsString('PIMP_RowType');
        if (typ === 'Bestellung') {
            summeGross += z.getCellValue('PIMP_AmountGross') || 0;
            summeShipping += z.getCellValue('PIMP_Shipping') || 0;
        }
        summeFees += z.getCellValue('PIMP_FeeSum') || 0;
        if (typ === 'Bestellung' && z.getCellValueAsString('PIMP_ItemNo')) {
            artikel.push({
                sku: z.getCellValueAsString('PIMP_SKU') || '❌ fehlt',
                titel: z.getCellValueAsString('PIMP_Title') || '-',
                menge: z.getCellValue('PIMP_Quantity') || 1,
                betrag: z.getCellValue('PIMP_AmountGross') || 0
            });
        }
    }

    output.markdown(`---`);
    output.markdown(`**OrderId:** \`${orderId}\` | **Datum:** ${datum}`);
    output.markdown(`**Käufer:** ${buyerUser} / ${buyerName}`);

    if (artikel.length) {
        let t = '| SKU | Titel | Menge | Betrag |\n|-----|-------|-------|--------|\n';
        for (const a of artikel) t += `| ${a.sku} | ${a.titel.substring(0, 40)}${a.titel.length > 40 ? '...' : ''} | ${a.menge} | ${a.betrag.toFixed(2)} € |\n`;
        output.markdown(t);
    }

    if (summeGross || summeShipping) {
        output.text(`Warenwert: ${summeGross.toFixed(2)} € | Versand: ${summeShipping.toFixed(2)} € | Gebühren: ${summeFees.toFixed(2)} €`);
        if (summeShipping > 0 && Math.abs(summeShipping - summeGross) < 0.01) {
            output.markdown(`> ⚠️ **eBay-Export-Fehler:** Versand (${summeShipping.toFixed(2)} €) = Warenwert (${summeGross.toFixed(2)} €) — das ist fast sicher falsch. Beim Clearing wird PIMP_Shipping korrigiert.`);
        }
    }
    output.markdown(`---`);
}

// ============================================================
// HANDLER: KÄUFERSCHUTZ-FALL
// ============================================================

async function handleFall(orderId, zeilen, tblImport, tblArtikel, tblVerkauf, artikelRecords, verkaufRecords, importRecords) {
    output.markdown('## ⚠️ Käuferschutz-Fall / Retoure');
    zeigeZeilenTabelle(zeilen);

    let vkLot = null;
    for (const z of zeilen) { const l = z.getCellValueAsString('PIMP_VK_Lot'); if (l) { vkLot = l; break; } }
    if (!vkLot) {
        const alle = importRecords.records.filter(r => r.getCellValueAsString('PIMP_OrderId') === orderId);
        for (const z of alle) { const l = z.getCellValueAsString('PIMP_VK_Lot'); if (l) { vkLot = l; break; } }
    }

    let vkRecord = null;
    if (vkLot) vkRecord = verkaufRecords.records.find(r => r.getCellValueAsString('VK_Lot') === vkLot);

    const fallZeile = zeilen.find(z => z.getCellValueAsString('PIMP_RowType') === 'Fall');
    const rueckBetrag = fallZeile ? Math.abs(fallZeile.getCellValue('PIMP_AmountGross') || 0) : 0;
    const ursprBrutto = vkRecord ? (vkRecord.getCellValue('VK_Preis') || 0) : 0;

    output.markdown('### 📊 Übersicht');
    if (vkRecord) output.text(`VK-Lot: ${vkLot} | Status: ${vkRecord.getCellValueAsString('VK_Status') || '-'}`);
    else output.text('⚠️ Kein VK-Lot gefunden');
    output.text(`Urspr. Betrag: ${ursprBrutto.toFixed(2)} € | Rückerstattung: ${rueckBetrag.toFixed(2)} €`);

    const aktion = await input.buttonsAsync('Aktion:', [
        { label: '🔄 Stornieren', value: 'storno', variant: 'primary' },
        { label: '✅ Erledigt', value: 'erledigt' },
        { label: '⏭️ Weiter', value: 'weiter' },
        { label: '🔄 Reset (false)', value: 'reset' },
        { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
    ]);
    if (aktion === 'stop') return 'stop';
    if (aktion === 'erledigt') { await setzeProcessed(tblImport, zeilen, 'true'); output.text(`✅ Erledigt`); return 'weiter'; }
    if (aktion === 'reset') { await setzeProcessed(tblImport, zeilen, 'false'); output.text(`🔄 Zurückgesetzt`); return 'weiter'; }
    if (aktion === 'weiter') return 'weiter';

    if (aktion === 'storno') {
        if (!vkRecord) {
            output.text('❌ Kein VK-Lot verknüpft – Storno nicht möglich');
            return await standardAktionen(zeilen, tblImport);
        }
        const stornoResult = await storniereVerkaufInline(vkRecord, vkLot, zeilen, tblImport, tblArtikel, tblVerkauf, artikelRecords);
        if (stornoResult === 'stop') return 'stop';
        if (stornoResult === 'erledigt') { await setzeProcessedMitVkLot(tblImport, zeilen, 'true', vkLot); }
        return 'weiter';
    }
    return 'weiter';
}

// ============================================================
// HANDLER: RÜCKERSTATTUNG
// ============================================================

async function handleRueckerstattung(orderId, zeilen, tblImport, tblArtikel, tblVerkauf, artikelRecords, verkaufRecords, importRecords) {
    output.markdown('## 💸 Rückerstattung');
    zeigeZeilenTabelle(zeilen);

    const typen = new Set(zeilen.map(z => z.getCellValueAsString('PIMP_RowType')));
    const hatBestellung = typen.has('Bestellung');

    const rueckZeilen = zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Rückerstattung');

    let amountGrossSum = 0;
    let feeSumSum = 0;
    let skus = [];

    for (const rz of rueckZeilen) {
        amountGrossSum += rz.getCellValue('PIMP_AmountGross') || 0;
        feeSumSum      += rz.getCellValue('PIMP_FeeSum') || 0;
        const s = rz.getCellValueAsString('PIMP_SKU');
        if (s && !skus.includes(s)) skus.push(s);
    }

    const warenWertDelta = amountGrossSum - feeSumSum;
    const gebuehrenDelta = feeSumSum;

    let vkLot = null;
    for (const z of zeilen) { const l = z.getCellValueAsString('PIMP_VK_Lot'); if (l) { vkLot = l; break; } }
    if (!vkLot) {
        const alle = importRecords.records.filter(r => r.getCellValueAsString('PIMP_OrderId') === orderId);
        for (const z of alle) { const l = z.getCellValueAsString('PIMP_VK_Lot'); if (l) { vkLot = l; break; } }
    }

    const vkRecord = vkLot
        ? verkaufRecords.records.find(r => r.getCellValueAsString('VK_Lot') === vkLot)
        : null;

    if (hatBestellung && !vkRecord) {
        output.markdown('### ℹ️ Stornierter Kauf (Bestellung + Rückerstattung)');
        output.text('Die Bestellung wurde storniert bevor ein VK erstellt wurde.');
        output.text('Beide Zeilen können als erledigt markiert werden.');

        const aktion = await input.buttonsAsync('Aktion:', [
            { label: '✅ Alle Zeilen erledigt', value: 'erledigt', variant: 'primary' },
            { label: '↩️ Zurücksetzen auf false', value: 'reset' },
            { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
        ]);
        if (aktion === 'stop') return 'stop';
        if (aktion === 'reset') { await setzeProcessed(tblImport, zeilen, 'false'); output.text('↩️ Zurückgesetzt'); return 'weiter'; }
        await setzeProcessed(tblImport, zeilen, 'true');
        output.text('✅ Alle Zeilen als erledigt markiert (stornierter Kauf, kein VK erstellt)');
        return 'weiter';
    }

    if (vkRecord) {
        const alterPreis = vkRecord.getCellValue('VK_Preis') || 0;
        const alteGebuehren = vkRecord.getCellValue('VK_Plattform_Kosten') || 0;

        const neuerPreis = alterPreis + warenWertDelta;
        const neueGebuehren = Math.max(0, alteGebuehren - gebuehrenDelta);

        const istVollstorno = Math.abs(neuerPreis) < 0.05;

        output.markdown('### 📊 VK-Situation');
        output.text(`VK-Lot: ${vkLot}`);
        output.markdown(`
| | Alt | Neu | Delta |
|--|-----|-----|-------|
| VK_Preis | ${alterPreis.toFixed(2)} € | ${neuerPreis.toFixed(2)} € | ${warenWertDelta.toFixed(2)} € |
| VK_Plattform_Kosten | ${alteGebuehren.toFixed(2)} € | ${neueGebuehren.toFixed(2)} € | -${gebuehrenDelta.toFixed(2)} € |`);
        output.text(`Erstatteter Warenwert: ${Math.abs(warenWertDelta).toFixed(2)} € | Gebühren-Gutschrift: ${gebuehrenDelta.toFixed(2)} €`);

        if (istVollstorno) {
            output.markdown('> ⚠️ **Vollständige Rückerstattung erkannt** (neuer VK_Preis ≈ 0 €)');
        }

        output.markdown(`
**Optionen:**
💱 Nur Zahlen: Preis/Gebühren anpassen, Artikel bleibt "verkauft" (Teil-Rückerstattung)
🔄 Vollständig: → 📦 Zurück auf Lager | 🚫 Nicht versendet | 📭 Verloren/Abschreibung`);

        const aktion = await input.buttonsAsync('Was tun?', [
            ...(istVollstorno ? [] : [{ label: '💱 Nur Zahlen anpassen', value: 'anpassen', variant: 'primary' }]),
            { label: '🔄 Vollständig stornieren', value: 'storno', variant: istVollstorno ? 'primary' : 'default' },
            { label: '✅ Erledigt (keine Aktion)', value: 'erledigt' },
            { label: '↩️ Zurücksetzen auf false', value: 'reset' },
            { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
        ]);

        if (aktion === 'stop') return 'stop';
        if (aktion === 'reset') { await setzeProcessed(tblImport, zeilen, 'false'); output.text('↩️ Zurückgesetzt auf false'); return 'weiter'; }
        if (aktion === 'erledigt') { await setzeProcessed(tblImport, zeilen, 'true'); output.text('✅ Erledigt'); return 'weiter'; }

        if (aktion === 'anpassen') {
            await tblVerkauf.updateRecordAsync(vkRecord.id, {
                'VK_Preis': neuerPreis,
                'VK_Plattform_Kosten': neueGebuehren
            });
            await setzeProcessedMitVkLot(tblImport, zeilen, 'true', vkLot);
            output.markdown(`### ✅ ${vkLot} angepasst → Preis ${neuerPreis.toFixed(2)} €, Gebühren ${neueGebuehren.toFixed(2)} €`);
            return 'weiter';
        }

        if (aktion === 'storno') {
            const stornoResult = await storniereVerkaufInline(vkRecord, vkLot, zeilen, tblImport, tblArtikel, tblVerkauf, artikelRecords, gebuehrenDelta, istVollstorno);
            if (stornoResult === 'stop') return 'stop';
            if (stornoResult === 'erledigt') await setzeProcessedMitVkLot(tblImport, zeilen, 'true', vkLot);
            return 'weiter';
        }
    }

    if (vkLot) {
        output.text(`⚠️ VK-Lot ${vkLot} nicht in Verkauf_2026 gefunden`);
    } else {
        output.text('⚠️ Kein VK-Lot verknüpft');
        if (skus.length) output.text(`Artikelnr: ${skus.join(', ')}`);
    }
    output.text(`Erstatteter Warenwert: ${Math.abs(warenWertDelta).toFixed(2)} € | Gebühren-Gutschrift: ${gebuehrenDelta.toFixed(2)} €`);

    const grundAuswahl = await input.buttonsAsync('Was ist passiert?', [
        { label: '🚫 Kauf abgebrochen / nicht gezahlt', value: 'abgebrochen', variant: 'primary' },
        { label: '🔍 VK-Lot manuell eingeben', value: 'vk_suchen' },
        { label: '✅ Erledigt (keine Aktion)', value: 'erledigt' },
        { label: '↩️ Zurücksetzen auf false', value: 'reset' },
        { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
    ]);

    if (grundAuswahl === 'stop') return 'stop';

    if (grundAuswahl === 'abgebrochen') {
        await setzeProcessed(tblImport, zeilen, 'true');
        output.text('✅ Als erledigt markiert (Kauf abgebrochen, kein VK erstellt)');
        return 'weiter';
    }

    if (grundAuswahl === 'erledigt') {
        await setzeProcessed(tblImport, zeilen, 'true');
        output.text('✅ Erledigt');
        return 'weiter';
    }

    if (grundAuswahl === 'reset') {
        await setzeProcessed(tblImport, zeilen, 'false');
        output.text('↩️ Zurückgesetzt auf false');
        return 'weiter';
    }

    if (grundAuswahl === 'vk_suchen') {
        const lotEingabe = await input.textAsync('VK-Lot eingeben (z.B. VK26/042):');
        if (lotEingabe?.trim()) {
            const gefunden = verkaufRecords.records.find(r => r.getCellValueAsString('VK_Lot') === lotEingabe.trim());
            if (!gefunden) {
                output.text(`❌ ${lotEingabe.trim()} nicht gefunden`);
            } else {
                const alterPreis = gefunden.getCellValue('VK_Preis') || 0;
                const alteGebuehren = gefunden.getCellValue('VK_Plattform_Kosten') || 0;
                const neuerPreis = alterPreis + warenWertDelta;
                const neueGebuehren = Math.max(0, alteGebuehren - gebuehrenDelta);
                output.markdown('### 📊 VK-Anpassung');
                output.text(`VK-Lot: ${lotEingabe.trim()}`);
                output.markdown(`
| | Alt | Neu | Delta |
|--|-----|-----|-------|
| VK_Preis | ${alterPreis.toFixed(2)} € | ${neuerPreis.toFixed(2)} € | ${warenWertDelta.toFixed(2)} € |
| VK_Plattform_Kosten | ${alteGebuehren.toFixed(2)} € | ${neueGebuehren.toFixed(2)} € | -${gebuehrenDelta.toFixed(2)} € |`);
                const ok = await input.buttonsAsync('VK anpassen?', [
                    { label: '✅ Ja, anpassen', value: true, variant: 'primary' },
                    { label: '❌ Abbrechen', value: false }
                ]);
                if (ok) {
                    await tblVerkauf.updateRecordAsync(gefunden.id, {
                        'VK_Preis': neuerPreis,
                        'VK_Plattform_Kosten': neueGebuehren
                    });
                    await setzeProcessedMitVkLot(tblImport, zeilen, 'true', lotEingabe.trim());
                    output.markdown(`### ✅ ${lotEingabe.trim()} angepasst → Preis ${neuerPreis.toFixed(2)} €`);
                    return 'weiter';
                }
            }
        }
    }

    return await standardAktionen(zeilen, tblImport);
}

// ============================================================
// STORNO-FLOW INLINE
// ============================================================

async function storniereVerkaufInline(vkRecord, vkLot, zeilen, tblImport, tblArtikel, tblVerkauf, artikelRecords, gebuehrenDelta = 0, istVollstorno = false) {
    output.markdown('---');
    output.markdown(`## 🔄 Storno: ${vkLot}`);

    const vkPreis = vkRecord.getCellValue('VK_Preis') || 0;
    const versandkosten = vkRecord.getCellValue('VK_Versandkosten') || 0;
    const plattformKosten = vkRecord.getCellValue('VK_Plattform_Kosten') || 0;

    const verknuepfteArtikel = artikelRecords.records
        .filter(a => {
            const lots = a.getCellValue('ITEM_VK_Lot');
            return lots && lots.some(l => l.id === vkRecord.id);
        })
        .map(a => ({
            recordId: a.id,
            itemNr: a.getCellValueAsString('ITEM_Artikelnummer'),
            name: a.getCellValueAsString('ITEM_Artikel'),
            konsole: a.getCellValueAsString('ITEM_Konsole') || '?',
            vkPreis: a.getCellValue('ITEM_VK_Preis')
        }));

    const fixeGebuehrenInfo = Math.max(0, plattformKosten - gebuehrenDelta);
    output.text(`VK-Preis: ${vkPreis.toFixed(2)} € | Versand: ${versandkosten.toFixed(2)} € | Plattform: ${fixeGebuehrenInfo.toFixed(2)} € (fixer Anteil nach Gutschrift)`);
    if (verknuepfteArtikel.length) {
        let t = '| # | SKU | Konsole | Artikel | VK-Preis |\n|---|-----|---------|---------|----------|\n';
        verknuepfteArtikel.forEach((a, i) => {
            t += `| ${i+1} | ${a.itemNr} | ${a.konsole} | ${(a.name||'').substring(0,35)} | ${a.vkPreis ? a.vkPreis.toFixed(2)+' €' : '-'} |\n`;
        });
        output.markdown(t);
    } else {
        output.text('⚠️ Keine Artikel im Cache gefunden — lade direkt aus Airtable...');
        const frischQuery = await tblArtikel.selectRecordsAsync({
            fields: ['ITEM_Artikelnummer','ITEM_Artikel','ITEM_Konsole','ITEM_VK_Lot','ITEM_VK_Preis','ITEM_Status']
        });
        const frisch = frischQuery.records.filter(a => {
            const lots = a.getCellValue('ITEM_VK_Lot');
            return lots && lots.some(l => l.id === vkRecord.id);
        }).map(a => ({
            recordId: a.id,
            itemNr: a.getCellValueAsString('ITEM_Artikelnummer'),
            name: a.getCellValueAsString('ITEM_Artikel'),
            konsole: a.getCellValueAsString('ITEM_Konsole') || '?',
            vkPreis: a.getCellValue('ITEM_VK_Preis')
        }));

        if (frisch.length) {
            output.text(`✅ ${frisch.length} Artikel direkt geladen:`);
            frisch.forEach(a => output.text(`  • ${a.itemNr} | ${a.konsole} | ${a.name}`));
            verknuepfteArtikel.push(...frisch);
        } else {
            output.markdown('> ❌ **Keine Artikel verknüpft** — VK-Lot hat keine verlinkten Artikel in Airtable.\n> Storno wird trotzdem durchgeführt, aber Artikel-Status muss manuell korrigiert werden.');
        }
    }

    let stornoTypButtons;
    if (istVollstorno) {
        stornoTypButtons = [
            { label: '📦 Artikel zurück auf Lager', value: 'zurueck', variant: 'primary' },
            { label: '🚫 Nicht versendet (Kauf abgebrochen)', value: 'nicht_versendet_direkt', variant: 'primary' },
            { label: '📭 Artikel verloren / nicht angekommen', value: 'verloren', variant: 'primary' },
            { label: '❌ Abbrechen', value: 'stop', variant: 'danger' }
        ];
    } else {
        stornoTypButtons = [
            { label: '📦 A) Artikel zurückgeschickt', value: 'zurueck', variant: 'primary' },
            { label: '🚫 B) Kunde behält (Komplett-Erstattung)', value: 'behaelt' },
            { label: '💰 C) Teil-Rückerstattung', value: 'teil' },
            { label: '❌ Abbrechen', value: 'stop', variant: 'danger' }
        ];
    }
    const stornoTyp = await input.buttonsAsync('Was ist passiert?', stornoTypButtons);

    if (stornoTyp === 'stop') return 'stop';

    if (stornoTyp === 'verloren') {
        const fixeGebuehren = Math.max(0, plattformKosten - gebuehrenDelta);
        output.markdown('### 📭 Artikel verloren / nicht angekommen');
        output.text(`VK → storniert | Preis 0 € | Plattform ${fixeGebuehren.toFixed(2)} € | Versand ${versandkosten.toFixed(2)} € bleibt`);
        output.markdown('> Artikel werden auf **Abschreibung 2026** gesetzt (Totalverlust)');
        verknuepfteArtikel.forEach(a => output.text(`• ${a.itemNr} | ${a.konsole} | ${a.name}`));

        const ok = await input.buttonsAsync('⚠️ Stornierung durchführen?', [
            { label: '✅ Ja', value: true, variant: 'danger' },
            { label: '❌ Abbrechen', value: false }
        ]);
        if (!ok) return 'weiter';

        await tblVerkauf.updateRecordAsync(vkRecord.id, {
            'VK_Status': { name: 'storniert' },
            'VK_Preis': 0,
            'VK_Plattform_Kosten': fixeGebuehren,
            'VK_Versandkosten': versandkosten
        });

        for (const a of verknuepfteArtikel) {
            await tblArtikel.updateRecordAsync(a.recordId, {
                'ITEM_Status': { name: 'Abschreibung 2026' },
                'ITEM_VK_Preis': null,
                'ITEM_VK_Lot': []
            });
            output.text(`✅ ${a.itemNr} → Abschreibung 2026`);
        }
        output.markdown(`### ✅ ${vkLot} storniert – Artikel abgeschrieben (Totalverlust)`);
        return 'erledigt';
    }

    if (stornoTyp === 'nicht_versendet_direkt') {
        const fixeGebuehren = Math.max(0, plattformKosten - gebuehrenDelta);
        output.markdown('### 📋 Zusammenfassung');
        output.text(`VK ${vkLot}: Preis 0 €, Plattform ${fixeGebuehren.toFixed(2)} € (fixer Anteil), Versand 0 € (nicht versendet)`);
        verknuepfteArtikel.forEach(a => output.text(`• ${a.itemNr} → zurück auf Lager`));

        const ok = await input.buttonsAsync('⚠️ Stornierung durchführen?', [
            { label: '✅ Ja', value: true, variant: 'danger' },
            { label: '❌ Abbrechen', value: false }
        ]);
        if (!ok) return 'weiter';

        await tblVerkauf.updateRecordAsync(vkRecord.id, {
            'VK_Status': { name: 'storniert' },
            'VK_Preis': 0,
            'VK_Plattform_Kosten': fixeGebuehren,
            'VK_Versandkosten': 0
        });

        for (const a of verknuepfteArtikel) {
            await tblArtikel.updateRecordAsync(a.recordId, {
                'ITEM_Status': { name: 'auf Lager' },
                'ITEM_VK_Preis': null,
                'ITEM_VK_Lot': []
            });
            output.text(`✅ ${a.itemNr} → auf Lager`);
        }
        output.markdown(`### ✅ ${vkLot} storniert – nicht versendet`);
        return 'erledigt';
    }

    if (stornoTyp === 'zurueck') {
        const artikelAktionen = [];

        if (verknuepfteArtikel.length === 0) {
            output.markdown('> ⚠️ Keine Artikel verknüpft — Artikel-Status muss manuell in Airtable korrigiert werden.');
        }

        for (let i = 0; i < verknuepfteArtikel.length; i++) {
            const a = verknuepfteArtikel[i];
            output.markdown(`**Artikel ${i+1}/${verknuepfteArtikel.length}: ${a.itemNr} | ${a.konsole} | ${a.name}**`);
            const neueNummer = await input.textAsync('Neue ITEM-Nummer (oder "0" für Sonderstatus):');

            if (!neueNummer || neueNummer.trim() === '0' || neueNummer.trim() === '') {
                const statusAuswahl = await input.buttonsAsync(`Status für "${a.name}":`, [
                    { label: '🗑️ Abschreibung 2026', value: 'Abschreibung 2026', variant: 'danger' },
                    { label: '✅ verkauft (bleibt beim Kunden)', value: 'verkauft' },
                    { label: '📦 auf Lager (doch zurück)', value: 'auf Lager' },
                    { label: '⏭️ Überspringen', value: null }
                ]);
                if (statusAuswahl) {
                    artikelAktionen.push({ ...a, aktion: 'status', neuerStatus: statusAuswahl });
                    output.text(`→ ${a.itemNr}: ${statusAuswahl}`);
                }
            } else {
                artikelAktionen.push({ ...a, aktion: 'lager', neueNummer: neueNummer.trim() });
                output.text(`→ ${a.itemNr} → ${neueNummer.trim()} (auf Lager)`);
            }
        }

        const versandEtikettZeilen = zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Versandetikett');
        let rueckversandKosten = 0;
        let nichtVersendet = false;

        if (versandEtikettZeilen.length > 0) {
            for (const vz of versandEtikettZeilen) {
                rueckversandKosten += Math.abs(parseFloat(vz.getCellValue('PIMP_AmountGross') || 0));
            }
            output.text(`→ Rückversand aus PIMP-Versandetikett: ${rueckversandKosten.toFixed(2)} € (eBay-Portal)`);
        } else {
            const rueckversandZahler = await input.buttonsAsync('Versand-Situation:', [
                { label: '🚫 Nicht versendet', value: 'nicht_versendet', variant: 'primary' },
                { label: '👤 Versendet, Rückversand vom Käufer', value: 'kunde' },
                { label: '🏪 Versendet, Rückversand von uns', value: 'wir' },
                { label: '📦 Versendet, kein Rückversand', value: 'keiner' }
            ]);
            if (rueckversandZahler === 'nicht_versendet') {
                nichtVersendet = true;
                output.text('→ Nicht versendet → Versandkosten = 0');
            } else if (rueckversandZahler === 'wir') {
                const rvStr = await input.textAsync('Rückversandkosten (€):');
                rueckversandKosten = parseFloat((rvStr || '0').replace(',', '.')) || 0;
                output.text(`→ Rückversand: ${rueckversandKosten.toFixed(2)} € (von uns)`);
            }
        }

        const gesamtVersand = nichtVersendet ? 0 : versandkosten + rueckversandKosten;
        const fixeGebuehren = Math.max(0, plattformKosten - gebuehrenDelta);

        output.markdown('### 📋 Zusammenfassung');
        output.text(`VK ${vkLot}: Preis 0 €, Plattform ${fixeGebuehren.toFixed(2)} € (fixer Anteil), Versand ${gesamtVersand.toFixed(2)} €`);
        artikelAktionen.forEach(a => {
            if (a.aktion === 'lager') output.text(`• ${a.itemNr} → ${a.neueNummer} (auf Lager)`);
            else output.text(`• ${a.itemNr} → ${a.neuerStatus}`);
        });

        const ok = await input.buttonsAsync('⚠️ Stornierung durchführen?', [
            { label: '✅ Ja', value: true, variant: 'danger' },
            { label: '❌ Abbrechen', value: false }
        ]);
        if (!ok) return 'weiter';

        await tblVerkauf.updateRecordAsync(vkRecord.id, {
            'VK_Status': { name: 'storniert' },
            'VK_Preis': 0,
            'VK_Plattform_Kosten': fixeGebuehren,
            'VK_Versandkosten': gesamtVersand
        });

        for (const a of artikelAktionen) {
            if (a.aktion === 'lager') {
                await tblArtikel.updateRecordAsync(a.recordId, {
                    'ITEM_Artikelnummer': a.neueNummer,
                    'ITEM_Status': { name: 'auf Lager' },
                    'ITEM_VK_Preis': null,
                    'ITEM_VK_Lot': []
                });
            } else {
                const upd = { 'ITEM_Status': { name: a.neuerStatus } };
                if (a.neuerStatus !== 'verkauft') { upd['ITEM_VK_Preis'] = null; upd['ITEM_VK_Lot'] = []; }
                await tblArtikel.updateRecordAsync(a.recordId, upd);
            }
        }

        output.markdown(`### ✅ ${vkLot} storniert – ${artikelAktionen.filter(a=>a.aktion==='lager').length} Artikel zurück auf Lager`);
        return 'erledigt';
    }

    if (stornoTyp === 'behaelt') {
        const fixeGebuehren = Math.max(0, plattformKosten - gebuehrenDelta);
        output.text(`VK → storniert, Preis 0 €, Plattform ${fixeGebuehren.toFixed(2)} € (fixer Anteil), Artikel bleiben "verkauft"`);
        const ok = await input.buttonsAsync('⚠️ Durchführen?', [
            { label: '✅ Ja', value: true, variant: 'danger' },
            { label: '❌ Abbrechen', value: false }
        ]);
        if (!ok) return 'weiter';

        await tblVerkauf.updateRecordAsync(vkRecord.id, {
            'VK_Status': { name: 'storniert' },
            'VK_Preis': 0,
            'VK_Plattform_Kosten': fixeGebuehren
        });

        output.markdown(`### ✅ ${vkLot} storniert – Artikel bleiben beim Kunden`);
        return 'erledigt';
    }

    if (stornoTyp === 'teil') {
        output.text(`Aktueller VK_Preis: ${vkPreis.toFixed(2)} € | Plattform: ${plattformKosten.toFixed(2)} €`);
        const rueckStr = await input.textAsync('Wie viel wird zurückerstattet (€)?');
        const rueckBetrag = parseFloat((rueckStr || '0').replace(',', '.')) || 0;
        const neuerPreis = vkPreis - rueckBetrag;
        const anteil = vkPreis > 0 ? neuerPreis / vkPreis : 1;
        const neuePlattformKosten = plattformKosten * anteil;

        output.text(`Neu: Preis ${neuerPreis.toFixed(2)} € | Plattform ${neuePlattformKosten.toFixed(2)} € (anteilig)`);

        const plattformAnpassen = await input.buttonsAsync('Plattform-Kosten anteilig anpassen?', [
            { label: `✅ Ja → ${neuePlattformKosten.toFixed(2)} €`, value: true, variant: 'primary' },
            { label: 'Nein, behalten', value: false }
        ]);

        const ok = await input.buttonsAsync('⚠️ Speichern?', [
            { label: '✅ Ja', value: true, variant: 'primary' },
            { label: '❌ Abbrechen', value: false }
        ]);
        if (!ok) return 'weiter';

        const upd = { 'VK_Preis': neuerPreis };
        if (plattformAnpassen) upd['VK_Plattform_Kosten'] = neuePlattformKosten;
        await tblVerkauf.updateRecordAsync(vkRecord.id, upd);

        output.markdown(`### ✅ ${vkLot} angepasst → Preis ${neuerPreis.toFixed(2)} €, Rückerstattung ${rueckBetrag.toFixed(2)} €`);
        return 'erledigt';
    }

    return 'weiter';
}

async function handleEinbehalten(orderId, zeilen, tblImport, verkaufRecords, importRecords) {
    output.markdown('## 🔒 Einbehalten');
    zeigeZeilenTabelle(zeilen);
    let summe = 0;
    for (const z of zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Einbehalten'))
        summe += z.getCellValue('PIMP_AmountGross') || 0;
    output.text(`Einbehalten-Summe: ${summe.toFixed(2)} € → Nur Info, kann als erledigt markiert werden.`);
    return await standardAktionen(zeilen, tblImport);
}

async function handleVersandetikett(orderId, zeilen, tblImport, tblVerkauf, verkaufRecords, importRecords) {
    output.markdown('## 📦 Versandetikett ohne Bestellung');
    zeigeZeilenTabelle(zeilen);

    let vkLot = null;
    for (const z of zeilen) { const l = z.getCellValueAsString('PIMP_VK_Lot'); if (l) { vkLot = l; break; } }
    if (!vkLot) {
        const alle = importRecords.records.filter(r => r.getCellValueAsString('PIMP_OrderId') === orderId);
        for (const z of alle) { const l = z.getCellValueAsString('PIMP_VK_Lot'); if (l) { vkLot = l; break; } }
    }

    const vkRecord = vkLot
        ? verkaufRecords.records.find(r => r.getCellValueAsString('VK_Lot') === vkLot)
        : null;

    let etikettSumme = 0;
    for (const z of zeilen) {
        etikettSumme += parseFloat(z.getCellValue('PIMP_AmountGross') || 0);
    }
    const etikettBetrag = Math.abs(etikettSumme);

    if (vkRecord) {
        const aktuelleVersandkosten = vkRecord.getCellValue('VK_Versandkosten') || 0;
        const neueVersandkosten = aktuelleVersandkosten + etikettBetrag;

        output.markdown('### 📊 VK gefunden');
        output.text(`VK-Lot: ${vkLot}`);
        output.text(`VK_Versandkosten: ${aktuelleVersandkosten.toFixed(2)} € + ${etikettBetrag.toFixed(2)} € = ${neueVersandkosten.toFixed(2)} €`);

        const aktion = await input.buttonsAsync('VK_Versandkosten aktualisieren?', [
            { label: `✅ Ja → ${neueVersandkosten.toFixed(2)} €`, value: 'anpassen', variant: 'primary' },
            { label: '✅ Erledigt (keine Aktion)', value: 'erledigt' },
            { label: '⏭️ Weiter', value: 'weiter' },
            { label: '↩️ Zurücksetzen auf false', value: 'reset' },
            { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
        ]);

        if (aktion === 'stop') return 'stop';
        if (aktion === 'reset') { await setzeProcessed(tblImport, zeilen, 'false'); output.text('↩️ Zurückgesetzt auf false'); return 'weiter'; }
        if (aktion === 'weiter') return 'weiter';
        if (aktion === 'erledigt') { await setzeProcessedMitVkLot(tblImport, zeilen, 'true', vkLot); output.text('✅ Erledigt'); return 'weiter'; }

        if (aktion === 'anpassen') {
            await tblVerkauf.updateRecordAsync(vkRecord.id, { 'VK_Versandkosten': neueVersandkosten });
            await setzeProcessedMitVkLot(tblImport, zeilen, 'true', vkLot);
            output.markdown(`### ✅ ${vkLot} aktualisiert → VK_Versandkosten: ${neueVersandkosten.toFixed(2)} €`);
            return 'weiter';
        }
    }

    output.markdown('### ⚠️ Kein VK-Lot gefunden');
    output.text(`Etikett-Betrag: ${etikettBetrag.toFixed(2)} €`);

    const grundAuswahl = await input.buttonsAsync('Was tun?', [
        { label: '🔍 VK-Lot manuell eingeben', value: 'vk_suchen', variant: 'primary' },
        { label: '✅ Erledigt (keine Aktion)', value: 'erledigt' },
        { label: '⏭️ Weiter', value: 'weiter' },
        { label: '↩️ Zurücksetzen auf false', value: 'reset' },
        { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
    ]);

    if (grundAuswahl === 'stop') return 'stop';
    if (grundAuswahl === 'weiter') return 'weiter';
    if (grundAuswahl === 'erledigt') { await setzeProcessed(tblImport, zeilen, 'true'); output.text('✅ Erledigt'); return 'weiter'; }
    if (grundAuswahl === 'reset') { await setzeProcessed(tblImport, zeilen, 'false'); output.text('↩️ Zurückgesetzt auf false'); return 'weiter'; }

    if (grundAuswahl === 'vk_suchen') {
        const lotEingabe = await input.textAsync('VK-Lot eingeben (z.B. VK26/042):');
        if (lotEingabe?.trim()) {
            const gefunden = verkaufRecords.records.find(r => r.getCellValueAsString('VK_Lot') === lotEingabe.trim());
            if (!gefunden) {
                output.text(`❌ ${lotEingabe.trim()} nicht gefunden`);
                return await standardAktionen(zeilen, tblImport);
            }
            const aktuelleVersandkosten = gefunden.getCellValue('VK_Versandkosten') || 0;
            const neueVersandkosten = aktuelleVersandkosten + etikettBetrag;
            output.text(`VK_Versandkosten: ${aktuelleVersandkosten.toFixed(2)} € + ${etikettBetrag.toFixed(2)} € = ${neueVersandkosten.toFixed(2)} €`);
            const ok = await input.buttonsAsync('VK aktualisieren?', [
                { label: `✅ Ja → ${neueVersandkosten.toFixed(2)} €`, value: true, variant: 'primary' },
                { label: '❌ Abbrechen', value: false }
            ]);
            if (ok) {
                await tblVerkauf.updateRecordAsync(gefunden.id, { 'VK_Versandkosten': neueVersandkosten });
                await setzeProcessedMitVkLot(tblImport, zeilen, 'true', lotEingabe.trim());
                output.markdown(`### ✅ ${lotEingabe.trim()} aktualisiert → VK_Versandkosten: ${neueVersandkosten.toFixed(2)} €`);
                return 'weiter';
            }
        }
    }

    return await standardAktionen(zeilen, tblImport);
}

async function handleAndereGebuehr(zeilen, tblImport) {
    output.markdown('## 💰 Andere Gebühr');
    zeigeZeilenTabelle(zeilen);
    output.text('→ Wird über PIMP-Verarbeitung als BA erfasst.');
    return await standardAktionen(zeilen, tblImport);
}

// ============================================================
// HANDLER: BESTELLUNG
// ============================================================

async function handleBestellung(orderId, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords) {
    const bestellZeilen = zeilen.filter(z =>
        z.getCellValueAsString('PIMP_RowType') === 'Bestellung' && z.getCellValueAsString('PIMP_ItemNo')
    );

    if (!bestellZeilen.length) {
        const alleBestellungen = zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung');
        if (alleBestellungen.length) {
            return await handleBestellungInner(orderId, zeilen, alleBestellungen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords);
        }
        output.markdown('## ❓ Bestellung ohne Artikel-Zeilen');
        return await standardAktionen(zeilen, tblImport);
    }

    return await handleBestellungInner(orderId, zeilen, bestellZeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords);
}

async function handleBestellungInner(orderId, zeilen, bestellZeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords) {
    for (const zeile of bestellZeilen) {
        const sku = zeile.getCellValueAsString('PIMP_SKU');
        const importTitel = zeile.getCellValueAsString('PIMP_Title') || '';
        const itemNo = zeile.getCellValueAsString('PIMP_ItemNo');
        const menge = parseInt(zeile.getCellValue('PIMP_Quantity')) || 1;

        const kopfZeile = zeilen.find(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung' && !z.getCellValueAsString('PIMP_ItemNo'));
        let gesamtPreis = kopfZeile ? parseFloat(kopfZeile.getCellValue('PIMP_AmountGross') || 0) : 0;
        if (!gesamtPreis) gesamtPreis = parseFloat(zeile.getCellValue('PIMP_AmountGross') || 0);

        if (!sku) {
            output.markdown('## 🏷️ SKU fehlt');
            output.text(`Titel: ${importTitel}\nItemNo: ${itemNo || '-'}`);
            if (menge > 1) output.text(`⚠️ Menge: ${menge} Stück`);

            const vorschlaege = findeArtikelVorschlaege(artikelRecords, importTitel, 5);
            let neueSku = null;

            if (vorschlaege.length) {
                let t = '| Score | SKU | Konsole | Artikel |\n|-------|-----|---------|---------|';
                for (const v of vorschlaege) t += `\n| ${(v.score*100).toFixed(0)}% | ${v.sku} | ${v.konsole} | ${v.name.substring(0,40)}${v.name.length>40?'...':''} |`;
                output.markdown(t);

                const buttons = vorschlaege.map(v => ({ label: `${(v.score*100).toFixed(0)}% | ${v.sku} | ${v.name.substring(0,20)}`, value: v.sku }));
                buttons.push({ label: '📦 Set/Bundle', value: '_mehrere' });
                buttons.push({ label: '➕ Neuer Artikel', value: '_neu' });
                buttons.push({ label: '🔍 Suchen', value: '_suchen' });
                buttons.push({ label: '✏️ Direkt eingeben', value: '_direkt' });
                buttons.push({ label: '⏭️ Weiter', value: '_weiter' });
                buttons.push({ label: '🛑 Abbrechen', value: '_stop', variant: 'danger' });

                const auswahl = await input.buttonsAsync('Artikel wählen:', buttons);
                if (auswahl === '_stop') return 'stop';
                if (auswahl === '_weiter') return 'weiter';
                if (auswahl === '_mehrere') {
                    const r = await erfasseMehrereArtikel(zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords, importTitel, gesamtPreis);
                    return r === 'erstellt' ? 'vkErstellt' : 'weiter';
                }
                if (auswahl === '_neu') {
                    const result = await neuerArtikelAnlegen(importTitel, gesamtPreis, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords);
                    if (result === 'vkErstellt') return 'vkErstellt';
                    if (result === 'stop') return 'stop';
                    return 'weiter';
                }
                if (auswahl === '_suchen') neueSku = await manuelleArtikelSuche(artikelRecords);
                else if (auswahl === '_direkt') { const e = await input.textAsync('SKU eingeben:'); if (e?.trim()) neueSku = e.trim(); }
                else neueSku = auswahl;
            } else {
                output.text('⚠️ Keine passenden Artikel gefunden');
                const aktion = await input.buttonsAsync('Was tun?', [
                    { label: '📦 Set/Bundle', value: 'mehrere' },
                    { label: '➕ Neuer Artikel', value: 'neu' },
                    { label: '🔍 Suchen', value: 'suchen' },
                    { label: '✏️ Direkt eingeben', value: 'direkt' },
                    { label: '⏭️ Weiter', value: 'weiter' },
                    { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
                ]);
                if (aktion === 'stop') return 'stop';
                if (aktion === 'weiter') return 'weiter';
                if (aktion === 'mehrere') {
                    const r = await erfasseMehrereArtikel(zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords, importTitel, gesamtPreis);
                    return r === 'erstellt' ? 'vkErstellt' : 'weiter';
                }
                if (aktion === 'neu') {
                    const result = await neuerArtikelAnlegen(importTitel, gesamtPreis, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords);
                    if (result === 'vkErstellt') return 'vkErstellt';
                    if (result === 'stop') return 'stop';
                    return 'weiter';
                }
                if (aktion === 'suchen') neueSku = await manuelleArtikelSuche(artikelRecords);
                else if (aktion === 'direkt') { const e = await input.textAsync('SKU eingeben:'); if (e?.trim()) neueSku = e.trim(); }
            }

            if (neueSku && neueSku !== '_abbrechen') {
                const zuAkt = itemNo
                    ? zeilen.filter(z => z.getCellValueAsString('PIMP_ItemNo') === itemNo && z.getCellValueAsString('PIMP_RowType') === 'Bestellung')
                    : zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung');
                for (const z of zuAkt) await tblImport.updateRecordAsync(z.id, { 'PIMP_SKU': neueSku });
                output.text(`✅ SKU "${neueSku}" eingetragen`);

                const result = await versucheVkErstellung(
                    neueSku, importTitel, gesamtPreis, zeilen,
                    tblImport, tblArtikel, tblVerkauf, tblPartner,
                    artikelRecords, partnerRecords, partnerCache, verkaufRecords
                );
                if (result === 'vkErstellt') return 'vkErstellt';
                if (result === 'stop') return 'stop';
                return 'weiter';
            }
            return 'weiter';
        }

        if (sku.includes(',')) {
            const skuNummern = sku.split(',').map(s => s.trim()).filter(s => s.length);
            output.markdown('## 📦 Bundle erkannt (automatisch)');
            output.text(`SKUs: ${skuNummern.join(', ')}`);
            output.text(`Titel: ${importTitel}`);

            const gefunden = [];
            const fehler = [];
            for (const nr of skuNummern) {
                const matches = artikelRecords.records.filter(a => a.getCellValueAsString('ITEM_Artikelnummer') === nr);
                if (!matches.length) { fehler.push(`❌ ${nr}: Nicht in Artikeldatenbank`); continue; }
                const aufLager = matches.filter(a => a.getCellValueAsString('ITEM_Status') === 'auf Lager');
                if (!aufLager.length) { fehler.push(`⚠️ ${nr}: ${matches[0].getCellValueAsString('ITEM_Artikel').substring(0,30)} → Status: ${matches[0].getCellValueAsString('ITEM_Status')}`); continue; }
                gefunden.push(aufLager[0]);
            }

            if (fehler.length) {
                output.markdown('### ⚠️ Probleme:');
                for (const f of fehler) output.text(f);
            }

            if (!gefunden.length) {
                output.text('❌ Keine Artikel auf Lager gefunden');
                const aktion = await input.buttonsAsync('Was tun?', [
                    { label: '➕ Neue Artikel anlegen', value: 'neu', variant: 'primary' },
                    { label: '📦 Mehrere erfassen', value: 'mehrere' },
                    { label: '⏭️ Weiter', value: 'weiter' },
                    { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
                ]);
                if (aktion === 'stop') return 'stop';
                if (aktion === 'weiter') return 'weiter';
                if (aktion === 'neu') {
                    for (const nr of skuNummern) {
                        output.markdown(`### ➕ Neuen Artikel anlegen: ${nr}`);
                        const result = await neuerArtikelAnlegen(importTitel, gesamtPreis / skuNummern.length, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords);
                        if (result === 'stop') return 'stop';
                        if (result === 'vkErstellt') return 'vkErstellt';
                    }
                    return 'weiter';
                }
                if (aktion === 'mehrere') {
                    const r = await erfasseMehrereArtikel(zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords, importTitel, gesamtPreis);
                    return r === 'erstellt' ? 'vkErstellt' : 'weiter';
                }
                return 'weiter';
            }

            let t = '| # | SKU | Konsole | Artikel |\n|---|-----|---------|---------|';
            for (let i = 0; i < gefunden.length; i++) {
                const r = gefunden[i];
                t += `\n| ${i+1} | ${r.getCellValueAsString('ITEM_Artikelnummer')} | ${r.getCellValueAsString('ITEM_Konsole') || '-'} | ${r.getCellValueAsString('ITEM_Artikel').substring(0,40)}${r.getCellValueAsString('ITEM_Artikel').length>40?'...':''} |`;
            }
            output.markdown(t);

            const versandKunde = parseFloat(zeile.getCellValue('PIMP_Shipping') || 0);
            let warenWert = gesamtPreis - versandKunde;
            const ebayShippingFehler = warenWert <= 0 && versandKunde > 0;

            if (!ebayShippingFehler && versandKunde > 0) {
                output.text(`\nGesamt: ${gesamtPreis.toFixed(2)} € − Versand ${versandKunde.toFixed(2)} € = VK_Preis ${warenWert.toFixed(2)} € für ${gefunden.length} Artikel`);
            } else if (!ebayShippingFehler) {
                output.text(`\nGesamt: ${gesamtPreis.toFixed(2)} € für ${gefunden.length} Artikel`);
            }

            const modus = await input.buttonsAsync('Preisverteilung:', [
                { label: '1️⃣ Einzeln eingeben', value: 'einzeln', variant: 'primary' },
                { label: '2️⃣ Gleichmäßig verteilen', value: 'verteilen' },
                { label: '✏️ SKU korrigieren', value: 'korrigieren' },
                { label: '⏭️ Weiter', value: 'weiter' },
                { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
            ]);

            if (modus === 'stop') return 'stop';
            if (modus === 'weiter') return 'weiter';

            if (modus === 'korrigieren') {
                const neueSku = await input.textAsync('SKUs korrigieren (kommagetrennt):');
                if (neueSku?.trim()) {
                    const zuAkt = itemNo
                        ? zeilen.filter(z => z.getCellValueAsString('PIMP_ItemNo') === itemNo && z.getCellValueAsString('PIMP_RowType') === 'Bestellung')
                        : zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung');
                    for (const z of zuAkt) await tblImport.updateRecordAsync(z.id, { 'PIMP_SKU': neueSku.trim() });
                    await setzeProcessed(tblImport, zeilen, 'clearing');
                    output.text(`✅ SKU geändert zu "${neueSku.trim()}" → nochmal Clearing laufen lassen`);
                }
                return 'weiter';
            }

            let erfassteArtikel = [];

            if (ebayShippingFehler) {
                const bestellZeilen = zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung');
                for (const z of bestellZeilen) await tblImport.updateRecordAsync(z.id, { 'PIMP_Shipping': 0 });
                warenWert = gesamtPreis;
                output.text(`✅ eBay-Export-Fehler korrigiert: PIMP_Shipping auf 0 gesetzt → VK_Preis: ${gesamtPreis.toFixed(2)} €`);
            }

            if (modus === 'verteilen') {
                const pp = warenWert / gefunden.length;
                let summe = 0;
                for (let i = 0; i < gefunden.length; i++) {
                    if (i === gefunden.length - 1) erfassteArtikel.push({ artikelRecord: gefunden[i], einzelpreis: warenWert - summe });
                    else { const preis = Math.round(pp * 100) / 100; erfassteArtikel.push({ artikelRecord: gefunden[i], einzelpreis: preis }); summe += preis; }
                }
            } else {
                let rest = warenWert;
                for (let i = 0; i < gefunden.length; i++) {
                    const r = gefunden[i];
                    output.markdown(`**→ ${r.getCellValueAsString('ITEM_Artikelnummer')} | ${r.getCellValueAsString('ITEM_Konsole') || '-'} | ${r.getCellValueAsString('ITEM_Artikel')}**`);
                    output.text(`Noch zu verteilen: ${rest.toFixed(2)} €`);
                    let vorschlag = i === gefunden.length - 1 ? ` (Rest: ${rest.toFixed(2)} €)` : '';
                    const preisStr = await input.textAsync(`Preis für ${r.getCellValueAsString('ITEM_Artikelnummer')}${vorschlag}:`);
                    let preis = parseFloat((preisStr || '').replace(',', '.'));
                    if (isNaN(preis) && i === gefunden.length - 1) { preis = rest; output.text(`→ Rest übernommen: ${preis.toFixed(2)} €`); }
                    if (isNaN(preis)) { output.text('❌ Ungültiger Preis, übersprungen'); continue; }
                    erfassteArtikel.push({ artikelRecord: r, einzelpreis: preis });
                    rest -= preis;
                    output.text(`✅ ${r.getCellValueAsString('ITEM_Artikelnummer')} → ${preis.toFixed(2)} € | Rest: ${rest.toFixed(2)} €`);
                }
            }

            if (!erfassteArtikel.length) return 'weiter';

            output.markdown('### 📋 Zusammenfassung');
            let summe = 0;
            for (const a of erfassteArtikel) {
                output.text(`• ${a.artikelRecord.getCellValueAsString('ITEM_Artikelnummer')} | ${a.artikelRecord.getCellValueAsString('ITEM_Artikel').substring(0,40)} | ${a.einzelpreis.toFixed(2)} €`);
                summe += a.einzelpreis;
            }
            output.text(`Summe Artikel: ${summe.toFixed(2)} € (VK_Preis: ${warenWert.toFixed(2)} €)${versandKunde > 0 ? ` | Versand: ${versandKunde.toFixed(2)} €` : ''}`);
            output.text(`Gesamt: ${gesamtPreis.toFixed(2)} €`);

            const ok = await input.buttonsAsync('VK erstellen?', [
                { label: '✅ Ja', value: true, variant: 'primary' },
                { label: '❌ Abbrechen', value: false }
            ]);
            if (!ok) return 'weiter';

            return await erstelleVkAusMehreren(zeilen, erfassteArtikel, gesamtPreis, tblImport, tblArtikel, tblVerkauf, tblPartner, partnerRecords, partnerCache, verkaufRecords);
        }

        const artikelMitSku = artikelRecords.records.filter(a => a.getCellValueAsString('ITEM_Artikelnummer') === sku);
        if (!artikelMitSku.length) {
            output.markdown('## ❓ Artikel nicht gefunden');
            output.text(`SKU: ${sku}\nTitel: ${importTitel}`);
            const aktion = await input.buttonsAsync('Was tun?', [
                { label: '📦 Set/Bundle', value: 'mehrere', variant: 'primary' },
                { label: '➕ Neuer Artikel', value: 'neu' },
                { label: '✏️ SKU ändern', value: 'sku' },
                { label: '⏭️ Weiter', value: 'weiter' },
                { label: '✅ Erledigt', value: 'erledigt' },
                { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
            ]);
            if (aktion === 'stop') return 'stop';
            if (aktion === 'erledigt') { await setzeProcessed(tblImport, zeilen, 'true'); return 'erledigt'; }
            if (aktion === 'weiter') return 'weiter';
            if (aktion === 'mehrere') {
                const r = await erfasseMehrereArtikel(zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords, importTitel, gesamtPreis);
                return r === 'erstellt' ? 'vkErstellt' : 'weiter';
            }
            if (aktion === 'neu') {
                const result = await neuerArtikelAnlegen(importTitel, gesamtPreis, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords);
                if (result === 'vkErstellt') return 'vkErstellt';
                if (result === 'stop') return 'stop';
                return 'weiter';
            }
            if (aktion === 'sku') {
                const n = await input.textAsync('Neue SKU:');
                if (n?.trim()) {
                    await tblImport.updateRecordAsync(zeile.id, { 'PIMP_SKU': n.trim() });
                    output.text(`✅ SKU geändert zu "${n.trim()}"`);
                    const result = await versucheVkErstellung(
                        n.trim(), importTitel, gesamtPreis, zeilen,
                        tblImport, tblArtikel, tblVerkauf, tblPartner,
                        artikelRecords, partnerRecords, partnerCache, verkaufRecords
                    );
                    if (result === 'vkErstellt') return 'vkErstellt';
                    if (result === 'stop') return 'stop';
                }
            }
            return 'weiter';
        }

        const aufLager = artikelMitSku.filter(a => a.getCellValueAsString('ITEM_Status') === 'auf Lager');
        if (!aufLager.length) {
            output.markdown('## 📦 Artikel nicht auf Lager');
            output.text(`SKU: ${sku} | Status: ${artikelMitSku[0].getCellValueAsString('ITEM_Status')}`);
            const aktion = await input.buttonsAsync('Was tun?', [
                { label: '✏️ SKU ändern', value: 'sku', variant: 'primary' },
                { label: '📦 Set/Bundle', value: 'mehrere' },
                { label: '⏭️ Weiter', value: 'weiter' },
                { label: '✅ Erledigt', value: 'erledigt' },
                { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
            ]);
            if (aktion === 'stop') return 'stop';
            if (aktion === 'weiter') return 'weiter';
            if (aktion === 'erledigt') { await setzeProcessed(tblImport, zeilen, 'true'); return 'erledigt'; }
            if (aktion === 'mehrere') {
                const r = await erfasseMehrereArtikel(zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords, importTitel, gesamtPreis);
                return r === 'erstellt' ? 'vkErstellt' : 'weiter';
            }
            if (aktion === 'sku') {
                const n = await input.textAsync('Neue SKU(s) eingeben (kommagetrennt für Bundle):');
                if (n?.trim()) {
                    const zuAkt = itemNo
                        ? zeilen.filter(z => z.getCellValueAsString('PIMP_ItemNo') === itemNo && z.getCellValueAsString('PIMP_RowType') === 'Bestellung')
                        : zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung');
                    for (const z of zuAkt) await tblImport.updateRecordAsync(z.id, { 'PIMP_SKU': n.trim() });
                    output.text(`✅ SKU geändert zu "${n.trim()}"`);

                    if (n.trim().includes(',')) {
                        await setzeProcessed(tblImport, zeilen, 'clearing');
                        output.text('📦 Bundle erkannt → nochmal Clearing laufen lassen');
                    } else {
                        const result = await versucheVkErstellung(
                            n.trim(), importTitel, gesamtPreis, zeilen,
                            tblImport, tblArtikel, tblVerkauf, tblPartner,
                            artikelRecords, partnerRecords, partnerCache, verkaufRecords
                        );
                        if (result === 'vkErstellt') return 'vkErstellt';
                    }
                }
            }
            return 'weiter';
        }

        if (menge > 1 && aufLager.length < menge) {
            output.markdown('## 📦 Menge > Lagerbestand');
            output.text(`SKU: ${sku} | Menge: ${menge} | Auf Lager: ${aufLager.length}`);
            const aktion = await input.buttonsAsync('Was tun?', [
                { label: '📦 Mehrere erfassen', value: 'mehrere', variant: 'primary' },
                { label: '⏭️ Weiter', value: 'weiter' },
                { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
            ]);
            if (aktion === 'stop') return 'stop';
            if (aktion === 'weiter') return 'weiter';
            if (aktion === 'mehrere') {
                const r = await erfasseMehrereArtikel(zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords, importTitel, gesamtPreis);
                return r === 'erstellt' ? 'vkErstellt' : 'weiter';
            }
            return 'weiter';
        }

        const artikel = aufLager[0];
        const artikelTitel = artikel.getCellValueAsString('ITEM_Artikel') || '';
        const matchScore = berechneMatchScore(importTitel, artikelTitel);

        if (matchScore < CONFIG.titelMatchSchwelle) {
            output.markdown('## 📝 Titel stimmen nicht überein');
            output.text(`Match: ${(matchScore*100).toFixed(0)}% (min. ${CONFIG.titelMatchSchwelle*100}%)\nImport: ${importTitel}\nArtikel: ${artikelTitel}\nSKU: ${sku}`);

            const aktion = await input.buttonsAsync('Was tun?', [
                { label: '✅ Zusammenführen', value: 'zusammen', variant: 'primary' },
                { label: '📝 Import→Artikel', value: 'import_zu_artikel' },
                { label: '📝 Artikel→Import', value: 'artikel_zu_import' },
                { label: '✏️ SKU ändern', value: 'sku' },
                { label: '⏭️ Weiter', value: 'weiter' },
                { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
            ]);
            if (aktion === 'stop') return 'stop';
            if (aktion === 'weiter') return 'weiter';
            if (aktion === 'zusammen') {
                await tblImport.updateRecordAsync(zeile.id, { 'PIMP_Title': artikelTitel });
                const result = await versucheVkErstellung(sku, artikelTitel, gesamtPreis, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords);
                if (result === 'vkErstellt') return 'vkErstellt';
                return 'weiter';
            }
            if (aktion === 'import_zu_artikel') {
                await tblArtikel.updateRecordAsync(artikel.id, { 'ITEM_Artikel': importTitel });
                const result = await versucheVkErstellung(sku, importTitel, gesamtPreis, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords);
                if (result === 'vkErstellt') return 'vkErstellt';
                return 'weiter';
            }
            if (aktion === 'artikel_zu_import') {
                await tblImport.updateRecordAsync(zeile.id, { 'PIMP_Title': artikelTitel });
                const result = await versucheVkErstellung(sku, artikelTitel, gesamtPreis, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords);
                if (result === 'vkErstellt') return 'vkErstellt';
                return 'weiter';
            }
            if (aktion === 'sku') {
                const n = await input.textAsync('Neue SKU:');
                if (n?.trim()) {
                    await tblImport.updateRecordAsync(zeile.id, { 'PIMP_SKU': n.trim() });
                    output.text(`✅ SKU geändert zu "${n.trim()}"`);
                    const result = await versucheVkErstellung(n.trim(), importTitel, gesamtPreis, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords);
                    if (result === 'vkErstellt') return 'vkErstellt';
                }
            }
            return 'weiter';
        }

        {
            const result = await versucheVkErstellung(sku, importTitel, gesamtPreis, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords);
            if (result === 'vkErstellt') return 'vkErstellt';
            if (result === 'stop') return 'stop';
        }
    }

    output.markdown('## ❓ Unklarer Clearing-Grund');
    zeigeZeilenTabelle(zeilen);
    return await standardAktionen(zeilen, tblImport);
}

// ============================================================
// DIREKTE VK-ERSTELLUNG NACH SKU-NACHTRAG
// ============================================================

async function versucheVkErstellung(sku, importTitel, gesamtPreis, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords) {
    const alleMitSku = artikelRecords.records.filter(a =>
        a.getCellValueAsString('ITEM_Artikelnummer') === sku &&
        a.getCellValueAsString('ITEM_Status') === 'auf Lager'
    );

    if (!alleMitSku.length) {
        output.text(`⚠️ Artikel ${sku} nicht auf Lager → bleibt im Clearing`);
        return 'weiter';
    }

    const artikel = alleMitSku[0];
    const artikelTitel = artikel.getCellValueAsString('ITEM_Artikel') || '';
    const matchScore = berechneMatchScore(importTitel, artikelTitel);

    if (matchScore < CONFIG.titelMatchSchwelle) {
        output.text(`⚠️ Titel-Match ${(matchScore*100).toFixed(0)}%: "${importTitel}" vs "${artikelTitel}"`);
        const ok = await input.buttonsAsync('Trotzdem VK erstellen?', [
            { label: '✅ Ja, passt', value: true, variant: 'primary' },
            { label: '❌ Nein', value: false }
        ]);
        if (!ok) return 'weiter';
    }

    const erfassteArtikel = [];
    if (alleMitSku.length > 1) {
        output.text(`📦 ${alleMitSku.length}x ${sku} auf Lager (Konvolut)`);
        const ep = gesamtPreis / alleMitSku.length;
        let summe = 0;
        for (let i = 0; i < alleMitSku.length; i++) {
            if (i === alleMitSku.length - 1) erfassteArtikel.push({ artikelRecord: alleMitSku[i], einzelpreis: gesamtPreis - summe });
            else { const preis = Math.round(ep * 100) / 100; erfassteArtikel.push({ artikelRecord: alleMitSku[i], einzelpreis: preis }); summe += preis; }
        }
    } else {
        erfassteArtikel.push({ artikelRecord: artikel, einzelpreis: gesamtPreis });
    }

    output.markdown('### 📋 VK erstellen?');
    for (const a of erfassteArtikel) {
        output.text(`• ${a.artikelRecord.getCellValueAsString('ITEM_Artikelnummer')} | ${a.artikelRecord.getCellValueAsString('ITEM_Artikel').substring(0,40)} | ${a.einzelpreis.toFixed(2)} €`);
    }

    const ok = await input.buttonsAsync('VK erstellen?', [
        { label: '✅ Erstellen', value: true, variant: 'primary' },
        { label: '⏭️ Später', value: false }
    ]);
    if (!ok) return 'weiter';

    return await erstelleVkAusMehreren(zeilen, erfassteArtikel, gesamtPreis, tblImport, tblArtikel, tblVerkauf, tblPartner, partnerRecords, partnerCache, verkaufRecords);
}

// ============================================================
// NEUEN ARTIKEL ANLEGEN + VK ERSTELLEN
// ============================================================

async function neuerArtikelAnlegen(importTitel, gesamtPreis, zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords) {
    output.markdown('---');
    output.markdown('## ➕ Neuen Artikel anlegen');
    output.text(`Import-Titel: ${importTitel}`);

    const nrStr = await input.textAsync('Artikelnummer:');
    if (!nrStr?.trim()) return 'weiter';
    const nr = nrStr.trim();

    const exists = artikelRecords.records.find(a => a.getCellValueAsString('ITEM_Artikelnummer') === nr);
    if (exists) {
        output.text(`⚠️ Nummer ${nr} existiert bereits: ${exists.getCellValueAsString('ITEM_Artikel')}`);
        const trotzdem = await input.buttonsAsync('Trotzdem anlegen?', [
            { label: '✅ Ja (Duplikat-Nr)', value: true },
            { label: '❌ Abbrechen', value: false }
        ]);
        if (!trotzdem) return 'weiter';
    }

    output.text(`Import-Titel: "${importTitel}"`);
    const titelWahl = await input.buttonsAsync('Artikelname:', [
        { label: `1️⃣ Übernehmen: "${importTitel.substring(0, 40)}${importTitel.length > 40 ? '...' : ''}"`, value: 'uebernehmen', variant: 'primary' },
        { label: '2️⃣ Manuell eingeben', value: 'manuell' }
    ]);
    let name = importTitel;
    if (titelWahl === 'manuell') {
        const nameStr = await input.textAsync('Artikelname:');
        if (nameStr?.trim()) name = nameStr.trim();
    }

    const konsolenOptionen = tblArtikel.getField('ITEM_Konsole').options?.choices?.map(c => c.name) || [];
    let konsole = '';
    if (konsolenOptionen.length > 0) {
        const buttons = konsolenOptionen.slice(0, 10).map(k => ({ label: k, value: k }));
        buttons.push({ label: '✏️ Andere eingeben', value: '__manuell__' });
        const wahl = await input.buttonsAsync('Konsole:', buttons);
        if (wahl === '__manuell__') {
            const manuell = await input.textAsync('Konsole eingeben:');
            if (!manuell?.trim()) { output.text('❌ Konsole ist Pflicht'); return 'weiter'; }
            konsole = manuell.trim();
        } else {
            konsole = wahl;
        }
    } else {
        const manuell = await input.textAsync('Konsole:');
        if (!manuell?.trim()) { output.text('❌ Konsole ist Pflicht'); return 'weiter'; }
        konsole = manuell.trim();
    }

    const komponentenOptionen = tblArtikel.getField('ITEM_Komponente').options?.choices?.map(c => c.name) || [];
    let kompAuswahl = '';
    if (komponentenOptionen.length > 0) {
        const buttons = komponentenOptionen.slice(0, 10).map(k => ({ label: k, value: k }));
        kompAuswahl = await input.buttonsAsync('Komponente:', buttons);
    } else {
        const manuell = await input.textAsync('Komponente:');
        kompAuswahl = manuell?.trim() || 'Spiel';
    }

    const artOptionen = tblArtikel.getField('ITEM_Art').options?.choices?.map(c => c.name) || ['Einzelverkauf', 'Setartikel'];
    const artButtons = artOptionen.slice(0, 6).map(a => ({ label: a, value: a }));
    const artAuswahl = await input.buttonsAsync('Art:', artButtons);

    const zustandWahl = await input.buttonsAsync('Zustand:', [
        { label: '1️⃣ Leer (kein Zustand)', value: 'leer', variant: 'primary' },
        { label: '2️⃣ Eingeben', value: 'eingeben' }
    ]);
    let zustand = null;
    if (zustandWahl === 'eingeben') {
        const zustandStr = await input.textAsync('Zustand eingeben:');
        zustand = zustandStr?.trim() || null;
    }

    const ekStr = await input.textAsync('EK-Preis (€, 0 wenn unbekannt):');
    const ek = parseFloat((ekStr || '0').replace(',', '.'));

    output.markdown('### 📋 Neuer Artikel');
    output.text(`Nr: ${nr} | ${konsole} | ${kompAuswahl} | ${artAuswahl} | ${name}`);
    output.text(`Zustand: ${zustand || '-'} | EK: ${(isNaN(ek) ? 0 : ek).toFixed(2)} € | VK: ${gesamtPreis.toFixed(2)} €`);

    const ok = await input.buttonsAsync('Anlegen + VK erstellen?', [
        { label: '✅ Ja', value: true, variant: 'primary' },
        { label: '❌ Abbrechen', value: false }
    ]);
    if (!ok) return 'weiter';

    const recordData = {
        'ITEM_Artikelnummer': nr,
        'ITEM_Artikel': name,
        'ITEM_Konsole': { name: konsole },
        'ITEM_Komponente': { name: kompAuswahl },
        'ITEM_Art': { name: artAuswahl },
        'ITEM_EK_Preis': isNaN(ek) ? 0 : ek,
        'ITEM_Status': { name: 'auf Lager' }
    };
    if (zustand) recordData['ITEM_Zustand'] = zustand;

    const neuerArtikel = await tblArtikel.createRecordAsync(recordData);

    output.text(`✅ Artikel ${nr} angelegt`);

    const zuAkt = zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung');
    for (const z of zuAkt) await tblImport.updateRecordAsync(z.id, { 'PIMP_SKU': nr });

    const artikelRecord = {
        id: neuerArtikel,
        getCellValueAsString: (field) => {
            if (field === 'ITEM_Artikelnummer') return nr;
            if (field === 'ITEM_Artikel') return name;
            if (field === 'ITEM_Konsole') return konsole.trim();
            if (field === 'ITEM_Status') return 'auf Lager';
            return '';
        }
    };

    const erfassteArtikel = [{ artikelRecord, einzelpreis: gesamtPreis }];
    return await erstelleVkAusMehreren(zeilen, erfassteArtikel, gesamtPreis, tblImport, tblArtikel, tblVerkauf, tblPartner, partnerRecords, partnerCache, verkaufRecords);
}

// ============================================================
// MANUELLE ARTIKELSUCHE
// ============================================================

async function manuelleArtikelSuche(artikelRecords) {
    const suchbegriff = await input.textAsync('Suchbegriff (Name, Konsole, SKU):');
    if (!suchbegriff?.trim()) return null;
    const treffer = sucheArtikel(artikelRecords, suchbegriff.trim());
    if (!treffer.length) { output.text('❌ Keine Artikel gefunden'); return null; }
    const buttons = treffer.slice(0, 10).map(a => ({
        label: `${a.sku} | ${a.konsole} | ${a.name.substring(0, 25)} | ${a.status}`, value: a.sku
    }));
    buttons.push({ label: '❌ Abbrechen', value: '_abbrechen' });
    return await input.buttonsAsync('Artikel wählen:', buttons);
}

// ============================================================
// STANDARD-AKTIONEN
// ============================================================

async function standardAktionen(zeilen, tblImport) {
    const aktion = await input.buttonsAsync('Aktion:', [
        { label: '⏭️ Weiter', value: 'weiter', variant: 'primary' },
        { label: '✅ Erledigt', value: 'erledigt' },
        { label: '🔄 Reset (false)', value: 'reset' },
        { label: '🛑 Abbrechen', value: 'stop', variant: 'danger' }
    ]);
    if (aktion === 'stop') return 'stop';
    if (aktion === 'erledigt') { await setzeProcessed(tblImport, zeilen, 'true'); output.text(`✅ Erledigt`); }
    if (aktion === 'reset') { await setzeProcessed(tblImport, zeilen, 'false'); output.text(`🔄 Zurückgesetzt`); }
    return 'weiter';
}

// ============================================================
// HILFSFUNKTIONEN
// ============================================================

function splitName(fullName) {
    if (!fullName) return { vorname: '', nachname: '' };
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { vorname: '', nachname: parts[0] };
    return { vorname: parts[0], nachname: parts.slice(1).join(' ') };
}

function zeigeZeilenTabelle(zeilen) {
    let t = '| Typ | SKU | Titel | Betrag |\n|-----|-----|-------|--------|\n';
    for (const z of zeilen) {
        const typ = z.getCellValueAsString('PIMP_RowType') || '-';
        const sku = z.getCellValueAsString('PIMP_SKU') || '-';
        const titel = z.getCellValueAsString('PIMP_Title') || '-';
        const betrag = z.getCellValue('PIMP_AmountGross');
        t += `| ${typ} | ${sku} | ${titel.substring(0,30)}${titel.length>30?'...':''} | ${betrag !== null ? betrag.toFixed(2)+' €' : '-'} |\n`;
    }
    output.markdown(t);
}

async function setzeProcessed(table, zeilen, status) {
    for (const z of zeilen) await table.updateRecordAsync(z.id, { 'PIMP_Processed': { name: status } });
}

async function setzeProcessedMitVkLot(table, zeilen, status, vkLot) {
    for (const z of zeilen) await table.updateRecordAsync(z.id, { 'PIMP_Processed': { name: status }, 'PIMP_VK_Lot': vkLot });
}

function sucheArtikel(artikelRecords, suchbegriff) {
    const such = suchbegriff.toLowerCase();
    return artikelRecords.records
        .filter(r => {
            const sku = (r.getCellValueAsString('ITEM_Artikelnummer') || '').toLowerCase();
            const name = (r.getCellValueAsString('ITEM_Artikel') || '').toLowerCase();
            const konsole = (r.getCellValueAsString('ITEM_Konsole') || '').toLowerCase();
            return sku.includes(such) || name.includes(such) || konsole.includes(such);
        })
        .map(r => ({
            sku: r.getCellValueAsString('ITEM_Artikelnummer'),
            name: r.getCellValueAsString('ITEM_Artikel'),
            konsole: r.getCellValueAsString('ITEM_Konsole'),
            status: r.getCellValueAsString('ITEM_Status'),
            id: r.id
        }));
}

function berechneMatchScore(text1, text2) {
    if (!text1 || !text2) return 0;
    const normalize = str => str.toLowerCase().replace(/[^a-z0-9äöüß\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    const w1 = normalize(text1), w2 = normalize(text2);
    if (!w1.length || !w2.length) return 0;
    return Math.max(w1.filter(w => w2.includes(w)).length / w1.length, w2.filter(w => w1.includes(w)).length / w2.length);
}

function findeArtikelVorschlaege(artikelRecords, importTitel, anzahl) {
    const v = [];
    for (const r of artikelRecords.records) {
        if (r.getCellValueAsString('ITEM_Status') !== 'auf Lager') continue;
        const score = berechneMatchScore(importTitel, r.getCellValueAsString('ITEM_Artikel') || '');
        if (score > 0.1) v.push({
            sku: r.getCellValueAsString('ITEM_Artikelnummer'),
            name: r.getCellValueAsString('ITEM_Artikel'),
            konsole: r.getCellValueAsString('ITEM_Konsole'),
            score, id: r.id
        });
    }
    v.sort((a, b) => b.score - a.score);
    return v.slice(0, anzahl);
}

function getStartVkLotNummer(verkaufRecords) {
    const jahr = new Date().getFullYear().toString().slice(-2);
    const prefix = `VK${jahr}/`;
    let max = 0;
    for (const r of verkaufRecords.records) {
        const lot = r.getCellValueAsString('VK_Lot');
        if (lot?.startsWith(prefix)) { const n = parseInt(lot.substring(prefix.length), 10); if (!isNaN(n) && n > max) max = n; }
    }
    return max + 1;
}

// ============================================================
// MEHRERE ARTIKEL ERFASSEN
// ============================================================

async function erfasseMehrereArtikel(zeilen, tblImport, tblArtikel, tblVerkauf, tblPartner, artikelRecords, partnerRecords, partnerCache, verkaufRecords, importTitel, gesamtPreis) {
    const ersteZeile = zeilen.find(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung') || zeilen[0];
    const versandKunde = parseFloat(ersteZeile.getCellValue('PIMP_Shipping') || 0);
    let warenWert = gesamtPreis - versandKunde;

    output.markdown('---');

    if (warenWert <= 0 && versandKunde > 0) {
        const bestellZeilen = zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung');
        for (const z of bestellZeilen) await tblImport.updateRecordAsync(z.id, { 'PIMP_Shipping': 0 });
        warenWert = gesamtPreis;
        output.text(`✅ eBay-Export-Fehler korrigiert: PIMP_Shipping auf 0 gesetzt → VK_Preis: ${gesamtPreis.toFixed(2)} €`);
    }

    if (versandKunde > 0 && warenWert > 0) {
        output.markdown(`## 📦 Mehrere Artikel erfassen (Gesamt: ${gesamtPreis.toFixed(2)} € − Versand ${versandKunde.toFixed(2)} € = ${warenWert.toFixed(2)} €)`);
    } else {
        output.markdown(`## 📦 Mehrere Artikel erfassen (VK_Preis: ${gesamtPreis.toFixed(2)} €)`);
    }

    const modus = await input.buttonsAsync('Erfassungsart:', [
        { label: '1️⃣ Einzeln mit Preis', value: 'einzeln' },
        { label: '2️⃣ Sammel (Preis verteilt)', value: 'sammel' },
        { label: '❌ Abbrechen', value: 'abbrechen', variant: 'danger' }
    ]);
    if (modus === 'abbrechen') return null;

    let erfassteArtikel = modus === 'sammel'
        ? await erfasseSammelArtikel(artikelRecords, warenWert)
        : await erfasseEinzelArtikel(artikelRecords, warenWert);

    if (!erfassteArtikel || !erfassteArtikel.length) return null;

    output.markdown('### 📋 Zusammenfassung');
    let summe = 0;
    for (const a of erfassteArtikel) {
        output.text(`• ${a.artikelRecord.getCellValueAsString('ITEM_Artikelnummer')} | ${a.artikelRecord.getCellValueAsString('ITEM_Artikel').substring(0,40)} | ${a.einzelpreis.toFixed(2)} €`);
        summe += a.einzelpreis;
    }
    output.text(`Summe Artikel: ${summe.toFixed(2)} € (VK_Preis: ${warenWert.toFixed(2)} €)${versandKunde > 0 ? ` | Versand: ${versandKunde.toFixed(2)} €` : ''}`);

    const ok = await input.buttonsAsync('VK erstellen?', [
        { label: '✅ Ja', value: true, variant: 'primary' },
        { label: '❌ Abbrechen', value: false }
    ]);
    if (!ok) return null;

    return await erstelleVkAusMehreren(zeilen, erfassteArtikel, gesamtPreis, tblImport, tblArtikel, tblVerkauf, tblPartner, partnerRecords, partnerCache, verkaufRecords);
}

async function erfasseEinzelArtikel(artikelRecords, gesamtPreis) {
    const erfasst = []; let rest = gesamtPreis;
    while (true) {
        output.markdown(`---\n### Artikel ${erfasst.length + 1} (Rest: ${rest.toFixed(2)} €)`);
        const art = await input.buttonsAsync('Wie?', [
            { label: '🔍 Suchen', value: 'suchen' },
            { label: '✏️ Nummer', value: 'direkt' },
            { label: '✅ Fertig', value: 'fertig' },
            { label: '❌ Abbrechen', value: 'abbrechen', variant: 'danger' }
        ]);
        if (art === 'abbrechen') return null;
        if (art === 'fertig') break;

        let artikelRecord = null;
        if (art === 'suchen') {
            const s = await input.textAsync('Suchbegriff:');
            if (!s?.trim()) continue;
            const treffer = sucheArtikel(artikelRecords, s.trim()).filter(a => a.status === 'auf Lager');
            if (!treffer.length) { output.text('❌ Nichts gefunden'); continue; }
            const buttons = treffer.slice(0, 10).map(a => ({ label: `${a.sku} | ${a.konsole} | ${a.name.substring(0,25)}`, value: a.id }));
            buttons.push({ label: '❌ Zurück', value: '_zurueck' });
            const id = await input.buttonsAsync('Wählen:', buttons);
            if (id === '_zurueck') continue;
            artikelRecord = artikelRecords.records.find(a => a.id === id);
        } else {
            const nr = await input.textAsync('Artikelnummer:');
            if (!nr?.trim()) continue;
            artikelRecord = artikelRecords.records.find(a => a.getCellValueAsString('ITEM_Artikelnummer') === nr.trim());
            if (!artikelRecord) { output.text('❌ Nicht gefunden'); continue; }
        }
        if (!artikelRecord) continue;
        if (erfasst.some(a => a.artikelRecord.id === artikelRecord.id)) { output.text('⚠️ Bereits hinzugefügt'); continue; }

        output.markdown(`**→ ${artikelRecord.getCellValueAsString('ITEM_Artikelnummer')} | ${artikelRecord.getCellValueAsString('ITEM_Konsole') || '-'} | ${artikelRecord.getCellValueAsString('ITEM_Artikel') || '-'}**`);
        const preisStr = await input.textAsync(`Einzelpreis (€):`);
        const preis = parseFloat((preisStr || '').replace(',', '.'));
        if (isNaN(preis)) { output.text('❌ Ungültiger Preis'); continue; }
        erfasst.push({ artikelRecord, einzelpreis: preis });
        rest -= preis;
        output.text(`✅ ${artikelRecord.getCellValueAsString('ITEM_Artikelnummer')} → ${preis.toFixed(2)} € | Rest: ${rest.toFixed(2)} €`);
    }

    if (!erfasst.length) return erfasst;

    while (true) {
        output.markdown('---');
        output.markdown('### 📋 Übersicht – Stimmt alles?');
        let summe = 0;
        let t = '| # | SKU | Artikel | Preis |\n|---|-----|---------|-------|\n';
        for (let i = 0; i < erfasst.length; i++) {
            const a = erfasst[i];
            const sku = a.artikelRecord.getCellValueAsString('ITEM_Artikelnummer');
            const name = a.artikelRecord.getCellValueAsString('ITEM_Artikel') || '-';
            t += `| ${i+1} | ${sku} | ${name.substring(0,35)}${name.length>35?'...':''} | ${a.einzelpreis.toFixed(2)} € |\n`;
            summe += a.einzelpreis;
        }
        output.markdown(t);
        output.text(`Summe: ${summe.toFixed(2)} € | Zu verteilen: ${gesamtPreis.toFixed(2)} € | Differenz: ${(gesamtPreis - summe).toFixed(2)} €`);

        const aktion = await input.buttonsAsync('Alles korrekt?', [
            { label: '✅ Passt, weiter', value: 'ok', variant: 'primary' },
            { label: '✏️ Preis korrigieren', value: 'preis' },
            { label: '🗑️ Artikel entfernen', value: 'entfernen' },
            { label: '➕ Weiteren hinzufügen', value: 'hinzufuegen' },
            { label: '❌ Alles verwerfen', value: 'abbrechen', variant: 'danger' }
        ]);

        if (aktion === 'ok') break;
        if (aktion === 'abbrechen') return null;

        if (aktion === 'preis') {
            const nrStr = await input.textAsync(`Welche Position korrigieren? (1-${erfasst.length}):`);
            const nr = parseInt(nrStr) - 1;
            if (isNaN(nr) || nr < 0 || nr >= erfasst.length) { output.text('❌ Ungültige Position'); continue; }
            const a = erfasst[nr];
            output.text(`Aktuell: ${a.artikelRecord.getCellValueAsString('ITEM_Artikelnummer')} → ${a.einzelpreis.toFixed(2)} €`);
            const neuerPreisStr = await input.textAsync('Neuer Preis (€):');
            const neuerPreis = parseFloat((neuerPreisStr || '').replace(',', '.'));
            if (isNaN(neuerPreis)) { output.text('❌ Ungültiger Preis'); continue; }
            erfasst[nr].einzelpreis = neuerPreis;
            output.text(`✅ Preis geändert auf ${neuerPreis.toFixed(2)} €`);
        }

        if (aktion === 'entfernen') {
            const nrStr = await input.textAsync(`Welche Position entfernen? (1-${erfasst.length}):`);
            const nr = parseInt(nrStr) - 1;
            if (isNaN(nr) || nr < 0 || nr >= erfasst.length) { output.text('❌ Ungültige Position'); continue; }
            const entfernt = erfasst.splice(nr, 1)[0];
            output.text(`🗑️ ${entfernt.artikelRecord.getCellValueAsString('ITEM_Artikelnummer')} entfernt`);
            if (!erfasst.length) { output.text('Keine Artikel mehr übrig'); return null; }
        }

        if (aktion === 'hinzufuegen') {
            const nr = await input.textAsync('Artikelnummer:');
            if (!nr?.trim()) continue;
            const artikelRecord = artikelRecords.records.find(a => a.getCellValueAsString('ITEM_Artikelnummer') === nr.trim() && a.getCellValueAsString('ITEM_Status') === 'auf Lager');
            if (!artikelRecord) { output.text('❌ Nicht gefunden oder nicht auf Lager'); continue; }
            if (erfasst.some(a => a.artikelRecord.id === artikelRecord.id)) { output.text('⚠️ Bereits enthalten'); continue; }
            output.markdown(`**→ ${artikelRecord.getCellValueAsString('ITEM_Artikelnummer')} | ${artikelRecord.getCellValueAsString('ITEM_Konsole') || '-'} | ${artikelRecord.getCellValueAsString('ITEM_Artikel') || '-'}**`);
            const preisStr = await input.textAsync('Einzelpreis (€):');
            const preis = parseFloat((preisStr || '').replace(',', '.'));
            if (isNaN(preis)) { output.text('❌ Ungültiger Preis'); continue; }
            erfasst.push({ artikelRecord, einzelpreis: preis });
            output.text(`✅ Hinzugefügt für ${preis.toFixed(2)} €`);
        }
    }

    return erfasst;
}

async function erfasseSammelArtikel(artikelRecords, gesamtPreis) {
    const eingabe = await input.textAsync('Artikelnummern (kommagetrennt):');
    if (!eingabe?.trim()) return null;
    const nummern = eingabe.split(',').map(n => n.trim()).filter(n => n.length);
    if (!nummern.length) return null;

    const erfasst = []; const fehler = [];
    for (const nr of nummern) {
        const r = artikelRecords.records.find(a => a.getCellValueAsString('ITEM_Artikelnummer') === nr);
        if (!r) { fehler.push(`❌ ${nr}: Nicht gefunden`); continue; }
        if (erfasst.some(a => a.artikelRecord.id === r.id)) { fehler.push(`⚠️ ${nr}: Doppelt`); continue; }
        erfasst.push({ artikelRecord: r });
    }
    if (fehler.length) for (const f of fehler) output.text(f);
    if (!erfasst.length) return null;

    const pp = gesamtPreis / erfasst.length;
    let summe = 0;
    for (let i = 0; i < erfasst.length; i++) {
        if (i === erfasst.length - 1) erfasst[i].einzelpreis = gesamtPreis - summe;
        else { erfasst[i].einzelpreis = Math.round(pp * 100) / 100; summe += erfasst[i].einzelpreis; }
    }
    return erfasst;
}

// ============================================================
// VK ERSTELLEN (MULTI-PLATTFORM) - V2.10.21 mit Partner-Cache
// ============================================================

async function erstelleVkAusMehreren(zeilen, erfassteArtikel, gesamtPreis, tblImport, tblArtikel, tblVerkauf, tblPartner, partnerRecords, partnerCache, verkaufRecords) {
    const ersteZeile = zeilen.find(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung') || zeilen[0];
    const transactionDate = ersteZeile.getCellValueAsString('PIMP_TransactionDate');
	const orderId = ersteZeile.getCellValueAsString('PIMP_OrderId') || '';
    const buyerUser = ersteZeile.getCellValueAsString('PIMP_BuyerUser') || '';
    const buyerName = ersteZeile.getCellValueAsString('PIMP_BuyerName') || '';

    const plattformInfo = getPlattformInfo(zeilen);

    // V2.10.21: Partner-Suche über Cache (cache enthält neu angelegte Partner aus diesem Run)
    let partnerId = null;
    if (buyerUser) {
        const key = buyerUser.trim().toLowerCase();
        partnerId = partnerCache.byKaName.get(key) || null;
        if (!partnerId) {
            const { vorname, nachname } = splitName(buyerName);
            partnerId = await tblPartner.createRecordAsync({
                'PD_KA_Name': buyerUser, 'PD_Vorname': vorname, 'PD_Name': nachname,
                'PD_Typ': { name: 'Privatperson' }, 'PD_Rolle': { name: 'VK-Kunde' }, 'PD_Land': 'DE'
            });
            partnerCache.byKaName.set(key, partnerId);
            const full = [vorname, nachname].filter(Boolean).join(' ').trim().toLowerCase();
            if (full) partnerCache.byFullName.set(full, partnerId);
            output.text(`➕ Neuer Partner: ${buyerUser} (${vorname} ${nachname})`);
        }
    } else if (buyerName) {
        const key = buyerName.trim().toLowerCase();
        partnerId = partnerCache.byFullName.get(key) || null;
        if (!partnerId) {
            const { vorname, nachname } = splitName(buyerName);
            partnerId = await tblPartner.createRecordAsync({
                'PD_KA_Name': '', 'PD_Vorname': vorname, 'PD_Name': nachname,
                'PD_Typ': { name: 'Privatperson' }, 'PD_Rolle': { name: 'VK-Kunde' }, 'PD_Land': 'DE'
            });
            partnerCache.byFullName.set(key, partnerId);
            output.text(`➕ Neuer Partner: ${vorname} ${nachname} (ohne KA-Name)`);
        }
    }

    const versandZeilen = zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Versandetikett');
    let versandkosten = 0;
    for (const vz of versandZeilen) versandkosten += Math.abs(parseFloat(vz.getCellValue('PIMP_AmountGross') || 0));
    let versandBerechnet = parseFloat(ersteZeile.getCellValue('PIMP_Shipping') || 0);

    if (!versandZeilen.length && versandBerechnet > 0) {
        output.markdown('### 📦 Porto');
        output.text(`Dem Kunden berechnet: ${versandBerechnet.toFixed(2)} € (aus PIMP)`);
        const portoStr = await input.textAsync('Tatsächliche Portokosten (€, Enter = 0):');
        if (portoStr?.trim()) {
            const portoParsed = parseFloat(portoStr.replace(',', '.'));
            if (!isNaN(portoParsed)) versandkosten = portoParsed;
        }
        if (versandkosten > 0) output.text(`→ Porto: ${versandkosten.toFixed(2)} €`);
    }

    let plattformKosten = 0;
    for (const bz of zeilen.filter(z => z.getCellValueAsString('PIMP_RowType') === 'Bestellung'))
        plattformKosten += Math.abs(parseFloat(bz.getCellValue('PIMP_FeeSum') || 0));

    const vkRecord = await tblVerkauf.createRecordAsync({
        'VK_OrderId': orderId || undefined,          // ← NEU
        'VK_Datum': transactionDate ? new Date(transactionDate) : new Date(),
        'VK_Plattform': { name: plattformInfo.vkPlattform },
        'VK_Status': { name: 'versendet' },
        'VK_Zahlstatus': { name: 'Zahlung erfolgt' },
        'VK_Zahlweg': { name: plattformInfo.vkZahlweg },
        'VK_PartnerID': partnerId ? [{ id: partnerId }] : undefined,
        'VK_Preis': gesamtPreis,
        'VK_Versandkosten': versandkosten,
        'VK_Versand_Berechnet': versandBerechnet,
        'VK_Plattform_Kosten': plattformKosten
    });

    for (const a of erfassteArtikel) {
        await tblArtikel.updateRecordAsync(a.artikelRecord.id, {
            'ITEM_Status': { name: 'verkauft' },
            'ITEM_VK_Lot': [{ id: vkRecord }],
            'ITEM_VK_Preis': a.einzelpreis
        });
    }

    const neuerRecord = await tblVerkauf.selectRecordAsync(vkRecord, { fields: ['VK_ID', 'VK_Datum'] });
    const vkId = neuerRecord.getCellValue('VK_ID');
    const vkJahr = new Date(transactionDate || Date.now()).getFullYear().toString().slice(-2);
   const vkLot = `VK${vkJahr}/${String(vkId).padStart(3, '0')}`;
    await tblVerkauf.updateRecordAsync(vkRecord, { 'VK_Lot': vkLot });

    await setzeProcessedMitVkLot(tblImport, zeilen, 'true', vkLot);
    if (versandZeilen.length) await setzeProcessedMitVkLot(tblImport, versandZeilen, 'true', vkLot);

    output.markdown(`### ✅ ${vkLot} erstellt [${plattformInfo.plattform}] (${erfassteArtikel.length} Artikel, ${gesamtPreis.toFixed(2)} €)`);
    return 'vkErstellt';
}

// ============================================================
// START
// ============================================================

await main();
