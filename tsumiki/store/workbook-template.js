// Tsumiki V1.0 – Aufbau der Excel-Datenbank (Blätter, Formeln, Formatierung)
import ExcelJS from 'exceljs';
import { TABLES } from '../core/schema.js';
import { DEFAULT_PARAMS } from '../core/params.js';

const INK = 'FF17171A', RED = 'FFB4341C', SAND = 'FFF4F2EE', LINE = 'FFE4E1DB';
const P = (k) => `VLOOKUP("${k}",Parameter!$A:$B,2,FALSE)`;

function headerStyle(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
  row.alignment = { vertical: 'middle' };
  row.height = 22;
}

const MONEY_FIELDS = /EUR|Betrag|Netto|Brutto|USt$|Versand$|Servicegebuehr|Warenwert|Importkosten|Vergleich|Abweichung|Steuerbetrag/;

export function writeDataSheet(wb, sheetName, def, rows) {
  let ws = wb.getWorksheet(sheetName);
  if (!ws) ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  const oldCount = ws.rowCount;
  ws.getRow(1).values = def.cols.map((c) => c[0]);
  headerStyle(ws.getRow(1));
  def.cols.forEach(([name], i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(Math.max(name.length + 4, 12), name.includes('Text') || name.includes('Positionen') ? 40 : 28);
    if (MONEY_FIELDS.test(name) && !name.includes('Satz')) col.numFmt = '#,##0.00 €';
    if (name.includes('Satz')) col.numFmt = '0.0%';
  });
  // Zeilen überschreiben statt löschen/einfügen (zuverlässiger als spliceRows), Reste leeren
  const list = rows || [];
  list.forEach((r, i) => {
    ws.getRow(i + 2).values = def.cols.map(([, f]) => {
      const v = r[f];
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v);
      return v === undefined || v === null ? '' : v;
    });
  });
  for (let r = list.length + 2; r <= oldCount; r++) ws.getRow(r).values = [];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: def.cols.length } };
  return ws;
}

export function buildWorkbook(db) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tsumiki';
  wb.calcProperties.fullCalcOnLoad = true;

  // --- Start / Anleitung ---
  const st = wb.addWorksheet('Start', { properties: { tabColor: { argb: RED } } });
  st.getColumn(1).width = 4; st.getColumn(2).width = 110;
  const lines = [
    ['Tsumiki – Datenbank', { bold: true, size: 20 }],
    ['Diese Datei ist die Datenbank des Systems. Die Website schreibt jede Bestellung sofort hier hinein.', {}],
    ['Wichtig: Datei nicht geöffnet lassen, während Bestellungen laufen – Excel sperrt sie sonst (das System legt dann eine Sicherungskopie an).', { color: { argb: RED } }],
    ['', {}],
    ['Blätter', { bold: true, size: 13 }],
    ['Parameter – alle Preise, Gebühren, Kurse und Regeln. Nur Spalte "Wert" ändern.', {}],
    ['Kalkulator – Endpreis für einen Artikel ausrechnen, ohne die Website zu öffnen.', {}],
    ['Bestellungen / Positionen – jede Kundenbestellung und jeder einzelne Artikel.', {}],
    ['Sammelsendungen – jede Kiste aus Japan mit kalkulierten und tatsächlichen Kosten.', {}],
    ['Rechnungen – fortlaufend nummeriert, nie ändern oder löschen (GoBD). Korrektur nur per Gutschrift.', {}],
    ['Journal – alle Buchungen (Kontenvorschlag SKR03, mit Steuerberaterin abstimmen).', {}],
    ['Postausgang – jede E-Mail, die an Kunden ging.', {}],
    ['Protokoll – wer hat wann was gemacht.', {}],
    ['Auswertung – Kennzahlen auf einen Blick.', {}],
  ];
  lines.forEach(([t, f], i) => { const c = st.getCell(i + 2, 2); c.value = t; c.font = { name: 'Arial', size: 11, ...f }; });

  // --- Parameter ---
  const ps = wb.addWorksheet('Parameter', { properties: { tabColor: { argb: INK } }, views: [{ state: 'frozen', ySplit: 1 }] });
  ps.columns = [{ header: 'Schlüssel', width: 36 }, { header: 'Wert', width: 26 }, { header: 'Einheit', width: 10 }, { header: 'Beschreibung', width: 80 }];
  headerStyle(ps.getRow(1));
  for (const [k, def, unit, desc] of DEFAULT_PARAMS) {
    const v = db.params && k in db.params ? db.params[k] : def;
    const row = ps.addRow([k, v, unit, desc]);
    const c = row.getCell(2);
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SAND } };
    if (unit === '%') c.numFmt = '0.0%';
    if (unit === 'EUR') c.numFmt = '#,##0.00 €';
  }

  // --- Kalkulator (Formeln, gleiche Logik wie core/pricing.js) ---
  const k = wb.addWorksheet('Kalkulator', { properties: { tabColor: { argb: RED } } });
  k.getColumn(1).width = 44; k.getColumn(2).width = 18; k.getColumn(3).width = 4; k.getColumn(4).width = 4; k.getColumn(5).width = 34; k.getColumn(6).width = 12;
  k.getCell('A1').value = 'Endpreis-Kalkulator (ein Artikel, Lieferung nach Deutschland)'; k.getCell('A1').font = { bold: true, size: 14 };
  k.getCell('A2').value = 'Gelbe Felder ausfüllen. Ergebnis entspricht dem Preis auf der Website.'; k.getCell('A2').font = { color: { argb: 'FF5C5C63' } };
  const input = (cell) => { k.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3C4' } }; };
  const rows = [
    ['A4', 'Preis in Japan (¥)', 'B4', 9250],
    ['A5', 'Größe', 'B5', 'Sehr klein'],
    ['A6', 'Inlandsversand im Preis enthalten? (ja/nein)', 'B6', 'ja'],
    ['A7', 'Mercari oder Yahoo? (ja/nein)', 'B7', 'ja'],
    ['A8', 'Anzahl Artikel in der Bestellung (für Rabatt)', 'B8', 1],
    ['A9', 'Tageskurs ¥ je € (EZB)', 'B9', { formula: P('kurs_jpy_je_eur_fallback') }],
  ];
  rows.forEach(([a, label, b, v]) => { k.getCell(a).value = label; k.getCell(b).value = v; input(b); });
  k.getCell('B5').dataValidation = { type: 'list', allowBlank: false, formulae: ['$E$4:$E$8'] };
  k.getCell('B6').dataValidation = { type: 'list', formulae: ['"ja,nein"'] };
  k.getCell('B7').dataValidation = { type: 'list', formulae: ['"ja,nein"'] };
  [['Sehr klein', 'gewicht_einzelkarte_kg'], ['Karte im Case', 'gewicht_slab_kg'], ['Klein', 'gewicht_booster_kg'], ['Mittel', 'gewicht_display_kg'], ['Weiß nicht', 'gewicht_sonstiges_kg']]
    .forEach(([label, key], i) => { k.getCell(`E${4 + i}`).value = label; k.getCell(`F${4 + i}`).value = { formula: P(key) }; });
  k.getCell('E3').value = 'Größe → Gewicht (kg)'; k.getCell('E3').font = { bold: true };
  const calc = [
    ['A11', 'Effektiver Kurs (mit Puffer)', `B9*(1-${P('kurs_puffer')})`, '0.00'],
    ['A12', 'Warenwert (€)', 'ROUND(B4/B11,2)'],
    ['A13', 'Inlandsversand Japan (€)', `IF(B6="nein",ROUND(${P('inlandsversand_japan_schaetzung_jpy')}/B11,2),0)`],
    ['A14', 'Sendico-Gebühr (€)', `ROUND((${P('sendico_gebuehr_jpy')}+IF(B7="ja",${P('sendico_aufschlag_marktplatz_jpy')},0))/B11,2)`],
    ['A15', 'Gewicht (kg)', 'VLOOKUP(B5,$E$4:$F$8,2,FALSE)', '0.00'],
    ['A16', 'Fracht + Anteil Fixkosten (€)', `ROUND(B15*${P('fracht_eur_je_kg')},2)+ROUND(${P('sendung_fixkosten_eur')}/${P('sendung_erwartete_positionen')},2)`],
    ['A17', 'Zoll (€)', `ROUND((B12+B13+ROUND(B15*${P('fracht_eur_je_kg')},2))*${P('zoll_satz_karten')},2)`],
    ['A18', 'Servicegebühr (€)', `ROUND(MIN(${P('gebuehr_grund_eur')}+B12*IF(B8>=6,${P('gebuehr_prozent_ab6')},IF(B8>=3,${P('gebuehr_prozent_ab3')},${P('gebuehr_prozent')})),${P('gebuehr_max_eur')}),2)`],
    ['A19', 'Versand zum Kunden (€)', `IF(B12<=${P('versand_de_grenze_eur')},${P('versand_de_klein_eur')},${P('versand_de_paket_eur')})`],
    ['A20', 'Summe netto (€)', 'SUM(B12:B14)+SUM(B16:B19)'],
    ['A21', 'Umsatzsteuer (€)', `ROUND(B20*${P('ust_satz_de')},2)`],
    ['A22', 'ENDPREIS für den Kunden (€)', 'B20+B21'],
    ['A24', 'Vergleich: Kunde bestellt allein (€)', `ROUND(B12+B13+B14+(${P('allein_kurier_grund_eur')}+MAX(0.5,B15)*${P('allein_kurier_eur_je_kg')})+IF(B12+B13+${P('allein_kurier_grund_eur')}+MAX(0.5,B15)*${P('allein_kurier_eur_je_kg')}<=150,${P('allein_pauschalzoll_eur')},(B12+B13+${P('allein_kurier_grund_eur')}+MAX(0.5,B15)*${P('allein_kurier_eur_je_kg')})*${P('zoll_satz_karten')})+(B12+B13+${P('allein_kurier_grund_eur')}+MAX(0.5,B15)*${P('allein_kurier_eur_je_kg')}+IF(B12+B13+${P('allein_kurier_grund_eur')}+MAX(0.5,B15)*${P('allein_kurier_eur_je_kg')}<=150,${P('allein_pauschalzoll_eur')},(B12+B13+${P('allein_kurier_grund_eur')}+MAX(0.5,B15)*${P('allein_kurier_eur_je_kg')})*${P('zoll_satz_karten')}))*${P('ust_satz_de')}+MAX(${P('allein_verzollungsgebuehr_eur')},0.02*(B12+B13+${P('allein_kurier_grund_eur')}+MAX(0.5,B15)*${P('allein_kurier_eur_je_kg')})),2)`],
    ['A25', 'Ersparnis für den Kunden (€)', 'B24-B22'],
    ['A26', 'Dein Gewinn (Gebühr − Zahlungsgebühr) (€)', `ROUND(B18-(B22*${P('zahlung_prozent')}+${P('zahlung_fix_eur')}),2)`],
  ];
  calc.forEach(([a, label, f, fmt]) => {
    k.getCell(a).value = label;
    const b = a.replace('A', 'B');
    k.getCell(b).value = { formula: f };
    k.getCell(b).numFmt = fmt || '#,##0.00 €';
  });
  ['A22', 'B22'].forEach((c) => { k.getCell(c).font = { bold: true, size: 13, color: { argb: RED } }; });
  ['A25', 'B25', 'A26', 'B26'].forEach((c) => { k.getCell(c).font = { bold: true }; });

  // --- Datentabellen ---
  for (const [sheet, def] of Object.entries(TABLES)) writeDataSheet(wb, sheet, def, db[def.key] || []);

  // --- Auswertung ---
  const a = wb.addWorksheet('Auswertung', { properties: { tabColor: { argb: INK } } });
  a.getColumn(1).width = 46; a.getColumn(2).width = 18;
  a.getCell('A1').value = 'Auswertung'; a.getCell('A1').font = { bold: true, size: 14 };
  const kpis = [
    ['Bestellungen gesamt', 'COUNTA(Bestellungen!A:A)-1', '0'],
    ['… warten auf Kauf (Status "neu")', 'COUNTIF(Bestellungen!D:D,"neu")', '0'],
    ['… warten auf Überweisung', 'COUNTIF(Bestellungen!D:D,"zahlung_offen")', '0'],
    ['… im Lager Japan (gekauft)', 'COUNTIF(Bestellungen!D:D,"gekauft")', '0'],
    ['… unterwegs', 'COUNTIF(Bestellungen!D:D,"unterwegs")', '0'],
    ['… angekommen, zu versenden', 'COUNTIF(Bestellungen!D:D,"angekommen")', '0'],
    ['… versendet', 'COUNTIF(Bestellungen!D:D,"versendet")', '0'],
    ['Abgebuchter Umsatz brutto', 'SUM(Bestellungen!O:O)', '#,##0.00 €'],
    ['Servicegebühren (netto, kalkuliert)', 'SUMIF(Bestellungen!O:O,">0",Bestellungen!R:R)', '#,##0.00 €'],
    ['Logistik kalkuliert (alle Sendungen)', 'SUM(Sammelsendungen!P:P)', '#,##0.00 €'],
    ['Logistik tatsächlich', 'SUM(Sammelsendungen!Q:Q)', '#,##0.00 €'],
    ['Abweichung (positiv = günstiger als kalkuliert)', 'SUM(Sammelsendungen!R:R)', '#,##0.00 €'],
    ['Rechnungen ausgestellt', 'COUNTIF(Rechnungen!E:E,"Rechnung")', '0'],
    ['Gutschriften', 'COUNTIF(Rechnungen!E:E,"Gutschrift")', '0'],
  ];
  kpis.forEach(([label, f, fmt], i) => {
    a.getCell(i + 3, 1).value = label;
    const c = a.getCell(i + 3, 2); c.value = { formula: f }; c.numFmt = fmt;
  });
  a.getCell('A19').value = 'Umsatzsteuer, Ergebnis je Auftrag und Nachkalkulation: in der Verwaltung unter „Buchhaltung“.';
  a.getCell('A19').font = { italic: true, color: { argb: 'FF5C5C63' } };

  return wb;
}
