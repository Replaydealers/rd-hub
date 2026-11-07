/**
 * REPLAY DEALERS - VERKAUF V10.1
 * Airtable: Erweiterungen → „Scripting“
 *
 * V10.1 (Nov 2026):
 * - VK-Lot wird jetzt wie in PIMP-Automation und Clearing aus VK_ID gebildet
 *   (VK<JJ>/<VK_ID>) statt hochgezählt → eine einzige Nummernlogik für alle Wege
 * - Jahr im Lot kommt aus dem Verkaufsdatum (vorher fest "26")
 *
 * V10.0.1:
 * - Bugfix: PD_Hausnummer existiert nicht → Hausnummer an Straße anhängen
 *
 * V10.0:
 * - Schlanke Version: Nur Verkauf (keine Bestellungen)
 * - Neuer Verkauf (direkt versendet)
 * - Verkauf ändern (mit Fuzzy-Suche)
 */

const TABELLE_VERKAEUFE = "Verkauf_2026";
const TABELLE_ARTIKEL = "Artikel_2026";
const TABELLE_PARTNER = "Partnerdaten_2026";

/** Einheitliche Lot-Nummer aus der VK_ID (autoNumber) – identisch zu Automation und Clearing. */
function berechneVkLot(vkId, dateStr) {
    const jahr = new Date(dateStr || Date.now()).getFullYear().toString().slice(-2);
    return `VK${jahr}/${String(vkId).padStart(3, '0')}`;
}

// ========================================
// HAUPTFUNKTION
// ========================================
async function main() {
    output.clear();
    output.markdown(`# 📤 VERKAUF VERWALTEN`);

    const modus = await input.buttonsAsync(
        "Was möchtest du tun?",
        [
            {label: "➕ Neuer Verkauf", value: "neu", variant: "primary"},
            {label: "✏️ Verkauf ändern", value: "aendern", variant: "secondary"}
        ]
    );

    if (modus === "neu") {
        await neuerVerkauf();
    } else if (modus === "aendern") {
        await verkaufAendern();
    }
}

// ========================================
// NEUER VERKAUF
// ========================================
async function neuerVerkauf() {
    output.clear();

    const tableVerkaeufe = base.getTable(TABELLE_VERKAEUFE);
    const tableArtikel = base.getTable(TABELLE_ARTIKEL);

    output.markdown(`# 📦 NEUER VERKAUF
*VK-Lot wird beim Speichern aus der VK_ID vergeben.*`);

    // Kopfdaten erfassen
    const kopfdaten = await eingabeKopfdaten(tableVerkaeufe);
    if (!kopfdaten) {
        output.text("❌ Abgebrochen");
        return;
    }

    // Kopfdaten-Übersicht mit Korrekturmöglichkeit
    let kopfdatenOk = false;

    while (!kopfdatenOk) {
        const check = await kopfdatenUebersicht(kopfdaten, tableVerkaeufe);
        if (check === "abbrechen") {
            output.text("❌ Abgebrochen");
            return;
        } else if (check === "korrigieren") {
            await kopfdatenKorrigieren(kopfdaten, tableVerkaeufe);
        } else {
            kopfdatenOk = true;
        }
    }

    // Verkauf speichern (vergibt VK_Lot aus VK_ID)
    const vkRecordId = await speichereVerkauf(tableVerkaeufe, kopfdaten);
    if (!vkRecordId) {
        output.text("❌ Fehler beim Speichern");
        return;
    }

    output.markdown(`## ✅ VERKAUF ANGELEGT!
**${kopfdaten.VK_Lot}**

## 📦 ARTIKEL ZUORDNEN`);
    output.text(`Tipp: "0" = Fertig`);

    // Artikel sammeln
    const artikelListe = await artikelSammeln(tableArtikel);

    if (!artikelListe || artikelListe.length === 0) {
        output.text("⚠️ Keine Artikel erfasst");
        const ohneArtikel = await input.buttonsAsync(
            "Verkauf ohne Artikel abschließen?",
            [
                {label: "✅ Ja", value: true},
                {label: "❌ Nein, abbrechen", value: false}
            ]
        );
        if (!ohneArtikel) {
            await tableVerkaeufe.deleteRecordAsync(vkRecordId);
            output.text("❌ Verkauf gelöscht");
            return;
        }
    }

    // Finale Übersicht
    const bestaetigung = await finaleUebersicht(kopfdaten, artikelListe, tableArtikel, tableVerkaeufe);
    if (!bestaetigung) {
        await tableVerkaeufe.deleteRecordAsync(vkRecordId);
        output.text("❌ Verkauf abgebrochen und gelöscht");
        return;
    }

    // Kopfdaten-Korrekturen in DB schreiben (Lot neu berechnen, falls das Datum/Jahr korrigiert wurde)
    kopfdaten.VK_Lot = berechneVkLot(kopfdaten.VK_ID, kopfdaten.VK_Datum);
    const updateData = {
        "VK_Lot": kopfdaten.VK_Lot,
        "VK_Datum": kopfdaten.VK_Datum,
        "VK_Plattform": {name: kopfdaten.VK_Plattform},
        "VK_Status": {name: kopfdaten.VK_Status}
    };
    if (kopfdaten.VK_Zahlstatus) {
        updateData["VK_Zahlstatus"] = {name: kopfdaten.VK_Zahlstatus};
    }
    if (kopfdaten.VK_PartnerID) {
        updateData["VK_PartnerID"] = [{id: kopfdaten.VK_PartnerID}];
    }
    if (kopfdaten.VK_Zahlweg) {
        updateData["VK_Zahlweg"] = {name: kopfdaten.VK_Zahlweg};
    }
    if (kopfdaten.VK_Preis !== null) {
        updateData["VK_Preis"] = kopfdaten.VK_Preis;
    }
    if (kopfdaten.VK_Versandkosten !== null) {
        updateData["VK_Versandkosten"] = kopfdaten.VK_Versandkosten;
    }
    if (kopfdaten.VK_Versand_Berechnet !== null) {
        updateData["VK_Versand_Berechnet"] = kopfdaten.VK_Versand_Berechnet;
    }
    if (kopfdaten.VK_Plattform_Kosten !== null) {
        updateData["VK_Plattform_Kosten"] = kopfdaten.VK_Plattform_Kosten;
    }
    await tableVerkaeufe.updateRecordAsync(vkRecordId, updateData);

    // Artikel speichern
    output.markdown(`## 💾 SPEICHERE ARTIKEL...`);
    for (let artikel of artikelListe) {
        if (!artikel.geloescht) {
            await updateArtikel(tableArtikel, artikel.recordId, vkRecordId, artikel.vkPreis);
            output.text(`  ✅ ${artikel.itemNr} - ${artikel.vkPreis.toFixed(2)} € - verkauft`);
        }
    }

    const artikelGesamt = artikelListe.filter(a => !a.geloescht).reduce((sum, a) => sum + a.vkPreis, 0);

    output.markdown(`## 🎉 VERKAUF ABGESCHLOSSEN!
**VK-Lot:** ${kopfdaten.VK_Lot}
**Artikel:** ${artikelListe.filter(a => !a.geloescht).length}
**Artikelwert:** ${artikelGesamt.toFixed(2)} €
**VK-Preis:** ${kopfdaten.VK_Preis ? kopfdaten.VK_Preis.toFixed(2) + ' €' : '-'}`);
}

// ========================================
// VERKAUF ÄNDERN (FUZZY-SUCHE)
// ========================================
async function verkaufAendern() {
    output.clear();
    const tableVerkaeufe = base.getTable(TABELLE_VERKAEUFE);
    const tableArtikel = base.getTable(TABELLE_ARTIKEL);
    const tablePartner = base.getTable(TABELLE_PARTNER);

    output.markdown(`## ✏️ VERKAUF ÄNDERN`);
    output.text("Suche nach Name, Vorname, Firma, PLZ, Ort oder VK-Lot");

    const suchbegriff = await input.textAsync("Suchbegriff:");
    if (!suchbegriff || suchbegriff.trim() === "") return;

    // Verkäufe laden
    const vkQuery = await tableVerkaeufe.selectRecordsAsync({
        fields: ["VK_Lot", "VK_Status", "VK_Preis", "VK_Versandkosten", "VK_Plattform",
                 "VK_PartnerID", "VK_Name", "VK_Datum", "VK_Versand_Berechnet",
                 "VK_Zahlstatus", "VK_Zahlweg", "VK_Plattform_Kosten"]
    });

    // Partner laden
    const partnerQuery = await tablePartner.selectRecordsAsync({
        fields: ["PD_Name", "PD_Vorname", "PD_Firmenname", "PD_PLZ", "PD_Ort", "PD_KA_Name"]
    });

    const partnerMap = {};
    for (let p of partnerQuery.records) {
        partnerMap[p.id] = {
            name: p.getCellValueAsString("PD_Name") || "",
            vorname: p.getCellValueAsString("PD_Vorname") || "",
            firma: p.getCellValueAsString("PD_Firmenname") || "",
            plz: p.getCellValueAsString("PD_PLZ") || "",
            ort: p.getCellValueAsString("PD_Ort") || ""
        };
    }

    // Fuzzy-Suche
    const suchWorte = suchbegriff.toLowerCase().trim().split(/\s+/).filter(w => w.length >= 2);
    const gefunden = [];

    for (let record of vkQuery.records) {
        const status = record.getCellValue("VK_Status");
        if (!status || status.name === "Bestellung" || status.name === "storniert") continue;

        const vkLot = record.getCellValueAsString("VK_Lot") || "";
        const vkName = record.getCellValueAsString("VK_Name") || "";

        const partnerLinks = record.getCellValue("VK_PartnerID");
        let partnerData = {name: "", vorname: "", firma: "", plz: "", ort: ""};
        if (partnerLinks && partnerLinks.length > 0) {
            partnerData = partnerMap[partnerLinks[0].id] || partnerData;
        }

        const kombiniert = `${vkLot} ${vkName} ${partnerData.name} ${partnerData.vorname} ${partnerData.firma} ${partnerData.plz} ${partnerData.ort}`.toLowerCase();

        let treffer = 0;
        for (const wort of suchWorte) {
            if (kombiniert.includes(wort)) treffer++;
        }
        const matchQuote = suchWorte.length > 0 ? treffer / suchWorte.length : 0;

        if (matchQuote >= 0.70) {
            gefunden.push({
                recordId: record.id,
                vkLot: vkLot,
                vkPreis: record.getCellValue("VK_Preis"),
                status: status.name,
                plattform: record.getCellValue("VK_Plattform")?.name || "",
                datum: record.getCellValue("VK_Datum"),
                kaeuferName: vkName || `${partnerData.vorname} ${partnerData.name}`.trim() || partnerData.firma,
                partnerData: partnerData,
                matchQuote: matchQuote
            });
        }
    }

    gefunden.sort((a, b) => b.matchQuote - a.matchQuote);

    if (gefunden.length === 0) {
        output.text(`❌ Keine Verkäufe gefunden mit: "${suchbegriff}"`);
        return;
    }

    // Artikel laden
    const artikelQuery = await tableArtikel.selectRecordsAsync({
        fields: ["ITEM_Artikelnummer", "ITEM_Artikel", "ITEM_Konsole", "ITEM_VK_Lot", "ITEM_VK_Preis", "ITEM_Status"]
    });

    output.markdown(`### ✅ ${gefunden.length} Verkäufe gefunden:`);

    for (let i = 0; i < gefunden.length; i++) {
        const v = gefunden[i];
        const prozent = Math.round(v.matchQuote * 100);

        const verkaufArtikel = [];
        for (let record of artikelQuery.records) {
            const vkLots = record.getCellValue("ITEM_VK_Lot");
            if (vkLots && vkLots.some(l => l.id === v.recordId)) {
                verkaufArtikel.push({
                    recordId: record.id,
                    itemNr: record.getCellValueAsString("ITEM_Artikelnummer"),
                    name: record.getCellValueAsString("ITEM_Artikel"),
                    konsole: record.getCellValue("ITEM_Konsole")?.name || "?",
                    vkPreis: record.getCellValue("ITEM_VK_Preis")
                });
            }
        }
        v.artikel = verkaufArtikel;

        const adresse = [v.partnerData.plz, v.partnerData.ort].filter(x => x).join(" ");

        output.markdown(`---
**${i+1}. ${v.vkLot}** | ${v.vkPreis ? v.vkPreis.toFixed(2) + " €" : "-"} | ${v.datum ? new Date(v.datum).toLocaleDateString('de-DE') : "-"} (${prozent}%)
**Käufer:** ${v.partnerData.vorname} ${v.partnerData.name} | ${adresse}
**Artikel (${verkaufArtikel.length}):** ${verkaufArtikel.map(a => a.itemNr + ' - ' + a.name).join(', ') || '-'}`);
    }

    output.text("\n0 = Neue Suche");

    const auswahl = await input.textAsync("Nummer auswählen:");
    const nr = parseInt(auswahl);

    if (nr === 0 || isNaN(nr)) {
        return await verkaufAendern();
    }

    if (nr < 1 || nr > gefunden.length) {
        output.text("❌ Ungültige Auswahl");
        return;
    }

    const verkauf = gefunden[nr - 1];
    await verkaufAendernMenue(verkauf, tableVerkaeufe, tableArtikel, artikelQuery);
}

async function verkaufAendernMenue(verkauf, tableVerkaeufe, tableArtikel, artikelQuery) {
    const aenderungen = [];

    // Kopfdaten laden
    const vkRecord = await tableVerkaeufe.selectRecordAsync(verkauf.recordId);
    const kopfdaten = {
        VK_Lot: verkauf.vkLot,
        VK_Datum: vkRecord.getCellValue("VK_Datum"),
        VK_Plattform: vkRecord.getCellValue("VK_Plattform")?.name || "",
        VK_Status: vkRecord.getCellValue("VK_Status")?.name || "",
        VK_Zahlstatus: vkRecord.getCellValue("VK_Zahlstatus")?.name || "",
        VK_Zahlweg: vkRecord.getCellValue("VK_Zahlweg")?.name || "",
        VK_Preis: vkRecord.getCellValue("VK_Preis"),
        VK_Versandkosten: vkRecord.getCellValue("VK_Versandkosten"),
        VK_Versand_Berechnet: vkRecord.getCellValue("VK_Versand_Berechnet"),
        VK_Plattform_Kosten: vkRecord.getCellValue("VK_Plattform_Kosten"),
        VK_Name: verkauf.kaeuferName,
        VK_PartnerID: vkRecord.getCellValue("VK_PartnerID")?.[0]?.id || null
    };

    let weiter = true;

    while (weiter) {
        output.clear();
        output.markdown(`## ✏️ VERKAUF ${verkauf.vkLot} ÄNDERN

### 📋 Kopfdaten
| Nr | Feld | Wert |
|----|------|------|
| 1 | Datum | ${kopfdaten.VK_Datum ? new Date(kopfdaten.VK_Datum).toLocaleDateString('de-DE') : "-"} |
| 2 | Käufer | ${kopfdaten.VK_Name || "-"} |
| 3 | Plattform | ${kopfdaten.VK_Plattform || "-"} |
| 4 | Status | ${kopfdaten.VK_Status || "-"} |
| 5 | Zahlstatus | ${kopfdaten.VK_Zahlstatus || "-"} |
| 6 | Zahlweg | ${kopfdaten.VK_Zahlweg || "-"} |
| 7 | VK-Preis | ${kopfdaten.VK_Preis !== null ? kopfdaten.VK_Preis.toFixed(2) + " €" : "-"} |
| 8 | Versandkosten | ${kopfdaten.VK_Versandkosten !== null ? kopfdaten.VK_Versandkosten.toFixed(2) + " €" : "-"} |
| 9 | Versand berechnet | ${kopfdaten.VK_Versand_Berechnet !== null ? kopfdaten.VK_Versand_Berechnet.toFixed(2) + " €" : "-"} |
| 10 | Plattform-Kosten | ${kopfdaten.VK_Plattform_Kosten !== null ? kopfdaten.VK_Plattform_Kosten.toFixed(2) + " €" : "-"} |
`);

        output.markdown(`### 📦 Artikel (${verkauf.artikel.length})`);
        if (verkauf.artikel.length > 0) {
            let artikelGesamt = 0;
            verkauf.artikel.forEach((a, i) => {
                output.text(`  ${i+1}. ${a.itemNr} | ${a.name} | ${a.konsole} | ${a.vkPreis ? a.vkPreis.toFixed(2) + " €" : "-"}`);
                if (a.vkPreis) artikelGesamt += a.vkPreis;
            });
            output.text(`  **Artikelwert:** ${artikelGesamt.toFixed(2)} €`);
        } else {
            output.text("  (keine Artikel)");
        }

        if (aenderungen.length > 0) {
            output.markdown(`### 📝 Änderungen (${aenderungen.length})`);
            aenderungen.forEach(a => output.text(`  ✓ ${a}`));
        }

        const aktion = await input.buttonsAsync(
            "Was möchtest du tun?",
            [
                {label: "✏️ Kopfdaten ändern", value: "kopfdaten"},
                {label: "🔄 Artikel austauschen", value: "austauschen"},
                {label: "➕ Artikel hinzufügen", value: "hinzufuegen"},
                {label: "➖ Artikel entfernen", value: "entfernen"},
                {label: "💰 Artikel-Preis ändern", value: "preis"},
                {label: "✅ Fertig", value: "fertig", variant: "primary"}
            ]
        );

        if (aktion === "fertig") {
            weiter = false;
        } else if (aktion === "kopfdaten") {
            const aenderung = await kopfdatenAendernVerkauf(kopfdaten, tableVerkaeufe, verkauf.recordId);
            if (aenderung) aenderungen.push(aenderung);
        } else if (aktion === "austauschen") {
            const aenderung = await artikelAustauschen(verkauf, tableArtikel, artikelQuery);
            if (aenderung) aenderungen.push(aenderung);
        } else if (aktion === "hinzufuegen") {
            const aenderung = await artikelHinzufuegenZuVerkauf(verkauf, tableArtikel, artikelQuery);
            if (aenderung) aenderungen.push(aenderung);
        } else if (aktion === "entfernen") {
            const aenderung = await artikelEntfernenAusVerkauf(verkauf, tableArtikel);
            if (aenderung) aenderungen.push(aenderung);
        } else if (aktion === "preis") {
            const aenderung = await vkPreisAendern(verkauf, tableArtikel);
            if (aenderung) aenderungen.push(aenderung);
        }

        // Artikel neu laden
        const neueArtikelQuery = await tableArtikel.selectRecordsAsync({
            fields: ["ITEM_Artikelnummer", "ITEM_Artikel", "ITEM_Konsole", "ITEM_VK_Lot", "ITEM_VK_Preis", "ITEM_Status"]
        });

        const neueArtikel = [];
        for (let record of neueArtikelQuery.records) {
            const vkLots = record.getCellValue("ITEM_VK_Lot");
            if (vkLots && vkLots.some(l => l.id === verkauf.recordId)) {
                neueArtikel.push({
                    recordId: record.id,
                    itemNr: record.getCellValueAsString("ITEM_Artikelnummer"),
                    name: record.getCellValueAsString("ITEM_Artikel"),
                    konsole: record.getCellValue("ITEM_Konsole")?.name || "?",
                    vkPreis: record.getCellValue("ITEM_VK_Preis")
                });
            }
        }
        verkauf.artikel = neueArtikel;
    }

    // Finale Übersicht
    output.clear();
    output.markdown(`## ✅ ÄNDERUNGEN ABGESCHLOSSEN

### ${verkauf.vkLot}
| Feld | Wert |
|------|------|
| Käufer | ${kopfdaten.VK_Name || "-"} |
| Plattform | ${kopfdaten.VK_Plattform} |
| Status | ${kopfdaten.VK_Status} |
| VK-Preis | ${kopfdaten.VK_Preis !== null ? kopfdaten.VK_Preis.toFixed(2) + " €" : "-"} |
`);

    output.markdown(`### 📦 Artikel (${verkauf.artikel.length})`);
    verkauf.artikel.forEach((a, i) => {
        output.text(`  ${i+1}. ${a.itemNr} | ${a.name} | ${a.vkPreis ? a.vkPreis.toFixed(2) + " €" : "-"}`);
    });

    if (aenderungen.length > 0) {
        output.markdown(`### 📝 Durchgeführte Änderungen (${aenderungen.length})`);
        aenderungen.forEach(a => output.text(`  ✓ ${a}`));
    } else {
        output.text("\n(Keine Änderungen durchgeführt)");
    }
}

// ========================================
// KOPFDATEN ÄNDERN (VERKAUF ÄNDERN)
// ========================================
async function kopfdatenAendernVerkauf(kopfdaten, tableVerkaeufe, recordId) {
    output.markdown(`### ✏️ Kopfdaten ändern
1 = Datum | 2 = Käufer | 3 = Plattform | 4 = Status
5 = Zahlstatus | 6 = Zahlweg | 7 = VK-Preis
8 = Versandkosten | 9 = Versand berechnet | 10 = Plattform-Kosten
0 = Zurück`);

    const wahl = await input.textAsync("Nummer:");
    if (!wahl || wahl === "0") return null;

    let aenderung = null;

    if (wahl === "1") {
        output.text("1 = Heute | 2 = Manuell");
        const datumWahl = await input.textAsync("Auswahl:");
        if (datumWahl === "1") {
            const heute = new Date().toISOString().split('T')[0];
            await tableVerkaeufe.updateRecordAsync(recordId, {"VK_Datum": heute});
            kopfdaten.VK_Datum = heute;
            aenderung = `Datum → ${new Date(heute).toLocaleDateString('de-DE')}`;
        } else if (datumWahl === "2") {
            const eingabe = await input.textAsync("Datum (TT.MM.JJJJ):");
            const teile = (eingabe || "").split('.');
            if (teile.length === 3) {
                const iso = `${teile[2]}-${teile[1].padStart(2,'0')}-${teile[0].padStart(2,'0')}`;
                await tableVerkaeufe.updateRecordAsync(recordId, {"VK_Datum": iso});
                kopfdaten.VK_Datum = iso;
                aenderung = `Datum → ${eingabe}`;
            }
        }
    } else if (wahl === "2") {
        const result = await sucheOderErfassePartner();
        if (result) {
            await tableVerkaeufe.updateRecordAsync(recordId, {"VK_PartnerID": [{id: result.recordId}]});
            kopfdaten.VK_PartnerID = result.recordId;
            kopfdaten.VK_Name = result.name;
            aenderung = `Käufer → ${result.name}`;
        }
    } else if (wahl === "3") {
        const optionen = await getSelectOptions(tableVerkaeufe, "VK_Plattform");
        optionen.forEach((p, i) => output.text(`${i+1} = ${p}`));
        const nr = parseInt(await input.textAsync("Nummer:"));
        if (nr >= 1 && nr <= optionen.length) {
            const neueP = optionen[nr - 1];
            await tableVerkaeufe.updateRecordAsync(recordId, {"VK_Plattform": {name: neueP}});
            aenderung = `Plattform: ${kopfdaten.VK_Plattform} → ${neueP}`;
            kopfdaten.VK_Plattform = neueP;
        }
    } else if (wahl === "4") {
        const optionen = await getSelectOptions(tableVerkaeufe, "VK_Status");
        optionen.forEach((s, i) => output.text(`${i+1} = ${s}`));
        const nr = parseInt(await input.textAsync("Nummer:"));
        if (nr >= 1 && nr <= optionen.length) {
            const neuerS = optionen[nr - 1];
            await tableVerkaeufe.updateRecordAsync(recordId, {"VK_Status": {name: neuerS}});
            aenderung = `Status: ${kopfdaten.VK_Status} → ${neuerS}`;
            kopfdaten.VK_Status = neuerS;
        }
    } else if (wahl === "5") {
        const optionen = await getSelectOptions(tableVerkaeufe, "VK_Zahlstatus");
        optionen.forEach((z, i) => output.text(`${i+1} = ${z}`));
        const nr = parseInt(await input.textAsync("Nummer:"));
        if (nr >= 1 && nr <= optionen.length) {
            const neuerZ = optionen[nr - 1];
            await tableVerkaeufe.updateRecordAsync(recordId, {"VK_Zahlstatus": {name: neuerZ}});
            aenderung = `Zahlstatus: ${kopfdaten.VK_Zahlstatus} → ${neuerZ}`;
            kopfdaten.VK_Zahlstatus = neuerZ;
        }
    } else if (wahl === "6") {
        const optionen = await getSelectOptions(tableVerkaeufe, "VK_Zahlweg");
        optionen.forEach((z, i) => output.text(`${i+1} = ${z}`));
        output.text("0 = Entfernen");
        const nr = parseInt(await input.textAsync("Nummer:"));
        if (nr === 0) {
            await tableVerkaeufe.updateRecordAsync(recordId, {"VK_Zahlweg": null});
            aenderung = `Zahlweg entfernt`;
            kopfdaten.VK_Zahlweg = "";
        } else if (nr >= 1 && nr <= optionen.length) {
            const neuerZ = optionen[nr - 1];
            await tableVerkaeufe.updateRecordAsync(recordId, {"VK_Zahlweg": {name: neuerZ}});
            aenderung = `Zahlweg: ${kopfdaten.VK_Zahlweg || "-"} → ${neuerZ}`;
            kopfdaten.VK_Zahlweg = neuerZ;
        }
    } else if (wahl === "7") {
        const neuerPreis = await input.textAsync(`VK-Preis (aktuell: ${kopfdaten.VK_Preis?.toFixed(2) || "-"} €):`);
        if (neuerPreis) {
            const preis = parseFloat(neuerPreis.replace(',', '.'));
            if (!isNaN(preis)) {
                await tableVerkaeufe.updateRecordAsync(recordId, {"VK_Preis": preis});
                aenderung = `VK-Preis: ${kopfdaten.VK_Preis?.toFixed(2) || "-"} → ${preis.toFixed(2)} €`;
                kopfdaten.VK_Preis = preis;
            }
        }
    } else if (wahl === "8") {
        const neueK = await input.textAsync(`Versandkosten (aktuell: ${kopfdaten.VK_Versandkosten?.toFixed(2) || "-"} €):`);
        if (neueK) {
            const kosten = parseFloat(neueK.replace(',', '.'));
            if (!isNaN(kosten)) {
                await tableVerkaeufe.updateRecordAsync(recordId, {"VK_Versandkosten": kosten});
                aenderung = `Versandkosten: ${kopfdaten.VK_Versandkosten?.toFixed(2) || "-"} → ${kosten.toFixed(2)} €`;
                kopfdaten.VK_Versandkosten = kosten;
            }
        }
    } else if (wahl === "9") {
        const neueV = await input.textAsync(`Versand berechnet (aktuell: ${kopfdaten.VK_Versand_Berechnet?.toFixed(2) || "-"} €):`);
        if (neueV) {
            const betrag = parseFloat(neueV.replace(',', '.'));
            if (!isNaN(betrag)) {
                await tableVerkaeufe.updateRecordAsync(recordId, {"VK_Versand_Berechnet": betrag});
                aenderung = `Versand berechnet: ${kopfdaten.VK_Versand_Berechnet?.toFixed(2) || "-"} → ${betrag.toFixed(2)} €`;
                kopfdaten.VK_Versand_Berechnet = betrag;
            }
        }
    } else if (wahl === "10") {
        const neueP = await input.textAsync(`Plattform-Kosten (aktuell: ${kopfdaten.VK_Plattform_Kosten?.toFixed(2) || "-"} €):`);
        if (neueP) {
            const kosten = parseFloat(neueP.replace(',', '.'));
            if (!isNaN(kosten)) {
                await tableVerkaeufe.updateRecordAsync(recordId, {"VK_Plattform_Kosten": kosten});
                aenderung = `Plattform-Kosten: ${kopfdaten.VK_Plattform_Kosten?.toFixed(2) || "-"} → ${kosten.toFixed(2)} €`;
                kopfdaten.VK_Plattform_Kosten = kosten;
            }
        }
    }

    if (aenderung) {
        output.text(`✅ ${aenderung}`);
        await new Promise(r => setTimeout(r, 800));
    }

    return aenderung;
}

// ========================================
// ARTIKEL AUSTAUSCHEN
// ========================================
async function artikelAustauschen(verkauf, tableArtikel, artikelQuery) {
    if (verkauf.artikel.length === 0) {
        output.text("❌ Keine Artikel vorhanden");
        return null;
    }

    output.markdown(`### 🔄 Artikel austauschen`);

    const buttons = verkauf.artikel.map((a, i) => ({
        label: `${a.itemNr} | ${a.name}`,
        value: i
    }));
    buttons.push({label: "❌ Abbrechen", value: -1});

    const falscherIdx = await input.buttonsAsync("Falschen Artikel wählen:", buttons);
    if (falscherIdx === -1) return null;

    const falscherArtikel = verkauf.artikel[falscherIdx];
    const alterVkPreis = falscherArtikel.vkPreis;

    const richtigeNummer = await input.textAsync(`Richtige ITEM-Nummer (statt "${falscherArtikel.itemNr}"):`);
    if (!richtigeNummer || richtigeNummer.trim() === "") return null;

    let richtigerArtikel = null;
    for (let record of artikelQuery.records) {
        if (record.getCellValueAsString("ITEM_Artikelnummer") === richtigeNummer.trim()) {
            richtigerArtikel = {
                recordId: record.id,
                itemNr: record.getCellValueAsString("ITEM_Artikelnummer"),
                name: record.getCellValueAsString("ITEM_Artikel"),
                status: record.getCellValue("ITEM_Status")?.name || ""
            };
            break;
        }
    }

    if (!richtigerArtikel) {
        output.text(`❌ Artikel "${richtigeNummer}" nicht gefunden!`);
        return null;
    }

    if (richtigerArtikel.status !== "auf Lager") {
        const trotzdem = await input.buttonsAsync(
            `⚠️ Status ist "${richtigerArtikel.status}". Trotzdem verwenden?`,
            [{label: "✅ Ja", value: true}, {label: "❌ Nein", value: false}]
        );
        if (!trotzdem) return null;
    }

    // Tauschen
    await tableArtikel.updateRecordAsync(falscherArtikel.recordId, {
        "ITEM_Status": {name: "auf Lager"}, "ITEM_VK_Preis": null, "ITEM_VK_Lot": []
    });
    await tableArtikel.updateRecordAsync(richtigerArtikel.recordId, {
        "ITEM_Status": {name: "verkauft"}, "ITEM_VK_Preis": alterVkPreis, "ITEM_VK_Lot": [{id: verkauf.recordId}]
    });

    output.text(`✅ ${falscherArtikel.itemNr} → auf Lager`);
    output.text(`✅ ${richtigerArtikel.itemNr} → verkauft`);
    await new Promise(r => setTimeout(r, 1000));
    return `Artikel getauscht: ${falscherArtikel.itemNr} → ${richtigerArtikel.itemNr}`;
}

// ========================================
// ARTIKEL HINZUFÜGEN
// ========================================
async function artikelHinzufuegenZuVerkauf(verkauf, tableArtikel, artikelQuery) {
    output.markdown(`### ➕ Artikel hinzufügen`);

    const itemNr = await input.textAsync("ITEM-Nummer:");
    if (!itemNr || itemNr.trim() === "") return null;

    let artikel = null;
    for (let record of artikelQuery.records) {
        if (record.getCellValueAsString("ITEM_Artikelnummer") === itemNr.trim()) {
            artikel = {
                recordId: record.id,
                itemNr: record.getCellValueAsString("ITEM_Artikelnummer"),
                name: record.getCellValueAsString("ITEM_Artikel"),
                status: record.getCellValue("ITEM_Status")?.name || ""
            };
            break;
        }
    }

    if (!artikel) {
        output.text(`❌ Artikel "${itemNr}" nicht gefunden!`);
        return null;
    }

    if (artikel.status !== "auf Lager") {
        const trotzdem = await input.buttonsAsync(
            `⚠️ Status ist "${artikel.status}". Trotzdem hinzufügen?`,
            [{label: "✅ Ja", value: true}, {label: "❌ Nein", value: false}]
        );
        if (!trotzdem) return null;
    }

    const vkPreisStr = await input.textAsync("VK-Preis (€):");
    const vkPreis = vkPreisStr ? parseFloat(vkPreisStr.replace(',', '.')) : null;

    await tableArtikel.updateRecordAsync(artikel.recordId, {
        "ITEM_Status": {name: "verkauft"}, "ITEM_VK_Preis": vkPreis, "ITEM_VK_Lot": [{id: verkauf.recordId}]
    });

    output.text(`✅ ${artikel.itemNr} hinzugefügt`);
    await new Promise(r => setTimeout(r, 800));
    return `Artikel hinzugefügt: ${artikel.itemNr}`;
}

// ========================================
// ARTIKEL ENTFERNEN
// ========================================
async function artikelEntfernenAusVerkauf(verkauf, tableArtikel) {
    if (verkauf.artikel.length === 0) {
        output.text("❌ Keine Artikel vorhanden");
        return null;
    }

    const buttons = verkauf.artikel.map((a, i) => ({label: `${a.itemNr} | ${a.name}`, value: i}));
    buttons.push({label: "❌ Abbrechen", value: -1});

    const idx = await input.buttonsAsync("Welchen Artikel entfernen?", buttons);
    if (idx === -1) return null;

    const artikel = verkauf.artikel[idx];

    const neuerStatus = await input.buttonsAsync(
        `Neuer Status für ${artikel.itemNr}?`,
        [{label: "📦 auf Lager", value: "auf Lager"}, {label: "📝 Abschreibung 2026", value: "Abschreibung 2026"}, {label: "❌ Abbrechen", value: null}]
    );
    if (!neuerStatus) return null;

    await tableArtikel.updateRecordAsync(artikel.recordId, {
        "ITEM_Status": {name: neuerStatus}, "ITEM_VK_Preis": null, "ITEM_VK_Lot": []
    });

    output.text(`✅ ${artikel.itemNr} → ${neuerStatus}`);
    await new Promise(r => setTimeout(r, 800));
    return `Artikel entfernt: ${artikel.itemNr} → ${neuerStatus}`;
}

// ========================================
// VK-PREIS ÄNDERN
// ========================================
async function vkPreisAendern(verkauf, tableArtikel) {
    if (verkauf.artikel.length === 0) {
        output.text("❌ Keine Artikel vorhanden");
        return null;
    }

    const buttons = verkauf.artikel.map((a, i) => ({
        label: `${a.itemNr} | ${a.name} | ${a.vkPreis ? a.vkPreis.toFixed(2) + " €" : "-"}`,
        value: i
    }));
    buttons.push({label: "❌ Abbrechen", value: -1});

    const idx = await input.buttonsAsync("Welchen Artikel?", buttons);
    if (idx === -1) return null;

    const artikel = verkauf.artikel[idx];
    const neuerPreisStr = await input.textAsync(`Neuer VK-Preis (aktuell: ${artikel.vkPreis?.toFixed(2) || "-"} €):`);
    if (!neuerPreisStr) return null;

    const neuerPreis = parseFloat(neuerPreisStr.replace(',', '.'));
    if (isNaN(neuerPreis)) return null;

    const alterPreis = artikel.vkPreis;
    await tableArtikel.updateRecordAsync(artikel.recordId, {"ITEM_VK_Preis": neuerPreis});

    output.text(`✅ ${artikel.itemNr} → ${neuerPreis.toFixed(2)} €`);
    await new Promise(r => setTimeout(r, 800));
    return `Preis: ${artikel.itemNr} ${alterPreis?.toFixed(2) || "-"} → ${neuerPreis.toFixed(2)} €`;
}

// ========================================
// KOPFDATEN EINGABE (NEUER VERKAUF)
// ========================================
async function eingabeKopfdaten(table) {
    const kopfdaten = {
        VK_ID: null,
        VK_Lot: "(wird beim Speichern vergeben)",
        VK_Datum: new Date().toISOString().split('T')[0],
        VK_Plattform: null,
        VK_Status: "versendet",
        VK_Zahlstatus: null,
        VK_Zahlweg: null,
        VK_PartnerID: null,
        VK_Name: null,
        VK_Preis: null,
        VK_Versandkosten: null,
        VK_Versand_Berechnet: null,
        VK_Plattform_Kosten: null
    };

    // 1. Plattform
    const plattformen = await getSelectOptions(table, "VK_Plattform");
    output.markdown(`### Plattform`);
    plattformen.forEach((p, i) => output.text(`${i+1} = ${p}`));
    const plattformNr = parseInt(await input.textAsync("Nummer:"));
    if (plattformNr >= 1 && plattformNr <= plattformen.length) {
        kopfdaten.VK_Plattform = plattformen[plattformNr - 1];
    } else {
        return null;
    }

    // 2. Käufer
    output.markdown(`### Käufer`);
    const partnerResult = await sucheOderErfassePartner();
    if (partnerResult) {
        kopfdaten.VK_PartnerID = partnerResult.recordId;
        kopfdaten.VK_Name = partnerResult.name;
    }

    // 3. Zahlstatus
    const zahlstatus = await getSelectOptions(table, "VK_Zahlstatus");
    output.markdown(`### Zahlstatus`);
    zahlstatus.forEach((z, i) => output.text(`${i+1} = ${z}`));
    const zahlNr = parseInt(await input.textAsync("Nummer:"));
    if (zahlNr >= 1 && zahlNr <= zahlstatus.length) {
        kopfdaten.VK_Zahlstatus = zahlstatus[zahlNr - 1];

        // Zahlweg wenn nicht offen
        if (!kopfdaten.VK_Zahlstatus.toLowerCase().includes("offen")) {
            const zahlwege = await getSelectOptions(table, "VK_Zahlweg");
            output.markdown(`### Zahlweg`);
            zahlwege.forEach((z, i) => output.text(`${i+1} = ${z}`));
            const wegNr = parseInt(await input.textAsync("Nummer:"));
            if (wegNr >= 1 && wegNr <= zahlwege.length) {
                kopfdaten.VK_Zahlweg = zahlwege[wegNr - 1];
            }
        }
    }

    // 4. Preise
    output.markdown(`### Preise`);
    const vkPreis = await input.textAsync("VK-Preis (€):");
    if (vkPreis) kopfdaten.VK_Preis = parseFloat(vkPreis.replace(',', '.'));

    const versand = await input.textAsync("Versandkosten (€):");
    if (versand) kopfdaten.VK_Versandkosten = parseFloat(versand.replace(',', '.'));

    const versandBerechnet = await input.textAsync("Versand berechnet (€):");
    if (versandBerechnet) kopfdaten.VK_Versand_Berechnet = parseFloat(versandBerechnet.replace(',', '.'));

    const plattformKosten = await input.textAsync("Plattform-Kosten (€):");
    if (plattformKosten) kopfdaten.VK_Plattform_Kosten = parseFloat(plattformKosten.replace(',', '.'));

    return kopfdaten;
}

// ========================================
// KOPFDATEN ÜBERSICHT
// ========================================
async function kopfdatenUebersicht(kopfdaten, table) {
    output.clear();
    output.markdown(`## 📋 Kopfdaten-Übersicht

| Feld | Wert |
|------|------|
| VK-Lot | ${kopfdaten.VK_Lot} |
| Datum | ${new Date(kopfdaten.VK_Datum).toLocaleDateString('de-DE')} |
| Käufer | ${kopfdaten.VK_Name || "-"} |
| Plattform | ${kopfdaten.VK_Plattform} |
| Zahlstatus | ${kopfdaten.VK_Zahlstatus || "-"} |
| Zahlweg | ${kopfdaten.VK_Zahlweg || "-"} |
| VK-Preis | ${kopfdaten.VK_Preis ? kopfdaten.VK_Preis.toFixed(2) + ' €' : '-'} |
| Versandkosten | ${kopfdaten.VK_Versandkosten ? kopfdaten.VK_Versandkosten.toFixed(2) + ' €' : '-'} |
| Versand berechnet | ${kopfdaten.VK_Versand_Berechnet ? kopfdaten.VK_Versand_Berechnet.toFixed(2) + ' €' : '-'} |
| Plattform-Kosten | ${kopfdaten.VK_Plattform_Kosten ? kopfdaten.VK_Plattform_Kosten.toFixed(2) + ' €' : '-'} |
`);

    return await input.buttonsAsync("Weiter?", [
        {label: "✅ Weiter zu Artikeln", value: "weiter", variant: "primary"},
        {label: "✏️ Korrigieren", value: "korrigieren"},
        {label: "❌ Abbrechen", value: "abbrechen"}
    ]);
}

// ========================================
// KOPFDATEN KORRIGIEREN (NEUER VERKAUF)
// ========================================
async function kopfdatenKorrigieren(kopfdaten, table) {
    output.markdown(`### Korrigieren
1 = Datum | 2 = Käufer | 3 = Plattform | 4 = Zahlstatus
5 = Zahlweg | 6 = VK-Preis | 7 = Versandkosten
8 = Versand berechnet | 9 = Plattform-Kosten | 0 = Zurück`);

    const wahl = await input.textAsync("Nummer:");
    if (!wahl || wahl === "0") return;

    if (wahl === "1") {
        const eingabe = await input.textAsync("Datum (TT.MM.JJJJ):");
        const teile = (eingabe || "").split('.');
        if (teile.length === 3) {
            kopfdaten.VK_Datum = `${teile[2]}-${teile[1].padStart(2,'0')}-${teile[0].padStart(2,'0')}`;
        }
    } else if (wahl === "2") {
        const result = await sucheOderErfassePartner();
        if (result) {
            kopfdaten.VK_PartnerID = result.recordId;
            kopfdaten.VK_Name = result.name;
        }
    } else if (wahl === "3") {
        const optionen = await getSelectOptions(table, "VK_Plattform");
        optionen.forEach((p, i) => output.text(`${i+1} = ${p}`));
        const nr = parseInt(await input.textAsync("Nummer:"));
        if (nr >= 1 && nr <= optionen.length) kopfdaten.VK_Plattform = optionen[nr - 1];
    } else if (wahl === "4") {
        const optionen = await getSelectOptions(table, "VK_Zahlstatus");
        optionen.forEach((z, i) => output.text(`${i+1} = ${z}`));
        const nr = parseInt(await input.textAsync("Nummer:"));
        if (nr >= 1 && nr <= optionen.length) kopfdaten.VK_Zahlstatus = optionen[nr - 1];
    } else if (wahl === "5") {
        const optionen = await getSelectOptions(table, "VK_Zahlweg");
        optionen.forEach((z, i) => output.text(`${i+1} = ${z}`));
        const nr = parseInt(await input.textAsync("Nummer:"));
        if (nr >= 1 && nr <= optionen.length) kopfdaten.VK_Zahlweg = optionen[nr - 1];
    } else if (wahl === "6") {
        const preis = await input.textAsync("VK-Preis (€):");
        if (preis) kopfdaten.VK_Preis = parseFloat(preis.replace(',', '.'));
    } else if (wahl === "7") {
        const kosten = await input.textAsync("Versandkosten (€):");
        if (kosten) kopfdaten.VK_Versandkosten = parseFloat(kosten.replace(',', '.'));
    } else if (wahl === "8") {
        const betrag = await input.textAsync("Versand berechnet (€):");
        if (betrag) kopfdaten.VK_Versand_Berechnet = parseFloat(betrag.replace(',', '.'));
    } else if (wahl === "9") {
        const kosten = await input.textAsync("Plattform-Kosten (€):");
        if (kosten) kopfdaten.VK_Plattform_Kosten = parseFloat(kosten.replace(',', '.'));
    }
}

// ========================================
// PARTNER SUCHEN/ERFASSEN
// ========================================
async function sucheOderErfassePartner() {
    const tablePartner = base.getTable(TABELLE_PARTNER);

    output.text("Suche oder 'neu' für neuen Partner");
    const suchbegriff = await input.textAsync("Suche:");

    if (!suchbegriff) return null;

    if (suchbegriff.toLowerCase() === "neu") {
        return await erfasseNeuenPartner();
    }

    const query = await tablePartner.selectRecordsAsync({
        fields: ["PD_Name", "PD_Vorname", "PD_Firmenname", "PD_PLZ", "PD_Ort", "PD_KA_Name"]
    });

    const suchWorte = suchbegriff.toLowerCase().trim().split(/\s+/).filter(w => w.length >= 2);
    const gefunden = [];

    for (let record of query.records) {
        const name = record.getCellValueAsString("PD_Name") || "";
        const vorname = record.getCellValueAsString("PD_Vorname") || "";
        const firma = record.getCellValueAsString("PD_Firmenname") || "";
        const plz = record.getCellValueAsString("PD_PLZ") || "";
        const ort = record.getCellValueAsString("PD_Ort") || "";
        const kaName = record.getCellValueAsString("PD_KA_Name") || "";

        const kombiniert = `${name} ${vorname} ${firma} ${plz} ${ort} ${kaName}`.toLowerCase();

        let treffer = 0;
        for (const wort of suchWorte) {
            if (kombiniert.includes(wort)) treffer++;
        }
        const matchQuote = suchWorte.length > 0 ? treffer / suchWorte.length : 0;

        if (matchQuote >= 0.70) {
            gefunden.push({
                recordId: record.id,
                name: `${vorname} ${name}`.trim() || firma,
                anzeige: `${vorname} ${name} ${firma ? '('+firma+')' : ''} | ${plz} ${ort}`.trim(),
                matchQuote: matchQuote
            });
        }
    }

    gefunden.sort((a, b) => b.matchQuote - a.matchQuote);

    if (gefunden.length === 0) {
        output.text("❌ Nicht gefunden");
        const neu = await input.buttonsAsync("Neuen Partner anlegen?", [
            {label: "✅ Ja", value: true},
            {label: "❌ Nein", value: false}
        ]);
        if (neu) return await erfasseNeuenPartner();
        return null;
    }

    const buttons = gefunden.slice(0, 8).map((p) => ({
        label: p.anzeige,
        value: p
    }));
    buttons.push({label: "➕ Neu anlegen", value: "neu"});
    buttons.push({label: "❌ Kein Käufer", value: null});

    const auswahl = await input.buttonsAsync("Partner auswählen:", buttons);

    if (auswahl === "neu") return await erfasseNeuenPartner();
    return auswahl;
}

async function erfasseNeuenPartner() {
    output.markdown(`### Neuer Partner`);

    const name = await input.textAsync("Nachname:");
    const vorname = await input.textAsync("Vorname:");
    const strasse = await input.textAsync("Straße:");
    const hausnummer = await input.textAsync("Hausnummer:");
    const plz = await input.textAsync("PLZ:");
    const ort = await input.textAsync("Ort:");
    const kaName = await input.textAsync("KA-Name (optional):");

    // Straße + Hausnummer kombinieren (PD_Hausnummer existiert nicht)
    const strasseKomplett = hausnummer ? `${strasse} ${hausnummer}`.trim() : strasse;

    const tablePartner = base.getTable(TABELLE_PARTNER);
    const recordId = await tablePartner.createRecordAsync({
        "PD_Name": name || "",
        "PD_Vorname": vorname || "",
        "PD_Strasse": strasseKomplett || "",
        "PD_PLZ": plz || "",
        "PD_Ort": ort || "",
        "PD_KA_Name": kaName || "",
        "PD_Typ": {name: "Privatperson"},
        "PD_Rolle": {name: "VK-Kunde"}
    });

    output.text(`✅ Partner angelegt: ${vorname} ${name}`);
    return {
        recordId: recordId,
        name: `${vorname} ${name}`.trim()
    };
}

// ========================================
// ARTIKEL SAMMELN
// ========================================
async function artikelSammeln(tableArtikel) {
    const artikelListe = [];

    while (true) {
        const itemNr = await input.textAsync("ITEM-Nummer (0 = Fertig):");

        if (!itemNr || itemNr === "0") break;

        if (artikelListe.some(a => !a.geloescht && a.itemNr === itemNr.trim())) {
            output.text(`⚠️ ${itemNr.trim()} ist schon erfasst`);
            continue;
        }

        const artikel = await findeArtikel(tableArtikel, itemNr.trim());
        if (!artikel) {
            output.text(`❌ "${itemNr}" nicht gefunden oder nicht auf Lager`);
            continue;
        }

        output.text(`✅ ${artikel.itemNr} - ${artikel.name} (${artikel.konsole})`);

        const vkPreisStr = await input.textAsync("VK-Preis (€):");
        if (!vkPreisStr) continue;

        const vkPreis = parseFloat(vkPreisStr.replace(',', '.'));
        if (isNaN(vkPreis)) continue;

        artikelListe.push({
            ...artikel,
            vkPreis: vkPreis,
            geloescht: false
        });

        output.text(`✓ ${artikelListe.length} Artikel erfasst`);
    }

    return artikelListe;
}

async function findeArtikel(tableArtikel, itemNr) {
    const query = await tableArtikel.selectRecordsAsync({
        fields: ["ITEM_Artikelnummer", "ITEM_Artikel", "ITEM_Konsole", "ITEM_Status"]
    });

    for (let record of query.records) {
        if (record.getCellValueAsString("ITEM_Artikelnummer") === itemNr) {
            const status = record.getCellValue("ITEM_Status");
            if (status && status.name === "auf Lager") {
                return {
                    recordId: record.id,
                    itemNr: itemNr,
                    name: record.getCellValueAsString("ITEM_Artikel"),
                    konsole: record.getCellValue("ITEM_Konsole")?.name || "?"
                };
            }
        }
    }
    return null;
}

// ========================================
// FINALE ÜBERSICHT
// ========================================
async function finaleUebersicht(kopfdaten, artikelListe, tableArtikel, tableVerkaeufe) {
    while (true) {
        output.clear();
        output.markdown(`## 📋 Zusammenfassung

| Feld | Wert |
|------|------|
| VK-Lot | ${kopfdaten.VK_Lot} |
| Käufer | ${kopfdaten.VK_Name || "-"} |
| Plattform | ${kopfdaten.VK_Plattform} |
| VK-Preis | ${kopfdaten.VK_Preis ? kopfdaten.VK_Preis.toFixed(2) + ' €' : '-'} |
| Versandkosten | ${kopfdaten.VK_Versandkosten ? kopfdaten.VK_Versandkosten.toFixed(2) + ' €' : '-'} |
`);

        output.markdown(`### Artikel (${artikelListe.filter(a => !a.geloescht).length})`);
        let gesamt = 0;
        artikelListe.filter(a => !a.geloescht).forEach((art, i) => {
            output.text(`  ${i+1}. ${art.itemNr} - ${art.name} - ${art.vkPreis.toFixed(2)} €`);
            gesamt += art.vkPreis;
        });
        output.text(`**Artikelwert:** ${gesamt.toFixed(2)} €`);

        const aktion = await input.buttonsAsync("", [
            {label: "✅ Speichern", value: "ok", variant: "primary"},
            {label: "✏️ Kopfdaten", value: "kopfdaten"},
            {label: "📦 Artikel", value: "artikel"},
            {label: "❌ Abbrechen", value: "abbrechen"}
        ]);

        if (aktion === "ok") return true;
        if (aktion === "abbrechen") return false;
        if (aktion === "kopfdaten") await kopfdatenKorrigieren(kopfdaten, tableVerkaeufe);
        if (aktion === "artikel") await artikelListeKorrigieren(artikelListe, tableArtikel);
    }
}

async function artikelListeKorrigieren(artikelListe, tableArtikel) {
    const aktive = artikelListe.filter(a => !a.geloescht);

    const hinzufuegen = async () => {
        const itemNr = await input.textAsync("ITEM-Nummer:");
        if (!itemNr) return;
        const artikel = await findeArtikel(tableArtikel, itemNr.trim());
        if (!artikel) { output.text(`❌ "${itemNr}" nicht gefunden oder nicht auf Lager`); return; }
        const preis = await input.textAsync("VK-Preis:");
        if (preis) artikelListe.push({...artikel, vkPreis: parseFloat(preis.replace(',', '.')), geloescht: false});
    };

    if (aktive.length === 0) {
        await hinzufuegen();
        return;
    }

    const buttons = aktive.map((a) => ({
        label: `${a.itemNr} - ${a.vkPreis.toFixed(2)} €`,
        value: artikelListe.indexOf(a)
    }));
    buttons.push({label: "➕ Hinzufügen", value: "hinzu"});
    buttons.push({label: "⏪ Zurück", value: null});

    const auswahl = await input.buttonsAsync("Artikel?", buttons);
    if (auswahl === null) return;

    if (auswahl === "hinzu") {
        await hinzufuegen();
        return;
    }

    const aktion = await input.buttonsAsync("Was tun?", [
        {label: "💰 Preis ändern", value: "preis"},
        {label: "🗑️ Entfernen", value: "entfernen"},
        {label: "⏪ Zurück", value: null}
    ]);

    if (aktion === "preis") {
        const preis = await input.textAsync("Neuer VK-Preis:");
        if (preis) artikelListe[auswahl].vkPreis = parseFloat(preis.replace(',', '.'));
    } else if (aktion === "entfernen") {
        artikelListe[auswahl].geloescht = true;
    }
}

// ========================================
// HILFSFUNKTIONEN
// ========================================

/** Legt den VK an und vergibt sofort VK_Lot aus VK_ID (wie Automation/Clearing). */
async function speichereVerkauf(table, kopfdaten) {
    const recordId = await table.createRecordAsync({
        "VK_Datum": kopfdaten.VK_Datum,
        "VK_Plattform": {name: kopfdaten.VK_Plattform},
        "VK_Status": {name: kopfdaten.VK_Status}
    });
    const neu = await table.selectRecordAsync(recordId, { fields: ["VK_ID"] });
    kopfdaten.VK_ID = neu.getCellValue("VK_ID");
    kopfdaten.VK_Lot = berechneVkLot(kopfdaten.VK_ID, kopfdaten.VK_Datum);
    await table.updateRecordAsync(recordId, { "VK_Lot": kopfdaten.VK_Lot });
    return recordId;
}

async function updateArtikel(table, recordId, vkRecordId, vkPreis) {
    await table.updateRecordAsync(recordId, {
        "ITEM_Status": {name: "verkauft"},
        "ITEM_VK_Preis": vkPreis,
        "ITEM_VK_Lot": [{id: vkRecordId}]
    });
}

async function getSelectOptions(table, fieldName) {
    const field = table.getField(fieldName);
    if (field.options && field.options.choices) {
        return field.options.choices.map(c => c.name).filter(n => n !== "");
    }
    return [];
}

// ========================================
// START
// ========================================
await main();
