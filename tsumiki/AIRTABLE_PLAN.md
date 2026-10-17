# Tsumiki: Excel jetzt, Airtable später

Stand 17.10.2026. Notiz zur Frage, ob Tsumiki gleich in Airtable starten soll.

## Empfehlung

**Mit Excel starten und nach der Testphase zu Airtable wechseln, aber in eine eigene Base.**

- **Excel reicht für den Anfang.** Solange es wenige Bestellungen sind und nur du arbeitest, kostet Excel
  nichts und läuft ohne Zugangsdaten. Bis dahin werden sich Spalten und Abläufe noch ändern, und das geht in
  Excel schneller.
- **Wechseln, sobald eins davon eintritt:** etwa 30 bis 50 Bestellungen im Monat, die Verwaltung soll aufs
  Handy, eine zweite Person arbeitet mit, oder die Website soll online laufen (dann braucht der Server eine
  Datenbank im Netz statt einer Datei auf dem eigenen Rechner).
- **Eigene Base, nicht die Replay-Dealers-Base.** Tsumiki ist ein Einzelunternehmen und von der GbR getrennt.
  Rechnungsnummern, Journal und USt-Werte dürfen nicht vermischt werden, und Mitgesellschafter sollen nicht
  automatisch Tsumiki-Kundendaten sehen. Der gleiche Workspace und der gleiche Airtable-Plan gehen aber.

## Was von Replay Dealers wiederverwendet werden kann

| Was | Wie |
| --- | --- |
| Spalten-Präfixe (`BE_`, `POS_`, `SE_`, `RE_`, `BU_` …) | sind schon im RD-Stil, siehe `core/schema.js` |
| Airtable-Workspace, Token-Verwaltung | neuer Token nur mit Zugriff auf die Tsumiki-Base |
| RD Hub (PWA) | später ein Bereich „Tsumiki“ im Hub, der die Tsumiki-Base liest (Kaufliste, Ankunft abhaken) |
| Sendico-Abläufe, Kurs-Abruf, JP-Kalkulator | gleiche Logik; der Rechenkern `core/pricing.js` ist eigenständig nutzbar |

## Umzug technisch

Die Speicherschicht ist austauschbar: `store/excel-store.js` lädt die ganze Datenbank (`load()`) und
schreibt Änderungen nacheinander (`transact()`). Für Airtable kommt eine zweite Datei `store/airtable-store.js`
mit denselben Funktionen dazu; `server.js` wählt per `.env` (`STORE=airtable`) aus.

1. Tsumiki-Base anlegen: je Excel-Blatt eine Tabelle, Spaltennamen 1:1 aus `core/schema.js`.
   Blatt „Parameter“ wird eine Tabelle mit den Feldern Schlüssel/Wert.
2. Verknüpfungen setzen: `POS_Bestellung` und `BE_Sendung` als Link-Felder.
3. `airtable-store.js` schreiben und mit `npm test` gegen eine Test-Base prüfen.
4. Einmal-Import: vorhandene Excel-Datei in die Base kopieren (kleines Skript).
5. Excel-Datei als Archiv behalten.

Aufwand grob: 1 bis 2 Tage.

## Vorsicht

- Der Airtable-Token gehört auf den Server (`.env`), nie in eine Website-Datei. Im RD Hub steht der Token
  heute im Klartext in `index.html`; für Tsumiki bitte nicht so übernehmen.
- `data/` ist in `.gitignore` eingetragen, damit echte Kundendaten nicht ins Repo gelangen.
