// ============================================
// BA-Erfassung V2.0 - Replay Dealers
// Airtable: Erweiterungen → „Scripting“
// Manuelle Erfassung von Betriebsausgaben mit Partner-Verknüpfung
//
// V2.0 (Nov 2026)
//  - FIX: BA_Kategorie ist ein Auswahlfeld (nicht mehr Verknüpfung zu BA_Kategorien)
//         → Speichern schlug bisher immer fehl
//  - Alle Auswahllisten (Kategorie, USt-Satz, Zahlweg, Zahler, Vorsteuer,
//    Wiederkehrend, Zahlperiode) werden direkt aus den Airtable-Feldern gelesen
//    → neue Optionen in Airtable erscheinen automatisch, keine Tippfehler mehr ("ebay" ≠ "eBay")
//  - BA_Netto und BA_USt_Betrag werden mitgespeichert (vorher nur angezeigt)
//  - BA_Status = "freigegeben" → manuell erfasste BAs tauchen nicht mehr im Invoice Review auf
//  - USt-Satz ohne Prozentzahl (z.B. "Sonstige") → Netto/USt werden nicht berechnet
// ============================================

const CONFIG = {
    tabelle: "Betriebsausgaben_2026",
    partnerTabelle: "Partnerdaten_2026",
    standard: {
        ustSatz: "19%",
        vorsteuer: "ja",
        zahler: "Replaydealers",
        wiederkehrend: "nein"
    },
    statusNachErfassung: "freigegeben"
};

const table = base.getTable(CONFIG.tabelle);

// ============================================
// AUSWAHLLISTEN AUS AIRTABLE LESEN
// ============================================

function feldOptionen(feldName) {
    try {
        const f = table.getField(feldName);
        return (f.options?.choices || []).map(c => c.name).filter(n => n !== "");
    } catch (e) {
        return [];
    }
}

const KATEGORIEN    = feldOptionen("BA_Kategorie");
const UST_SAETZE    = feldOptionen("BA_USt_Satz");
const ZAHLWEGE      = feldOptionen("BA_Zahlweg");
const ZAHLER        = feldOptionen("BA_Zahler");
const VORSTEUER     = feldOptionen("BA_Vorsteuer_absetzbar");
const WIEDERKEHREND = feldOptionen("BA_Wiederkehrend");
const ZAHLPERIODEN  = feldOptionen("BA_Zahlperiode");

const standardWert = (liste, wunsch) => liste.includes(wunsch) ? wunsch : (liste[0] || wunsch);

// ============================================
// HILFSFUNKTIONEN
// ============================================

function parseDatum(eingabe) {
    const parts = (eingabe || "").trim().split(".");
    if (parts.length === 3) {
        const d = parseInt(parts[0]), m = parseInt(parts[1]) - 1, y = parseInt(parts[2]);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y < 100 ? 2000 + y : y, m, d);
    }
    return null;
}

function parseNumber(eingabe) {
    if (!eingabe) return null;
    const n = parseFloat(eingabe.trim().replace("€", "").replace(",", "."));
    return isNaN(n) ? null : n;
}

function formatCurrency(betrag) {
    if (betrag === null || betrag === undefined || isNaN(betrag)) return "-";
    return betrag.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function isoDatum(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function zeigeAuswahlMitNummern(optionen, titel) {
    let text = `${titel}\n`;
    optionen.forEach((opt, idx) => { text += `${idx + 1} = ${opt}\n`; });
    output.text(text);
}

function validiereAuswahl(eingabe, maxIndex) {
    const num = parseInt((eingabe || "").trim());
    if (isNaN(num) || num < 1 || num > maxIndex) return null;
    return num - 1;
}

/** Nummern-Auswahl aus einer Liste, wiederholt bis gültig. */
async function waehleAusListe(liste, titel) {
    zeigeAuswahlMitNummern(liste, titel);
    while (true) {
        const idx = validiereAuswahl(await input.textAsync("Nummer eingeben:"), liste.length);
        if (idx !== null) return liste[idx];
        output.markdown("⚠️ Ungültige Auswahl!");
    }
}

/** 1/2-Abfrage, wiederholt bis gültig. */
async function einsOderZwei(text) {
    output.text(text);
    while (true) {
        const e = (await input.textAsync("Auswahl (1 oder 2):")).trim();
        if (e === "1" || e === "2") return e;
        output.markdown("⚠️ Bitte 1 oder 2 eingeben!");
    }
}

function berechneNettoUst(ausgabe) {
    const prozent = parseFloat(ausgabe.ustSatz);
    if (isNaN(prozent)) { ausgabe.netto = null; ausgabe.ustBetrag = null; return; }
    ausgabe.netto = Math.round(ausgabe.brutto / (1 + prozent / 100) * 100) / 100;
    ausgabe.ustBetrag = Math.round((ausgabe.brutto - ausgabe.netto) * 100) / 100;
}

// ============================================
// PARTNER SUCHEN - MIT BUTTON-AUSWAHL
// ============================================

async function suchePartner() {
    const partnerTable = base.getTable(CONFIG.partnerTabelle);

    output.markdown("### 🔍 Partner suchen");
    output.markdown("Suche nach **PLZ**, **Firmenname**, **Name** oder **KA-Name**");

    while (true) {
        const suchbegriff = await input.textAsync("Suchbegriff eingeben:");
        if (!suchbegriff || suchbegriff.trim() === "") {
            output.markdown("⚠️ Bitte einen Suchbegriff eingeben!");
            continue;
        }
        const such = suchbegriff.trim().toLowerCase();

        const query = await partnerTable.selectRecordsAsync({
            fields: ["PD_ID", "PD_Firmenname", "PD_Name", "PD_Vorname", "PD_KA_Name", "PD_PLZ", "PD_Ort"]
        });

        const treffer = query.records.filter(r =>
            ["PD_Firmenname", "PD_Name", "PD_Vorname", "PD_KA_Name", "PD_PLZ", "PD_Ort"]
                .some(f => (r.getCellValueAsString(f) || "").toLowerCase().includes(such))
        );

        if (treffer.length === 0) {
            output.markdown("❌ Keine Partner gefunden.");
            const e = await einsOderZwei("1 = Neue Suche\n2 = Ohne Partner weiter");
            if (e === "2") return null;
            continue;
        }

        output.markdown(`### ✅ ${treffer.length} Partner gefunden:`);
        const buttons = treffer.slice(0, 20).map(r => {
            const id = r.getCellValueAsString("PD_ID") || "-";
            const firma = r.getCellValueAsString("PD_Firmenname") || "";
            const name = r.getCellValueAsString("PD_Name") || "";
            const vorname = r.getCellValueAsString("PD_Vorname") || "";
            const ort = r.getCellValueAsString("PD_Ort") || "";
            let label = id + " | " + (firma ? firma + (name ? " / " + name : "") : [vorname, name].filter(Boolean).join(" "));
            if (ort) label += " | " + ort;
            return { label, value: r.id };
        });
        buttons.push({ label: "🔍 Neue Suche", value: "neue_suche" });
        buttons.push({ label: "⏭️ Ohne Partner", value: "kein" });

        const auswahl = await input.buttonsAsync("Partner auswählen:", buttons);
        if (auswahl === "neue_suche") continue;
        if (auswahl === "kein") return null;

        const p = treffer.find(r => r.id === auswahl);
        const partnerId = p.getCellValueAsString("PD_ID");
        const lieferantName = p.getCellValueAsString("PD_Firmenname") || p.getCellValueAsString("PD_Name") || "";
        output.markdown(`✓ Partner: **${partnerId} - ${lieferantName}**`);
        return { recordId: p.id, partnerId, lieferantName };
    }
}

// ============================================
// HAUPTFUNKTION
// ============================================

async function main() {
    output.markdown("# 🧾 BA-Erfassung V2.0");
    output.markdown("---");

    if (!KATEGORIEN.length) {
        output.markdown("❌ Feld **BA_Kategorie** hat keine Auswahloptionen – bitte in Airtable prüfen.");
        return;
    }

    let weitereEingabe = true;
    while (weitereEingabe) {
        const ausgabe = await erfasseAusgabe();

        if (ausgabe) {
            await speichereAusgabe(ausgabe);
            output.markdown("---");
            output.markdown("# ✅ EINTRAG ERSTELLT!");
            output.markdown("---");
            output.markdown("# 📸 WICHTIG: BELEG NICHT VERGESSEN!");
            output.markdown("## Öffne den Datensatz und füge den Beleg hinzu:");
            output.markdown("- 📷 **Foto** vom Kassenbon/Rechnung machen");
            output.markdown("- 📄 **PDF** der Rechnung anhängen");
            output.markdown("---");
        }

        weitereEingabe = await input.buttonsAsync("Weitere Ausgabe erfassen?", [
            { label: "➕ Ja, weitere Ausgabe", value: true, variant: "primary" },
            { label: "✓ Nein, fertig", value: false, variant: "default" }
        ]);

        if (weitereEingabe) {
            output.clear();
            output.markdown("# 🧾 BA-Erfassung V2.0");
            output.markdown("---");
        }
    }

    output.markdown("---");
    output.markdown("## 👋 Fertig!");
}

// ============================================
// EINGABE-FUNKTION
// ============================================

async function erfasseAusgabe() {
    const ausgabe = {
        datum: new Date(),
        bezeichnung: "",
        kategorie: "",
        partnerRecordId: null,
        partnerId: "",
        lieferant: "",
        brutto: 0,
        ustSatz: standardWert(UST_SAETZE, CONFIG.standard.ustSatz),
        netto: 0,
        ustBetrag: 0,
        vorsteuer: standardWert(VORSTEUER, CONFIG.standard.vorsteuer),
        zahlweg: "",
        zahler: standardWert(ZAHLER, CONFIG.standard.zahler),
        belegNr: "",
        wiederkehrend: standardWert(WIEDERKEHREND, CONFIG.standard.wiederkehrend),
        zahlperiode: null,
        notizen: ""
    };

    for (let feld = 1; feld <= 13; feld++) {
        if (feld === 12 && ausgabe.wiederkehrend !== "ja") continue;
        await korrigiereFeld(ausgabe, feld, true);
    }

    // ── Zusammenfassung & Korrektur ──
    while (true) {
        output.markdown("---");
        output.markdown("## 📋 Zusammenfassung");
        output.markdown(`
| Nr | Feld | Wert |
|----|------|------|
| 1 | Datum | ${ausgabe.datum.toLocaleDateString("de-DE")} |
| 2 | Bezeichnung | ${ausgabe.bezeichnung} |
| 3 | Kategorie | ${ausgabe.kategorie} |
| 4 | Partner / Lieferant | ${ausgabe.partnerId ? ausgabe.partnerId + " - " + ausgabe.lieferant : "-"} |
| 5 | Brutto | ${formatCurrency(ausgabe.brutto)} |
| 6 | USt-Satz | ${ausgabe.ustSatz} |
| - | Netto (berechnet) | ${formatCurrency(ausgabe.netto)} |
| - | USt-Betrag (berechnet) | ${formatCurrency(ausgabe.ustBetrag)} |
| 7 | Vorsteuer absetzbar | ${ausgabe.vorsteuer} |
| 8 | Zahlweg | ${ausgabe.zahlweg} |
| 9 | Zahler | ${ausgabe.zahler} |
| 10 | Externe Belegnr | ${ausgabe.belegNr || "-"} |
| 11 | Wiederkehrend | ${ausgabe.wiederkehrend} |
| 12 | Zahlperiode | ${ausgabe.zahlperiode || "-"} |
| 13 | Notizen | ${ausgabe.notizen || "-"} |
`);
        output.markdown("---");

        const aktion = await input.buttonsAsync("Was möchtest du tun?", [
            { label: "✅ Speichern", value: "speichern", variant: "primary" },
            { label: "✏️ Korrigieren", value: "korrigieren", variant: "default" },
            { label: "❌ Abbrechen", value: "abbrechen", variant: "danger" }
        ]);

        if (aktion === "abbrechen") { output.markdown("❌ Eingabe abgebrochen."); return null; }
        if (aktion === "speichern") return ausgabe;

        output.markdown("### ✏️ Welches Feld korrigieren?");
        const feldNr = parseInt(await input.textAsync("Nummer eingeben (1-13):"));
        if (feldNr >= 1 && feldNr <= 13) await korrigiereFeld(ausgabe, feldNr, false);
        else output.markdown("⚠️ Ungültige Feldnummer!");
    }
}

// ============================================
// EINZELFELD ERFASSEN / KORRIGIEREN
// ============================================

async function korrigiereFeld(ausgabe, feldNr, ersterfassung) {
    switch (feldNr) {
        case 1: { // Datum
            output.markdown("### 📅 Datum");
            const e = await einsOderZwei("1 = Heute\n2 = Manuell eingeben");
            if (e === "1") ausgabe.datum = new Date();
            else {
                let d = null;
                while (!d) {
                    d = parseDatum(await input.textAsync("Datum eingeben (TT.MM.JJJJ):"));
                    if (!d) output.markdown("⚠️ Ungültiges Datum!");
                }
                ausgabe.datum = d;
            }
            output.markdown(`✓ Datum: ${ausgabe.datum.toLocaleDateString("de-DE")}`);
            break;
        }
        case 2: { // Bezeichnung
            output.markdown("### 📝 Bezeichnung");
            while (true) {
                const b = await input.textAsync("Was wurde gekauft?");
                if (b && b.trim()) { ausgabe.bezeichnung = b.trim(); break; }
                output.markdown("⚠️ Bezeichnung ist erforderlich!");
            }
            break;
        }
        case 3: // Kategorie
            output.markdown("### 📁 Kategorie");
            ausgabe.kategorie = await waehleAusListe(KATEGORIEN, "Kategorien:");
            break;
        case 4: { // Partner
            output.markdown("### 🏪 Partner");
            const e = await einsOderZwei("1 = Partner suchen\n2 = Kein Partner");
            const partner = e === "1" ? await suchePartner() : null;
            ausgabe.partnerRecordId = partner ? partner.recordId : null;
            ausgabe.partnerId = partner ? partner.partnerId : "";
            ausgabe.lieferant = partner ? partner.lieferantName : "";
            if (!partner) output.markdown("*Kein Partner ausgewählt*");
            break;
        }
        case 5: { // Brutto
            output.markdown("### 💰 Brutto-Betrag");
            while (true) {
                const b = parseNumber(await input.textAsync("Brutto-Betrag in € (z.B. 50,00):"));
                if (b !== null && b >= 0) { ausgabe.brutto = b; break; }
                output.markdown("⚠️ Ungültiger Betrag!");
            }
            berechneNettoUst(ausgabe);
            break;
        }
        case 6: // USt-Satz
            output.markdown("### 📊 USt-Satz");
            ausgabe.ustSatz = await waehleAusListe(UST_SAETZE, "USt-Sätze:");
            berechneNettoUst(ausgabe);
            if (ausgabe.netto !== null)
                output.markdown(`*Berechnet: Netto ${formatCurrency(ausgabe.netto)} + USt ${formatCurrency(ausgabe.ustBetrag)} = Brutto ${formatCurrency(ausgabe.brutto)}*`);
            break;
        case 7:
            output.markdown("### ✅ Vorsteuer absetzbar?");
            ausgabe.vorsteuer = await waehleAusListe(VORSTEUER, "Optionen:");
            break;
        case 8:
            output.markdown("### 💳 Zahlweg");
            ausgabe.zahlweg = await waehleAusListe(ZAHLWEGE, "Zahlwege:");
            break;
        case 9:
            output.markdown("### 👤 Zahler");
            ausgabe.zahler = await waehleAusListe(ZAHLER, "Zahler:");
            break;
        case 10: { // Belegnummer
            output.markdown("### 🔢 Externe Belegnummer");
            const e = await einsOderZwei("1 = Eingeben\n2 = Keine Belegnummer");
            ausgabe.belegNr = e === "1" ? ((await input.textAsync("Rechnungsnummer:")) || "").trim() : "";
            break;
        }
        case 11: // Wiederkehrend
            output.markdown("### 🔄 Wiederkehrend?");
            ausgabe.wiederkehrend = await waehleAusListe(WIEDERKEHREND, "Optionen:");
            if (ausgabe.wiederkehrend !== "ja") ausgabe.zahlperiode = null;
            else if (!ersterfassung && !ausgabe.zahlperiode) await korrigiereFeld(ausgabe, 12, false);
            break;
        case 12: // Zahlperiode
            if (ausgabe.wiederkehrend !== "ja") {
                output.markdown("⚠️ Zahlperiode nur bei wiederkehrenden Ausgaben möglich. Ändere zuerst Feld 11.");
                break;
            }
            output.markdown("### 📆 Zahlperiode");
            ausgabe.zahlperiode = await waehleAusListe(ZAHLPERIODEN, "Perioden:");
            break;
        case 13: { // Notizen
            output.markdown("### 📋 Notizen");
            const e = await einsOderZwei("1 = Eingeben\n2 = Keine Notizen");
            ausgabe.notizen = e === "1" ? ((await input.textAsync("Notizen:")) || "").trim() : "";
            break;
        }
    }
}

// ============================================
// SPEICHERN
// ============================================

async function speichereAusgabe(ausgabe) {
    const felder = {
        "BA_Status": { name: CONFIG.statusNachErfassung },
        "BA_Datum": isoDatum(ausgabe.datum),
        "BA_Bezeichnung": ausgabe.bezeichnung,
        "BA_Kategorie": { name: ausgabe.kategorie },
        "BA_Brutto": ausgabe.brutto,
        "BA_USt_Satz": { name: ausgabe.ustSatz },
        "BA_Vorsteuer_absetzbar": { name: ausgabe.vorsteuer },
        "BA_Zahlweg": { name: ausgabe.zahlweg },
        "BA_Zahler": { name: ausgabe.zahler },
        "BA_Wiederkehrend": { name: ausgabe.wiederkehrend }
    };
    if (ausgabe.netto !== null) felder["BA_Netto"] = ausgabe.netto;
    if (ausgabe.ustBetrag !== null) felder["BA_USt_Betrag"] = ausgabe.ustBetrag;
    // BA_Lieferant ist ein Lookup und füllt sich über BA_PartnerID automatisch
    if (ausgabe.partnerRecordId) felder["BA_PartnerID"] = [{ id: ausgabe.partnerRecordId }];
    if (ausgabe.belegNr) felder["BA_Beleg_Nr"] = ausgabe.belegNr;
    if (ausgabe.zahlperiode) felder["BA_Zahlperiode"] = { name: ausgabe.zahlperiode };
    if (ausgabe.notizen) felder["BA_Notizen"] = ausgabe.notizen;

    return await table.createRecordAsync(felder);
}

// ============================================
// START
// ============================================

await main();
