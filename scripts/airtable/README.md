# Airtable-Skripte – Replay Dealers

Stand: November 2026 · Base „PRODUKTION - ReplayDealers“

Diese Dateien sind die maßgebliche Fassung. In Airtable den Inhalt der jeweiligen
Erweiterung bzw. Automation komplett durch die Datei ersetzen.

## Im Repo (aktuell)

| Datei | Version | Wo in Airtable |
|---|---|---|
| `pimp_automation.js` | V2.2 | Automation „PIMP-Verarbeitung 15 Min“ |
| `clearing.js` | V2.10.23 | Erweiterung „Scripting“ – Clearing |
| `kimp_kategorisierung.js` | V2.0 | Erweiterung „Scripting“ – KIMP Kategorisierung & Transfer |
| `invoice_review.js` | V2.6 | Erweiterung „Scripting“ – Invoice Review |
| `ba_erfassung.js` | V2.0 | Erweiterung „Scripting“ – BA-Erfassung |
| `verkauf.js` | V10.1 | Erweiterung „Scripting“ – Verkauf |
| `migration_eb2025_nach_pimp.js` | – | einmaliger Import 2025 (erledigt, nur Referenz) |

## In Airtable, unverändert in Ordnung (noch nicht im Repo)

Einkauf V8.4 · Storno Verkauf V1.5.4 · EK-Auswertung V1.1.1 ·
Profitabilitäts-Analyse V1.0 · eBay Listings Rentabilität V1.3 · KIMP-BA-Matching V1.1

## In Airtable löschen

| Skript | Grund |
|---|---|
| PIMP-Verarbeitung V3.0 (manuell) | Feld `PIMP_VK_Lot` gibt es nicht mehr; Automation + eBay-Sync übernehmen |
| PD-Erfassung V1.2 | Partner werden in Einkauf/Verkauf/BA/Clearing angelegt; schreibt nicht existierende Felder |
| KIMP Kategorisierung und Transfer V1.3 | ersetzt durch `kimp_kategorisierung.js` V2.0 |
| PP Kategorisierung V2.0 | in `kimp_kategorisierung.js` Schritt 1 |
| PP Clearing V1.2 | in `kimp_kategorisierung.js` Schritt 1 |
| KIMP ↔ PayPal Matching V1.5 | in `kimp_kategorisierung.js` Schritt 1 |
| KIMP PP Kategorie-Transfer V2.1 | in `kimp_kategorisierung.js` Schritt 1 |
| KIMP Clearing V1.7 | in `kimp_kategorisierung.js` Schritt 3 |
| EB ↔ KIMP Matching V1.0 | Tabelle `eBay_Transaktionen_2025` existiert nicht mehr; jetzt Schritt 2 über PIMP |
| EB → KIMP Kategorie-Transfer V1.1 | wie oben |

## Gemeinsame Regeln

- **VK-Lot** wird überall aus `VK_ID` gebildet: `VK<JJ>/<VK_ID dreistellig>`.
- **Titel-Abgleich** (Automation + Clearing) nutzt dieselbe Funktion: Akzente werden
  aufgelöst (Pokéball = Pokeball), Bindestriche trennen Wörter, Teilwörter zählen.
- **Auswahllisten** (Kategorien, Zahlwege …) werden aus den Airtable-Feldern gelesen,
  nicht im Skript fest eingetragen.
- PIMP-Zuordnungsfelder werden über Feld-IDs angesprochen (`fldDLyYgaHskBU6tY` = PIMP_VK,
  `fldQCizhd9RvD54bq` = PIMP_VK_2026).
