# Tsumiki – Projektkontext für Claude Code (Stand V1.0.1, 17.10.2026)

Japan-Sammelimport für japanische Sammelkarten. Inhaber: Bastian Karlshaus (Einzelunternehmen, getrennt von der
Replay Dealers GbR). Kunden fügen einen Link (Mercari, Yahoo, Suruga-ya …) ein, sehen einen Endpreis inkl. Versand,
reservieren; Bastian kauft über Sendico, bündelt monatlich in einer Sammelsendung („Kiste“), importiert gewerblich
und verschickt von Wuppertal aus in DE/EU. Bastian ist Business Analyst, kein Entwickler: Erklärungen auf Deutsch,
einfach, ohne Fachjargon.

## Konventionen
- Versionierung: neue Funktion +0.1 (V1.0 → V1.1), Bugfix +0.0.1 (V1.0 → V1.0.1). Version in `package.json`,
  Kopfkommentaren und ZIP-Dateinamen mitziehen.
- Jede Geschäftszahl gehört in `core/params.js` (DEFAULT_PARAMS) bzw. das Excel-Blatt „Parameter“, nie in Code.
- `core/` ist reines JS ohne Node-Abhängigkeiten: läuft auf dem Server UND im Browser (Demo-Modus). So lassen.
- Tests: `npm start` in einem Fenster, `npm test` im zweiten → muss mit „Alles grün.“ enden.
  Danach `data/` löschen, wenn mit leerer DB weitergearbeitet werden soll.

## Architektur
| Datei | Aufgabe |
| --- | --- |
| `core/params.js` | Parameter (Kurs, Gebühren, Gewichte, Versand, Steuern), EU-USt-Sätze, Artikelarten, Plattformen |
| `core/pricing.js` | Rechenkern: `quote()` Endpreis + Vergleich „allein bestellt“ + erwarteter Gewinn, `nextCutoff()` Stichtag |
| `core/schema.js` | Tabellen/Spalten der Excel-Blätter, Status-Werte |
| `core/workflow.js` | Abläufe + Buchungen (SKR03): createOrder, markAuthorized, purchasePosition, createShipment, sendShipment, arriveShipment (Nachkalkulation nach Gewicht), togglePositionChecked, shipOrder (Rechnung), returnOrder (Gutschrift), ustva, orderProfit, datevCsv |
| `core/documents.js` | Rechnung/Gutschrift-HTML, alle Kundenmails |
| `core/demo-seed.js` | 6 Beispielbestellungen |
| `store/excel-store.js` | Excel als Datenbank (ExcelJS), Änderungen nacheinander, bei gesperrter Datei Kopie `_GESPERRT_*.xlsx` |
| `store/workbook-template.js` | Aufbau der Arbeitsmappe inkl. Blatt „Kalkulator“ mit Formeln (spiegelt pricing.js!) |
| `server/payments.js` | PayPal Orders v2 (intent AUTHORIZE → capture/void), Stripe Checkout (capture_method manual), sonst Demo |
| `server.js` | Express: Seiten, `/api/*` für Kunden, `/admin/*` + `/admin/api/*` mit Basic-Auth (ADMIN_PASSWORD) |
| `public/` | Website (index, so-gehts, preise, ueber-uns, faq, bestellen, kasse, bezahlen, status, Rechtstexte) und `public/admin/` |
| `public/assets/demo-backend.js` | Browser-Variante des Servers (localStorage) für die Online-Demo; `mode.js` schaltet `server`/`demo` |

## Geschäftslogik (Kurzfassung)
- Endpreis = Ware (Yen zum EZB-Kurs −2 % Puffer) + Sendico ¥500 (+¥300 Mercari/Yahoo) + ggf. ¥750 Inlandsversand
  + Fracht 10 €/kg + Fixkosten 45 €/30 Positionen + Zoll 2,7 % + Servicegebühr + Versand, darauf 19 % USt.
- Servicegebühr: 5 € fix + 5 % (ab 3 Artikeln 4,5 %, ab 6 Artikeln 4 %), max. 40 €. Ziel ≈ 5 € Gewinn je Bestellung.
- Versand DE: 1,80 € bis 50 € Warenwert, sonst 6,19 €. EU: 6,50 € (zu prüfen) / 14,90 €.
- Kiste: Stichtag 20. des Monats, Mindestmenge 10 Aufträge, Lieferzeit 10–16 Tage ab Stichtag.
- Zahlung wird nur vorgemerkt; abgebucht wird nach dem Kauf, und zwar nur für tatsächlich gekaufte Artikel.
- Steuer (Entwurf, mit Steuerberaterin Patty klären): Einkaufskommission, 19 % USt auf den vollen Preis,
  EUSt als Vorsteuer (1588), Anzahlungen über 1718, Sendico-Gebühr §13b, OSS per Parameter `oss_aktiv`.

## Offene Punkte / nächste Versionen
- V1.1: E-Mail-Versand (SMTP, sobald Postfach existiert), echte Erstattungen PayPal/Stripe (`payments.refund` ist TODO),
  DHL-Geschäftskunden-API für Labels.
- Hosting im eigenen Google-Cloud-Projekt; später Airtable statt Excel (Tabellen sind 1:1 übertragbar).
- Rechtstexte (Impressum, AGB, Widerruf, Datenschutz) sind Entwürfe; Platzhalter im Blatt Parameter ersetzen.
- Noch nie in einem echten Browser durchgeklickt (nur Code-Review + HTTP-Ende-zu-Ende-Test): als Erstes prüfen.
