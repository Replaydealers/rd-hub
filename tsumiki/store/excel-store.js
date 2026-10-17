// Tsumiki V1.0 – Excel als Datenbank.
// Die Datei data/Tsumiki_Datenbank.xlsx ist die einzige Wahrheit. Jede Änderung wird sofort gespeichert.
// Später austauschbar gegen Airtable: gleiche Funktionen load()/save(), gleiche Tabellen/Spalten.
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { TABLES, NUMERIC_FIELDS, emptyDb } from '../core/schema.js';
import { DEFAULT_PARAMS, paramsToObject } from '../core/params.js';
import { buildWorkbook, writeDataSheet } from './workbook-template.js';

export class ExcelStore {
  constructor(file) {
    this.file = file;
    this.queue = Promise.resolve();
  }

  async init() {
    if (!fs.existsSync(this.file)) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const wb = buildWorkbook(emptyDb(paramsToObject(DEFAULT_PARAMS)));
      await wb.xlsx.writeFile(this.file);
      console.log('Neue Excel-Datenbank angelegt:', this.file);
    }
    this.db = await this.load();
  }

  async load() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(this.file);
    const db = emptyDb({});
    // Parameter
    const ps = wb.getWorksheet('Parameter');
    const known = paramsToObject(DEFAULT_PARAMS);
    db.params = { ...known };
    if (ps) {
      ps.eachRow((row, i) => {
        if (i === 1) return;
        const k = cellVal(row.getCell(1).value);
        if (!k) return;
        let v = cellVal(row.getCell(2).value);
        if (typeof known[k] === 'number') v = Number(v);
        db.params[k] = v;
      });
    }
    for (const [sheet, def] of Object.entries(TABLES)) {
      const ws = wb.getWorksheet(sheet);
      if (!ws) continue;
      const header = ws.getRow(1).values.slice(1).map(cellVal);
      ws.eachRow((row, i) => {
        if (i === 1) return;
        const rec = {};
        let any = false;
        def.cols.forEach(([colName, field]) => {
          const idx = header.indexOf(colName);
          let v = idx >= 0 ? cellVal(row.getCell(idx + 1).value) : '';
          if (v instanceof Date) v = v.toISOString();
          if (NUMERIC_FIELDS.has(field) && v !== '' && v !== null && v !== undefined) v = Number(v);
          if (v === null || v === undefined) v = '';
          if (v !== '') any = true;
          rec[field] = v;
        });
        if (any) db[def.key].push(rec);
      });
    }
    return db;
  }

  // Serialisiert alle Schreibzugriffe, damit sich zwei Bestellungen nicht überschreiben
  async transact(fn) {
    const run = async () => {
      const result = await fn(this.db);
      await this.save();
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async save() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(this.file);
    // Parameter-Werte zurückschreiben (Beschreibung/Formatierung bleibt)
    const ps = wb.getWorksheet('Parameter');
    ps.eachRow((row, i) => {
      if (i === 1) return;
      const k = cellVal(row.getCell(1).value);
      if (k && k in this.db.params) row.getCell(2).value = this.db.params[k];
    });
    for (const [sheet, def] of Object.entries(TABLES)) writeDataSheet(wb, sheet, def, this.db[def.key]);
    wb.calcProperties.fullCalcOnLoad = true;
    const tmp = this.file + '.tmp';
    await wb.xlsx.writeFile(tmp);
    try {
      fs.renameSync(tmp, this.file);
    } catch (e) {
      // Datei ist in Excel geöffnet (Windows sperrt sie) → Sicherung daneben schreiben
      const alt = this.file.replace(/\.xlsx$/, `_GESPERRT_${Date.now()}.xlsx`);
      fs.renameSync(tmp, alt);
      console.warn('Excel-Datei ist gesperrt (vermutlich geöffnet). Änderungen gesichert in:', alt);
    }
  }
}

function cellVal(v) {
  if (v && typeof v === 'object') {
    if ('result' in v) return v.result;
    if ('text' in v) return v.text;
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if (v instanceof Date) return v;
  }
  return v;
}
