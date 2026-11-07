/**
 * Invoice Review V2.6 - Replay Dealers GbR
 * Airtable: Erweiterungen → „Scripting“
 * Prüft und gibt automatisch importierte Rechnungen (Betriebsausgaben_2026) frei.
 *
 * V2.6 (Nov 2026)
 * - FIX: „Überspringen“ setzte den Status „clearing“, den es in BA_Status nicht gibt → Fehler.
 *        Jetzt: Status „in Bearbeitung“ (zurückgestellt, erscheint unten in der Übersicht mit ⏸️).
 * - FIX: „Abbrechen“/„Überspringen“ führen jetzt wirklich zurück zur Übersicht
 *        (vorher wurde dieselbe Rechnung erneut angezeigt).
 * - FIX: Kategorien, Zahlwege, USt-Sätze usw. werden aus den Airtable-Feldern gelesen.
 *        Vorher fest eingetragen und teils falsch (Verpackungsmaterial, Büromaterial,
 *        SEPA Lastschrift, PayPal, Kreditkarte, Shopify gibt es nicht; Zoll fehlte).
 * - FIX: Neuer Partner: PD_Typ / PD_Rolle als Auswahlwert ({name: …}) geschrieben.
 * - FIX: IBAN-Ergänzung bei bestehendem Partner: PD_IBAN wird jetzt mitgeladen.
 * - USt-Satz ohne Prozentzahl (z.B. „Sonstige“) → Netto/USt bleiben unverändert.
 *
 * V2.5
 * - Partner-Suche mit 50% Fuzzy-Match → alle potenziellen Partner als Buttons
 * - Nach Freigabe zurück zur Übersicht (Schleife)
 */

// ============================================================
// KONFIGURATION
// ============================================================

const TABLES = {
    ba:      'Betriebsausgaben_2026',
    partner: 'Partnerdaten_2026',
};

const STATUS = {
    offen:         'offen',
    zurueckgestellt: 'in Bearbeitung',
    freigegeben:   'freigegeben',
};

const tblBA      = base.getTable(TABLES.ba);
const tblPartner = base.getTable(TABLES.partner);

function feldOptionen(table, feldName) {
    try {
        return (table.getField(feldName).options?.choices || []).map(c => c.name).filter(n => n !== '');
    } catch (e) {
        return [];
    }
}

const KATEGORIEN    = feldOptionen(tblBA, 'BA_Kategorie');
const UST_SAETZE    = feldOptionen(tblBA, 'BA_USt_Satz');
const ZAHLWEGE      = feldOptionen(tblBA, 'BA_Zahlweg');
const VORSTEUER     = feldOptionen(tblBA, 'BA_Vorsteuer_absetzbar');
const WIEDERKEHREND = feldOptionen(tblBA, 'BA_Wiederkehrend');
const ZAHLPERIODEN  = feldOptionen(tblBA, 'BA_Zahlperiode');

const standardWert = (liste, wunsch) => liste.includes(wunsch) ? wunsch : (liste[0] || wunsch);

// ============================================================
// HILFSFUNKTIONEN
// ============================================================

function zeigeAuswahlMitNummern(optionen, titel) {
    output.text(titel + '\n' + optionen.map((o, i) => `${i + 1} = ${o}`).join('\n'));
}

function validiereAuswahl(eingabe, maxIndex) {
    const num = parseInt((eingabe || '').trim());
    if (isNaN(num) || num < 1 || num > maxIndex) return null;
    return num - 1;
}

async function waehle(liste, titel) {
    zeigeAuswahlMitNummern(liste, titel);
    const idx = validiereAuswahl(await input.textAsync('→ Zahl:'), liste.length);
    if (idx === null) { output.text('⚠️ Ungültige Auswahl – unverändert'); return null; }
    return liste[idx];
}

function parseZahl(str) {
    if (str === null || str === undefined) return null;
    const num = parseFloat(str.toString().replace(',', '.').replace('€', '').trim());
    return isNaN(num) ? null : num;
}

function berechneNettoUst(daten) {
    const prozent = parseFloat(daten.ustSatz);
    if (isNaN(prozent) || daten.brutto === null) return;
    daten.netto     = Math.round(daten.brutto / (1 + prozent / 100) * 100) / 100;
    daten.ustBetrag = Math.round((daten.brutto - daten.netto) * 100) / 100;
}

function lieferantAnzeige(record) {
    const l = record.getCellValueAsString('BA_Lieferant');
    if (l) return l;
    const p = record.getCellValue('BA_PartnerID');
    if (p && p.length > 0) return p[0].name;
    return record.getCellValueAsString('BA_Bezeichnung') || '?';
}

function formatZahl(val) {
    if (val === null || val === undefined) return '–';
    return parseFloat(val).toFixed(2).replace('.', ',') + ' €';
}

// ============================================================
// FUZZY MATCH
// ============================================================

function normalisiere(str) {
    return (str || '').toLowerCase()
        .replace(/["\s]+$/g, '')
        .replace(/gmbh\s*[&+]\s*co\.?\s*kg/g, 'gmbh co kg')
        .replace(/\baktiengesellschaft\b/g, 'ag')
        .replace(/\binternational\b/g, '')
        .replace(/[^a-z0-9äöü]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function aehnlichkeit(a, b) {
    const na = normalisiere(a), nb = normalisiere(b);
    if (na && na === nb) return 1.0;
    const ta = new Set(na.split(' ').filter(t => t.length > 2));
    const tb = new Set(nb.split(' ').filter(t => t.length > 2));
    if (!ta.size || !tb.size) return 0;
    let gemeinsam = 0;
    for (const t of ta) if (tb.has(t)) gemeinsam++;
    return (2 * gemeinsam) / (ta.size + tb.size);
}

// ============================================================
// PARTNER SUCHEN & ANLEGEN
// ============================================================

async function suchePartner(suchname) {
    const pQuery = await tblPartner.selectRecordsAsync({
        fields: ['PD_ID', 'PD_Firmenname', 'PD_Name', 'PD_PLZ', 'PD_Ort', 'PD_IBAN']
    });

    while (true) {
        const treffer = pQuery.records
            .map(r => ({ record: r, sim: aehnlichkeit(r.getCellValueAsString('PD_Firmenname') || r.getCellValueAsString('PD_Name') || '', suchname) }))
            .filter(x => x.sim >= 0.5)
            .sort((a, b) => b.sim - a.sim)
            .slice(0, 8);

        output.text(`\nPartner suchen für: "${suchname}"`);

        const buttons = treffer.map(({ record: r, sim }) => {
            const id   = r.getCellValueAsString('PD_ID') || '?';
            const name = r.getCellValueAsString('PD_Firmenname') || r.getCellValueAsString('PD_Name') || '?';
            const ort  = r.getCellValueAsString('PD_Ort') || '';
            const iban = r.getCellValueAsString('PD_IBAN') || '';
            return {
                label: `${id} | ${name}${ort ? ' | ' + ort : ''}${iban ? ' | ' + iban.substring(0, 12) + '...' : ''} (${Math.round(sim * 100)}%)`,
                value: r.id
            };
        });
        buttons.push({ label: '🔍 Andere Suche', value: '__suche__' });
        buttons.push({ label: '➕ Neu anlegen',  value: '__neu__' });
        buttons.push({ label: '⬅️ Ohne Partner', value: '__kein__' });

        const wahl = await input.buttonsAsync(
            treffer.length > 0 ? `${treffer.length} mögliche Partner gefunden:` : 'Kein Partner gefunden:',
            buttons
        );

        if (wahl === '__kein__') return null;
        if (wahl === '__suche__') {
            const neu = await input.textAsync('Neuer Suchbegriff:');
            suchname = (neu || '').trim() || suchname;
            continue;
        }
        if (wahl === '__neu__') return await legePartnerAn(suchname);

        const gewaehlt = pQuery.records.find(r => r.id === wahl);
        const name = gewaehlt.getCellValueAsString('PD_Firmenname') || gewaehlt.getCellValueAsString('PD_Name') || '';
        output.text(`✓ Partner: ${gewaehlt.getCellValueAsString('PD_ID')} – ${name}`);
        return { recordId: gewaehlt.id, lieferantName: name, iban: gewaehlt.getCellValueAsString('PD_IBAN') || '', neu: false };
    }
}

async function legePartnerAn(vorschlag) {
    output.text('\n➕ Neuen Partner anlegen\n─────────────────────────');
    output.text(`Name: ${vorschlag}`);
    const name = ((await input.textAsync('→ Enter = übernehmen, sonst neuen Namen eingeben:')) || '').trim() || vorschlag;
    const iban = ((await input.textAsync('IBAN (optional, leer lassen wenn unbekannt):')) || '').trim().replace(/\s/g, '');
    const landEingabe = ((await input.textAsync('Land (Enter = DE, sonst Ländercode):')) || '').trim();
    const land = !landEingabe || landEingabe === '1' ? 'DE' : landEingabe.toUpperCase();

    const felder = {
        'PD_Firmenname': name,
        'PD_Typ':        { name: 'Unternehmen' },
        'PD_Rolle':      { name: 'BA-Lieferant' },
        'PD_Land':       land,
    };
    if (iban) felder['PD_IBAN'] = iban;

    const newId = await tblPartner.createRecordAsync(felder);
    output.text(`✅ Neuer Partner angelegt: ${name}`);
    return { recordId: newId, lieferantName: name, iban, neu: true };
}

// ============================================================
// EINZELFELD KORRIGIEREN
// ============================================================

async function korrigiereFeld(daten, feldNr) {
    switch (feldNr) {
        case 1: { // Partner
            output.text('1 = Partner suchen  |  2 = Kein Partner');
            const pw = ((await input.textAsync('→')) || '').trim();
            if (pw === '1') {
                const p = await suchePartner(daten.lieferant || '');
                if (p) {
                    daten.lieferant = p.lieferantName;
                    daten.partnerRecordId = p.recordId;
                    daten.partnerNeu = p.neu;
                    if (p.iban) daten.iban = p.iban;
                }
            } else if (pw === '2') {
                daten.partnerRecordId = null;
                daten.lieferant = '';
            }
            break;
        }
        case 2: { // Datum
            const d = ((await input.textAsync('Datum (TT.MM.JJJJ oder JJJJ-MM-TT):')) || '').trim();
            if (d.includes('.')) {
                const p = d.split('.');
                if (p.length === 3) daten.datum = `${p[2].length === 2 ? '20' + p[2] : p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
                daten.datum = d;
            } else {
                output.text('⚠️ Ungültiges Datum');
            }
            break;
        }
        case 3: daten.bezeichnung = (await input.textAsync('Bezeichnung:')) || daten.bezeichnung; break;
        case 4: daten.belegNr = (await input.textAsync('Rechnungsnummer:')) || ''; break;
        case 5: {
            const b = parseZahl(await input.textAsync('Brutto €:'));
            if (b !== null) { daten.brutto = b; berechneNettoUst(daten); } else output.text('⚠️ Ungültiger Betrag');
            break;
        }
        case 6: {
            const n = parseZahl(await input.textAsync('Netto €:'));
            if (n !== null) { daten.netto = n; if (daten.brutto !== null) daten.ustBetrag = Math.round((daten.brutto - n) * 100) / 100; }
            break;
        }
        case 7: {
            const u = parseZahl(await input.textAsync('USt-Betrag €:'));
            if (u !== null) daten.ustBetrag = u;
            break;
        }
        case 8: { const v = await waehle(UST_SAETZE, 'USt-Satz:'); if (v) { daten.ustSatz = v; berechneNettoUst(daten); } break; }
        case 9: { const v = await waehle(KATEGORIEN, 'Kategorie:'); if (v) daten.kategorie = v; break; }
        case 10: { const v = await waehle(ZAHLWEGE, 'Zahlweg:'); if (v) daten.zahlweg = v; break; }
        case 11: { const v = await waehle(VORSTEUER, 'Vorsteuer absetzbar?:'); if (v) daten.vorsteuer = v; break; }
        case 12: {
            const v = await waehle(WIEDERKEHREND, 'Wiederkehrend?:');
            if (v) {
                daten.wiederkehrend = v;
                if (v === 'ja') { const p = await waehle(ZAHLPERIODEN, 'Zahlperiode:'); if (p) daten.zahlperiode = p; }
                else daten.zahlperiode = standardWert(ZAHLPERIODEN, 'einmalig');
            }
            break;
        }
        case 13: daten.notizen = (await input.textAsync('Notizen (leer = keine):')) || ''; break;
        case 14: daten.iban = ((await input.textAsync('IBAN Lieferant (z.B. DE12 3456...):')) || '').trim().replace(/\s/g, ''); break;
        default: output.text('⚠️ Ungültige Feldnummer');
    }
}

// ============================================================
// ZUSAMMENFASSUNG
// ============================================================

function zeigZusammenfassung(daten) {
    output.markdown(`
| Nr | Feld | Wert |
|----|------|------|
| 1 | Lieferant | ${daten.lieferant || '–'} |
| 2 | Datum | ${daten.datum || '–'} |
| 3 | Bezeichnung | ${daten.bezeichnung || '–'} |
| 4 | Rechnungsnummer | ${daten.belegNr || '–'} |
| 5 | Brutto € | ${formatZahl(daten.brutto)} |
| 6 | Netto € | ${formatZahl(daten.netto)} |
| 7 | USt-Betrag € | ${formatZahl(daten.ustBetrag)} |
| 8 | USt-Satz | ${daten.ustSatz || '–'} |
| 9 | Kategorie | ${daten.kategorie || '⚠️ fehlt'} |
| 10 | Zahlweg | ${daten.zahlweg || '–'} |
| 11 | Vorsteuer absetzbar | ${daten.vorsteuer || '–'} |
| 12 | Wiederkehrend | ${daten.wiederkehrend || '–'} ${daten.wiederkehrend === 'ja' && daten.zahlperiode ? '(' + daten.zahlperiode + ')' : ''} |
| 13 | Notizen | ${daten.notizen || '–'} |
| 14 | IBAN Lieferant | ${daten.iban || '–'} |
    `);
}

// ============================================================
// EINE RECHNUNG BEARBEITEN
// Rückgabe: 'freigegeben' | 'zurueckgestellt' | 'abgebrochen'
// ============================================================

async function bearbeiteRechnung(recordId) {
    const record = await tblBA.selectRecordAsync(recordId);
    if (!record) { output.text('⚠️ Datensatz nicht mehr vorhanden'); return 'abgebrochen'; }

    const partnerField = record.getCellValue('BA_PartnerID');
    const datumRaw = record.getCellValue('BA_Datum');
    const belegAtt = record.getCellValue('BA_Beleg');
    const belegUrl = belegAtt && belegAtt.length > 0 ? belegAtt[0].url : null;
    const zahl = f => { const v = record.getCellValue(f); return v === null ? null : Math.round(parseZahl(v) * 100) / 100; };
    const auswahlOder = (f, liste, standard) => { const v = record.getCellValueAsString(f); return liste.includes(v) ? v : standardWert(liste, standard); };

    const daten = {
        lieferant:       record.getCellValueAsString('BA_Lieferant') || (partnerField && partnerField.length ? partnerField[0].name : ''),
        partnerRecordId: partnerField && partnerField.length ? partnerField[0].id : null,
        partnerNeu:      false,
        datum:           datumRaw ? String(datumRaw).substring(0, 10) : '',
        bezeichnung:     record.getCellValueAsString('BA_Bezeichnung') || '',
        belegNr:         record.getCellValueAsString('BA_Beleg_Nr') || '',
        brutto:          zahl('BA_Brutto'),
        netto:           zahl('BA_Netto'),
        ustBetrag:       zahl('BA_USt_Betrag'),
        ustSatz:         auswahlOder('BA_USt_Satz', UST_SAETZE, '19%'),
        kategorie:       KATEGORIEN.includes(record.getCellValueAsString('BA_Kategorie')) ? record.getCellValueAsString('BA_Kategorie') : '',
        zahlweg:         auswahlOder('BA_Zahlweg', ZAHLWEGE, 'Überweisung'),
        vorsteuer:       auswahlOder('BA_Vorsteuer_absetzbar', VORSTEUER, 'ja'),
        wiederkehrend:   auswahlOder('BA_Wiederkehrend', WIEDERKEHREND, 'nein'),
        zahlperiode:     auswahlOder('BA_Zahlperiode', ZAHLPERIODEN, 'einmalig'),
        notizen:         record.getCellValueAsString('BA_Notizen') || '',
        iban:            '',
    };
    if (daten.notizen.startsWith('Quelle:')) daten.notizen = '';
    if (daten.netto === null && daten.brutto !== null) berechneNettoUst(daten);

    output.clear();
    output.text(`══════════════════════════════`);
    output.text(`📄 ${daten.bezeichnung}`);
    if (belegUrl) output.markdown(`📎 [Rechnung öffnen](${belegUrl})`);
    output.text(`══════════════════════════════`);

    // ── Korrektur-Schleife ──
    while (true) {
        output.markdown('## 📋 Erkannte Felder');
        zeigZusammenfassung(daten);

        const aktion = await input.buttonsAsync('Was möchtest du tun?', [
            { label: '✅ Freigeben',      value: 'freigeben',     variant: 'primary' },
            { label: '✏️ Korrigieren',    value: 'korrigieren',   variant: 'default' },
            { label: '⏸️ Zurückstellen',  value: 'ueberspringen', variant: 'default' },
            { label: '⬅️ Zur Übersicht',  value: 'abbrechen',     variant: 'danger'  },
        ]);

        if (aktion === 'abbrechen') return 'abgebrochen';

        if (aktion === 'ueberspringen') {
            await tblBA.updateRecordAsync(record.id, { 'BA_Status': { name: STATUS.zurueckgestellt } });
            output.text('⏸️ Zurückgestellt (Status „in Bearbeitung“)');
            return 'zurueckgestellt';
        }

        if (aktion === 'korrigieren') {
            const feldNr = parseInt((await input.textAsync('Welches Feld korrigieren? (1-14)')) || '');
            if (feldNr >= 1 && feldNr <= 14) await korrigiereFeld(daten, feldNr);
            else output.text('⚠️ Ungültige Feldnummer');
            continue;
        }

        // Freigeben: Pflichtfelder prüfen
        if (!daten.kategorie) { output.text('⚠️ Bitte zuerst eine Kategorie wählen (Feld 9)'); continue; }
        if (daten.brutto === null) { output.text('⚠️ Bitte zuerst den Bruttobetrag eintragen (Feld 5)'); continue; }
        break;
    }

    // ── Lernregel-Hinweis ──
    const lernregel = await input.buttonsAsync(`Lernregel für "${daten.lieferant}" merken?`, [
        { label: '✅ Ja – immer so verarbeiten', value: 'ja' },
        { label: '⏭️ Nein – nur diese Rechnung', value: 'nein' }
    ]);
    if (lernregel === 'ja') {
        output.text(`💾 ${daten.lieferant} → ${daten.kategorie} | ${daten.ustSatz} | ${daten.zahlweg}`);
        output.text(`   → Bitte in knownInvoices des Apps Scripts eintragen`);
    }

    // ── Partner sicherstellen ──
    let partnerId = daten.partnerRecordId;
    if (daten.lieferant && !partnerId) {
        const pq = await tblPartner.selectRecordsAsync({ fields: ['PD_Firmenname', 'PD_IBAN'] });
        const existing = pq.records.find(p => p.getCellValueAsString('PD_Firmenname').toLowerCase() === daten.lieferant.toLowerCase());
        if (existing) {
            partnerId = existing.id;
            if (daten.iban && !existing.getCellValueAsString('PD_IBAN')) {
                await tblPartner.updateRecordAsync(existing.id, { 'PD_IBAN': daten.iban });
                output.text(`✏️ IBAN bei Partner ergänzt: ${daten.iban}`);
            }
        } else {
            const felder = { 'PD_Firmenname': daten.lieferant, 'PD_Typ': { name: 'Unternehmen' }, 'PD_Rolle': { name: 'BA-Lieferant' } };
            if (daten.iban) felder['PD_IBAN'] = daten.iban;
            partnerId = await tblPartner.createRecordAsync(felder);
            output.text(`➕ Neuer Partner angelegt: ${daten.lieferant}${daten.iban ? ' | IBAN: ' + daten.iban : ''}`);
        }
    } else if (partnerId && daten.iban && !daten.partnerNeu) {
        const p = await tblPartner.selectRecordAsync(partnerId, { fields: ['PD_IBAN'] });
        if (p && !p.getCellValueAsString('PD_IBAN')) {
            await tblPartner.updateRecordAsync(partnerId, { 'PD_IBAN': daten.iban });
            output.text(`✏️ IBAN bei Partner ergänzt: ${daten.iban}`);
        }
    }

    // ── Speichern ──
    const update = {
        'BA_Status':              { name: STATUS.freigegeben },
        'BA_Bezeichnung':         daten.bezeichnung,
        'BA_Beleg_Nr':            daten.belegNr,
        'BA_USt_Satz':            { name: daten.ustSatz },
        'BA_Kategorie':           { name: daten.kategorie },
        'BA_Zahlweg':             { name: daten.zahlweg },
        'BA_Vorsteuer_absetzbar': { name: daten.vorsteuer },
        'BA_Wiederkehrend':       { name: daten.wiederkehrend },
        'BA_Zahlperiode':         { name: daten.zahlperiode },
        'BA_Notizen':             daten.notizen,
    };
    if (daten.datum)            update['BA_Datum']      = daten.datum.substring(0, 10);
    if (daten.brutto !== null)  update['BA_Brutto']     = daten.brutto;
    if (daten.netto !== null)   update['BA_Netto']      = daten.netto;
    if (daten.ustBetrag !== null) update['BA_USt_Betrag'] = daten.ustBetrag;
    if (partnerId)              update['BA_PartnerID']  = [{ id: partnerId }];

    await tblBA.updateRecordAsync(record.id, update);
    output.text(`✅ Freigegeben: ${daten.lieferant} | ${formatZahl(daten.brutto)} | ${daten.kategorie}`);
    return 'freigegeben';
}

// ============================================================
// HAUPTSCHLEIFE: Übersicht → Rechnung → zurück zur Übersicht
// ============================================================

if (!KATEGORIEN.length) {
    output.text('❌ Feld BA_Kategorie hat keine Auswahloptionen – bitte in Airtable prüfen.');
} else {
    let letzteMeldung = '';
    while (true) {
        const q = await tblBA.selectRecordsAsync({
            fields: ['BA_Datum', 'BA_Bezeichnung', 'BA_Lieferant', 'BA_PartnerID', 'BA_Brutto', 'BA_Status'],
            sorts: [{ field: 'BA_Datum', direction: 'asc' }]
        });
        const status = r => r.getCellValueAsString('BA_Status');
        const offene = q.records.filter(r => status(r) === STATUS.offen || status(r) === '');
        const zurueck = q.records.filter(r => status(r) === STATUS.zurueckgestellt);

        output.clear();
        if (letzteMeldung) output.text(letzteMeldung);

        if (!offene.length && !zurueck.length) {
            output.text('✅ Keine offenen Rechnungen – alles erledigt.');
            break;
        }

        output.text(`📋 Invoice Review V2.6 – ${offene.length} offen${zurueck.length ? `, ${zurueck.length} zurückgestellt` : ''}`);

        const label = (r, prefix) => {
            const brutto = r.getCellValue('BA_Brutto');
            return `${prefix}${lieferantAnzeige(r)}  |  ${r.getCellValueAsString('BA_Datum') || '?'}  |  ${brutto !== null ? formatZahl(brutto) : '–'}`;
        };
        const buttons = [
            ...offene.map(r => ({ label: label(r, ''), value: r.id })),
            ...zurueck.map(r => ({ label: label(r, '⏸️ '), value: r.id })),
            { label: '❌ Beenden', value: '__end__' }
        ];

        const auswahl = await input.buttonsAsync('Welche Rechnung bearbeiten?', buttons);
        if (auswahl === '__end__') { output.text('Beendet.'); break; }

        const ergebnis = await bearbeiteRechnung(auswahl);
        letzteMeldung = ergebnis === 'freigegeben' ? '✅ Letzte Rechnung freigegeben.'
                      : ergebnis === 'zurueckgestellt' ? '⏸️ Letzte Rechnung zurückgestellt.'
                      : '';
    }
}
