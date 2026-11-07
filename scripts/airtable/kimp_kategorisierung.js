/**
 * KIMP – Kategorisierung & Transfer V2.0 – Replay Dealers
 * Airtable: Erweiterungen → „Scripting“. MEHRFACH ausführbar.
 *
 * V2.0 (Nov 2026)
 *  - eBay_Transaktionen_2025 entfernt (Tabelle existiert nicht mehr).
 *    eBay läuft jetzt über PlattformImport_2026 (PIMP):
 *    PIMP_PayoutNo ↔ KIMP-Verwendungszweck „P.<Nr>“, Verknüpfung KIMP_PIMP ⇄ PIMP_KIMP.
 *  - KIMP_EB_Link → KIMP_PIMP
 *  - PayPal-Auszahlung ↔ KIMP-Matching (früher eigenes Skript V1.5) ist Teil von Schritt 1.
 *  - KIMP-Clearing zeigt passende PayPal-Buchungen an (aus KIMP Clearing V1.7).
 *  - Datumsfelder werden als Datum gelesen (nicht als formatierter Text).
 *
 * ERSETZT (in Airtable löschen):
 *   PP Kategorisierung V2.0, PP Clearing V1.2, KIMP ↔ PayPal Matching V1.5,
 *   KIMP PP Kategorie-Transfer V2.1, KIMP Clearing V1.7,
 *   EB ↔ KIMP Matching V1.0, EB → KIMP Kategorie-Transfer V1.1,
 *   KIMP Kategorisierung und Transfer V1.3
 *
 * Schritte
 *  1 · PayPal: Auszahlungen ↔ KIMP verknüpfen → PP kategorisieren (auto + Klärfälle) → Kategorien auf KIMP
 *  2 · eBay (PIMP): Auszahlung ↔ KIMP verknüpfen → Kategorien aus den PIMP-Zeilen auf KIMP
 *  3 · KIMP-Clearing für Buchungen ohne PayPal-/eBay-Bezug
 */

const T = {
    kimp: 'KontoImport_2026',
    pp:   'PayPal_2025',
    pimp: 'PlattformImport_2026'
};

const KIMP_KATEGORIEN = { "1": "Umsatz", "2": "Wareneinkauf", "3": "Betriebsausgabe", "4": "Kapitalbewegung", "5": "Bargeld" };
const PP_KATEGORIEN   = { ...KIMP_KATEGORIEN, "6": "Auszahlung" };

// PIMP-Zeilentyp → KIMP-Kategorie (Auszahlung selbst wird nicht kategorisiert)
const PIMP_TYP_ZU_KAT = {
    'Bestellung': 'Umsatz', 'Rückerstattung': 'Umsatz', 'Fall': 'Umsatz',
    'Andere Gebühr': 'Betriebsausgabe', 'Versandetikett': 'Betriebsausgabe', 'Belastung': 'Betriebsausgabe'
};

const PP_AUSZAHLUNG_TYP = "Von Nutzer eingeleitete Abbuchung";

// ── Hilfsfunktionen ──────────────────────────────────────────
const s = (r, f) => (r.getCellValueAsString(f) || '').trim();
const datum = (r, f) => { const v = r.getCellValue(f); return v ? new Date(v) : null; };
const tageDiff = (a, b) => (!a || !b) ? 999 : Math.abs((a - b) / 86400000);
const hatLink = (r, f) => { const l = r.getCellValue(f); return !!(l && l.length); };
const istLeerOderKlaer = kat => kat === "" || kat === "Klärfall";
const betragText = b => b >= 0 ? `+€${b.toFixed(2)}` : `-€${Math.abs(b).toFixed(2)}`;
const auszahlungsNr = vwz => { const m = (vwz || '').match(/P\.(\d+)/); return m ? m[1] : null; };

/** Interaktive Kategorie-Abfrage. Rückgabe: Array von Kategorien oder null (überspringen). */
async function frageKategorie(katMap) {
    const auswahl = Object.entries(katMap).map(([k, v]) => `${k}=${v}`).join(" | ");
    while (true) {
        const eingabe = await input.textAsync(`[${auswahl} | 0=Überspringen | mehrere z.B. 1,3]`);
        if (eingabe.trim() === "0") return null;
        const gewaehlt = [...new Set(eingabe.split(",").map(x => katMap[x.trim()]).filter(Boolean))];
        if (gewaehlt.length) return gewaehlt;
        output.text("⚠️ Ungültige Eingabe");
    }
}

/** Geht Klärfälle durch, bietet Sammel-Übernahme für gleichen Namen an. */
async function clearingSchleife(faelle, table, katFeld, katMap, nameFeld, zeige) {
    const erledigt = new Set();
    let n = 0;
    for (const rec of faelle) {
        if (erledigt.has(rec.id)) continue;
        const name = s(rec, nameFeld) || "(kein Name)";
        const aehnliche = faelle.filter(r => r.id !== rec.id && !erledigt.has(r.id) && s(r, nameFeld) === s(rec, nameFeld));

        output.text(`─────────────────────────────────────`);
        zeige(rec, name);
        if (aehnliche.length) output.text(`ℹ️  ${aehnliche.length} weitere mit gleichem Namen`);

        const kat = await frageKategorie(katMap);
        if (!kat) continue;
        await table.updateRecordAsync(rec.id, { [katFeld]: kat.map(k => ({ name: k })) });
        n++;

        if (aehnliche.length) {
            const sammel = await input.textAsync(`Alle ${aehnliche.length} weiteren auch als "${kat.join(", ")}"? (j/n)`);
            if (sammel.trim().toLowerCase() === "j") {
                for (const r of aehnliche) {
                    await table.updateRecordAsync(r.id, { [katFeld]: kat.map(k => ({ name: k })) });
                    erledigt.add(r.id);
                    n++;
                }
            }
        }
    }
    return n;
}

// ── Auswahl ──────────────────────────────────────────────────
output.markdown('# 🏦 KIMP – Kategorisierung & Transfer V2.0');
const wahl = await input.buttonsAsync("Was soll ausgeführt werden?", [
    { label: "🔄 Alles (1→2→3)",           value: "alles", variant: "primary" },
    { label: "1 · PayPal → KIMP",          value: "1" },
    { label: "2 · eBay (PIMP) → KIMP",     value: "2" },
    { label: "3 · Clearing KIMP",          value: "3" },
]);
const schritte = new Set(wahl === "alles" ? [1, 2, 3] : [parseInt(wahl)]);

const kimpTable = base.getTable(T.kimp);
const ppTable   = base.getTable(T.pp);
const pimpTable = base.getTable(T.pimp);

const KIMP_FELDER = ["KIMP_ID", "KIMP_Buchungstag", "KIMP_Name", "KIMP_Verwendungszweck", "KIMP_Buchungstext",
                     "KIMP_Betrag", "KIMP_Kategorie", "KIMP_PP_Link", "KIMP_PIMP"];
const PP_FELDER   = ["PP_ID", "PP_Datum", "PP_Name", "PP_Typ", "PP_Richtung", "PP_Hinweis", "PP_Brutto",
                     "PP_Kategorie", "PP_KontoImport_2026"];

// ════════════════════════════════════════════════════════════
// SCHRITT 1: PAYPAL
// ════════════════════════════════════════════════════════════
if (schritte.has(1)) {
    output.markdown(`## 1 · PayPal`);

    // ── 1a: Auszahlung ↔ KIMP verknüpfen (Betrag exakt, Datum ±3 Tage) ──
    let ppQ   = await ppTable.selectRecordsAsync({ fields: PP_FELDER });
    let kimpQ = await kimpTable.selectRecordsAsync({ fields: KIMP_FELDER });

    const kimpPP = kimpQ.records.filter(r => {
        const betrag = r.getCellValue("KIMP_Betrag") || 0;
        const name = s(r, "KIMP_Name"), vwz = s(r, "KIMP_Verwendungszweck");
        return betrag > 0 && !hatLink(r, "KIMP_PP_Link") &&
            (name.includes("PayPal") || vwz.includes("INSTANT TRANSFER") || vwz.includes("ABBUCHUNG VOM PAYPAL"));
    });
    const offeneAuszahlungen = ppQ.records.filter(r => s(r, "PP_Typ") === PP_AUSZAHLUNG_TYP && !hatLink(r, "PP_KontoImport_2026"));

    let verknuepft = 0, mehrdeutig = 0, ohne = 0;
    const vergeben = new Set();
    for (const pp of offeneAuszahlungen) {
        const ppBetrag = Math.abs(pp.getCellValue("PP_Brutto") || 0);
        const ppDatum = datum(pp, "PP_Datum");
        const treffer = kimpPP.filter(k => !vergeben.has(k.id)
            && Math.abs((k.getCellValue("KIMP_Betrag") || 0) - ppBetrag) < 0.02
            && tageDiff(datum(k, "KIMP_Buchungstag"), ppDatum) <= 3);
        if (treffer.length === 1) {
            await ppTable.updateRecordAsync(pp.id, { "PP_KontoImport_2026": [{ id: treffer[0].id }] });
            vergeben.add(treffer[0].id);
            verknuepft++;
        } else if (treffer.length > 1) {
            mehrdeutig++;
            output.text(`⚠️ ${s(pp, "PP_ID")} | €${ppBetrag.toFixed(2)} → ${treffer.length} mögliche KIMP-Buchungen, bitte manuell verknüpfen`);
        } else {
            ohne++;
        }
    }
    output.text(`🔗 Auszahlungen ↔ KIMP: ${verknuepft} neu verknüpft | ${mehrdeutig} mehrdeutig | ${ohne} ohne Treffer`);

    // ── 1b: PP automatisch kategorisieren ──
    function kategorisierePP(name, typ, richtung, hinweis) {
        if (typ === PP_AUSZAHLUNG_TYP) return ["Auszahlung"];
        if (richtung === "Eingang") {
            if (name.includes("Deutsche Post") || name.includes("DHL") || name.includes("eBay S.a.r.l.")) return ["Betriebsausgabe"];
            return ["Umsatz"];
        }
        if (richtung === "Ausgang") {
            if (name.includes("Deutsche Post") || name.includes("DHL")) return ["Betriebsausgabe"];
            if (hinweis.includes("Deutsche Post") || hinweis.includes("Shop der Deutschen Post")) return ["Betriebsausgabe"];
            if (name.toLowerCase().includes("kleinanzeigen") || hinweis.toLowerCase().includes("kleinanzeigen")) return ["Betriebsausgabe"];
            if (name.includes("eBay S.a.r.l.")) return ["Betriebsausgabe"];
            if (name.includes("Interseroh") || name.includes("Flyeralarm") || name.includes("bueroshop")) return ["Betriebsausgabe"];
            if (name.includes("Karton.eu")) return ["Betriebsausgabe"];
            if (typ === "Rückzahlung") return ["Umsatz"];
            if (name.includes("Back Market") || hinweis.includes("Back Market") || name.toLowerCase().includes("trade4less")) return ["Wareneinkauf"];
            if (name.includes("Stoklasa") || name.includes("GTR Global") || name.includes("Your First Choice")) return ["Wareneinkauf"];
            if (name.includes("Alipay") || name.includes("Bitcases") || name.includes("RetroNintendo")) return ["Wareneinkauf"];
            if (name.includes("FedEx") || name.includes("Federal Express")) return null;
            if (name.includes("Sendico") || hinweis.includes("Sendico")) return ["Wareneinkauf"];
            if (typ === "Allgemeine Abbuchung") return ["Wareneinkauf"];
            const artikel = ["N64", "SNES", "Gameboy", "GBC", "GBP", "GBA", "Switch", "Spiele", "Game Boy", "Ocarina", "Controller"];
            if (artikel.some(a => hinweis.includes(a))) return ["Wareneinkauf"];
        }
        return null;
    }

    ppQ = await ppTable.selectRecordsAsync({ fields: PP_FELDER });
    let ppAuto = 0;
    const ppKlaer = [];
    for (const r of ppQ.records) {
        if (!istLeerOderKlaer(s(r, "PP_Kategorie"))) continue;
        const kat = kategorisierePP(s(r, "PP_Name"), s(r, "PP_Typ"), s(r, "PP_Richtung"), s(r, "PP_Hinweis"));
        if (kat) { await ppTable.updateRecordAsync(r.id, { "PP_Kategorie": kat.map(k => ({ name: k })) }); ppAuto++; }
        else ppKlaer.push(r);
    }
    output.text(`🏷 PP automatisch: ${ppAuto} | Klärfälle: ${ppKlaer.length}`);

    // ── 1c: PP-Klärfälle manuell ──
    if (ppKlaer.length) {
        const n = await clearingSchleife(ppKlaer, ppTable, "PP_Kategorie", PP_KATEGORIEN, "PP_Name", (r, name) => {
            const brutto = r.getCellValue("PP_Brutto") || 0;
            const richt = s(r, "PP_Richtung") === "Eingang" ? "📥 GELDEINGANG" : "📤 GELDAUSGANG";
            output.text(`📌 ${s(r, "PP_ID")} | ${s(r, "PP_Datum")} | ${betragText(brutto)} | ${richt}`);
            output.text(`👤 ${name} | 🏷 ${s(r, "PP_Typ")}`);
            const h = s(r, "PP_Hinweis"); if (h) output.text(`📝 ${h.substring(0, 80)}`);
        });
        output.text(`✅ PP-Clearing: ${n} kategorisiert`);
    }

    // ── 1d: Kategorien auf KIMP übertragen ──
    // Alle PP-Buchungen zwischen zwei Auszahlungen gehören zur späteren Auszahlung.
    ppQ   = await ppTable.selectRecordsAsync({ fields: PP_FELDER });
    kimpQ = await kimpTable.selectRecordsAsync({ fields: KIMP_FELDER });
    const kimpById = new Map(kimpQ.records.map(r => [r.id, r]));
    const AUSGESCHLOSSEN = ["Klärfall", "Auszahlung", "Sonstiges"];

    const auszahlungen = ppQ.records
        .filter(r => s(r, "PP_Typ") === PP_AUSZAHLUNG_TYP && hatLink(r, "PP_KontoImport_2026"))
        .map(r => ({ datum: datum(r, "PP_Datum"), kimpId: r.getCellValue("PP_KontoImport_2026")[0].id }))
        .filter(a => a.datum)
        .sort((a, b) => a.datum - b.datum);

    const eintraege = ppQ.records
        .filter(r => s(r, "PP_Typ") !== PP_AUSZAHLUNG_TYP)
        .map(r => ({ datum: datum(r, "PP_Datum"), kats: (r.getCellValue("PP_Kategorie") || []).map(c => c.name) }))
        .filter(e => e.datum);

    let ppUpdated = 0;
    for (let i = 0; i < auszahlungen.length; i++) {
        const ausz = auszahlungen[i];
        const kimp = kimpById.get(ausz.kimpId);
        if (!kimp) continue;
        const von = i === 0 ? new Date(0) : auszahlungen[i - 1].datum;
        const kats = new Set();
        for (const e of eintraege) {
            if (e.datum > von && e.datum <= ausz.datum)
                for (const k of e.kats) if (!AUSGESCHLOSSEN.includes(k)) kats.add(k);
        }
        if (!kats.size) continue;
        await kimpTable.updateRecordAsync(kimp.id, { "KIMP_Kategorie": [...kats].map(k => ({ name: k })) });
        ppUpdated++;
    }
    output.text(`✅ PayPal → KIMP: ${ppUpdated} KIMP-Buchungen kategorisiert`);
}

// ════════════════════════════════════════════════════════════
// SCHRITT 2: eBay über PIMP
// ════════════════════════════════════════════════════════════
if (schritte.has(2)) {
    output.markdown(`## 2 · eBay (PlattformImport)`);

    const kimpQ = await kimpTable.selectRecordsAsync({ fields: KIMP_FELDER });
    const pimpQ = await pimpTable.selectRecordsAsync({ fields: ["PIMP_RowType", "PIMP_PayoutNo", "PIMP_KIMP"] });

    // PIMP-Zeilen nach Auszahlungs-Nr. gruppieren
    const proNr = new Map();
    for (const p of pimpQ.records) {
        const nr = s(p, "PIMP_PayoutNo");
        if (!nr) continue;
        if (!proNr.has(nr)) proNr.set(nr, []);
        proNr.get(nr).push(p);
    }

    const kimpEbay = kimpQ.records.filter(r => s(r, "KIMP_Name").includes("eBay") && (r.getCellValue("KIMP_Betrag") || 0) > 0);

    let verknuepft = 0, kategorisiert = 0, ohneNr = 0, ohnePimp = 0;
    for (const k of kimpEbay) {
        const nr = auszahlungsNr(s(k, "KIMP_Verwendungszweck"));
        if (!nr) { ohneNr++; continue; }
        const zeilen = proNr.get(nr);
        if (!zeilen) { ohnePimp++; continue; }

        // Verknüpfung KIMP ↔ PIMP-Auszahlungszeile (nur wenn noch keine besteht)
        if (!hatLink(k, "KIMP_PIMP")) {
            const auszZeilen = zeilen.filter(z => s(z, "PIMP_RowType") === "Auszahlung");
            if (auszZeilen.length) {
                await kimpTable.updateRecordAsync(k.id, { "KIMP_PIMP": auszZeilen.map(z => ({ id: z.id })) });
                verknuepft++;
            }
        }

        // Kategorien nur setzen, wenn KIMP noch leer/Klärfall
        if (!istLeerOderKlaer(s(k, "KIMP_Kategorie"))) continue;
        const kats = new Set(zeilen.map(z => PIMP_TYP_ZU_KAT[s(z, "PIMP_RowType")]).filter(Boolean));
        if (!kats.size) continue;
        await kimpTable.updateRecordAsync(k.id, { "KIMP_Kategorie": [...kats].map(x => ({ name: x })) });
        kategorisiert++;
    }
    output.text(`🔗 KIMP ↔ PIMP-Auszahlung: ${verknuepft} neu verknüpft`);
    output.text(`✅ eBay → KIMP: ${kategorisiert} kategorisiert`);
    if (ohneNr) output.text(`ℹ️ ${ohneNr} eBay-Eingänge ohne „P.<Nr>“ im Verwendungszweck`);
    if (ohnePimp) output.text(`ℹ️ ${ohnePimp} eBay-Eingänge, deren Auszahlungs-Nr. (noch) nicht in PIMP steht`);
}

// ════════════════════════════════════════════════════════════
// SCHRITT 3: KIMP-CLEARING (ohne PayPal-/eBay-Bezug)
// ════════════════════════════════════════════════════════════
if (schritte.has(3)) {
    output.markdown(`## 3 · KIMP-Clearing`);

    const kimpQ = await kimpTable.selectRecordsAsync({ fields: KIMP_FELDER });
    const ppQ   = await ppTable.selectRecordsAsync({ fields: PP_FELDER });

    function kategorisiereKIMP(name, zweck, buchung, betrag) {
        if (betrag > 0) {
            if (name.includes("eBay S.a.r.l.")) return "Umsatz";
            if (name.includes("Stripe") || zweck.includes("Shopify")) return "Umsatz";
            if (name.includes("PayPal") && (zweck.includes("ABBUCHUNG VOM PAYPAL-KONTO") || zweck.includes("INSTANT TRANSFER"))) return "Umsatz";
            if (!name.includes("PayPal") && !name.includes("eBay") && !name.includes("Stripe")) return "Umsatz";
        }
        if (betrag < 0) {
            if (zweck.includes("Sendico")) return "Wareneinkauf";
            if (name.includes("Klarna")) return "Wareneinkauf";
            if (name.includes("Deutsche Post") || name.includes("DHL")) return "Betriebsausgabe";
            if (zweck.includes("Deutsche Post") || zweck.includes("Shop der Deutschen Post")) return "Betriebsausgabe";
            if (name.includes("Karton.eu") || name.includes("Versandkarton")) return "Betriebsausgabe";
            if (name.includes("Kleinanzeigen") || zweck.toLowerCase().includes("kleinanzeigen")) return "Betriebsausgabe";
            if (name.includes("Technologiezentrum") || name.includes("W-tec")) return "Betriebsausgabe";
            if (name.includes("andsafe")) return "Betriebsausgabe";
            if (buchung.includes("ENTGELTABSCHLUSS")) return "Betriebsausgabe";
            if (name.includes("HORNBACH") || name.includes("BAUHAUS") || name.includes("IKEA")) return "Betriebsausgabe";
            if (name.includes("Flyeralarm") || name.includes("bueroshop24")) return "Betriebsausgabe";
            if (zweck.includes("Interseroh")) return "Betriebsausgabe";
            if (name.includes("Bastian Karlshaus") || name.includes("Daniel Hecker")) return "Kapitalbewegung";
        }
        if (name === "" && betrag < 0) return "Bargeld";
        if (buchung.includes("BARGELDAUSZAHLUNG") || buchung.includes("GA ")) return "Bargeld";
        return null;
    }

    let auto = 0;
    const klaer = [];
    for (const r of kimpQ.records) {
        if (!istLeerOderKlaer(s(r, "KIMP_Kategorie"))) continue;
        if (hatLink(r, "KIMP_PP_Link") || hatLink(r, "KIMP_PIMP")) continue; // wird über Schritt 1/2 kategorisiert
        const kat = kategorisiereKIMP(s(r, "KIMP_Name"), s(r, "KIMP_Verwendungszweck"), s(r, "KIMP_Buchungstext"), r.getCellValue("KIMP_Betrag") || 0);
        if (kat) { await kimpTable.updateRecordAsync(r.id, { "KIMP_Kategorie": [{ name: kat }] }); auto++; }
        else klaer.push(r);
    }
    output.text(`🏷 KIMP automatisch: ${auto} | Klärfälle: ${klaer.length}`);

    if (klaer.length) {
        const n = await clearingSchleife(klaer, kimpTable, "KIMP_Kategorie", KIMP_KATEGORIEN, "KIMP_Name", (r, name) => {
            const betrag = r.getCellValue("KIMP_Betrag") || 0;
            output.text(`📌 ${s(r, "KIMP_ID")} | ${s(r, "KIMP_Buchungstag")} | ${betragText(betrag)} | ${betrag >= 0 ? "📥 GELDEINGANG" : "📤 GELDAUSGANG"}`);
            output.text(`👤 ${name}`);
            output.text(`📝 ${s(r, "KIMP_Verwendungszweck").substring(0, 100)}`);

            // Passende PayPal-Buchungen anzeigen (Betrag ±0,02 €, Datum ±2 Tage)
            if (name.includes("PayPal")) {
                const kDatum = datum(r, "KIMP_Buchungstag");
                const treffer = ppQ.records.filter(p =>
                    Math.abs(Math.abs(p.getCellValue("PP_Brutto") || 0) - Math.abs(betrag)) <= 0.02 &&
                    tageDiff(datum(p, "PP_Datum"), kDatum) <= 2);
                if (treffer.length) {
                    output.text(`🔍 PayPal-Buchungen:`);
                    for (const p of treffer) {
                        output.text(`   ${s(p, "PP_ID")} | ${s(p, "PP_Richtung") === "Eingang" ? "📥 in PayPal" : "📤 aus PayPal"} | ${s(p, "PP_Name") || "(kein Name)"} | ${s(p, "PP_Typ")} | Kat: ${s(p, "PP_Kategorie") || "-"}`);
                        const h = s(p, "PP_Hinweis"); if (h) output.text(`   📝 ${h.substring(0, 80)}`);
                    }
                } else {
                    output.text(`🔍 Keine passende PayPal-Buchung (±2 Tage)`);
                }
            }
        });
        output.text(`✅ KIMP-Clearing: ${n} kategorisiert`);
    }
}

output.text(`\n─────────────────────────────────────`);
output.text(`✅ Fertig!`);
