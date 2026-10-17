# Tsumiki V1.0.1 – Anleitung

Japan-Sammelimport für Sammelkarten: Website mit Bestellstrecke, Verwaltung, Rechenkern, Buchhaltung.
Datenbank ist eine Excel-Datei (`data/Tsumiki_Datenbank.xlsx`), später austauschbar gegen Airtable.

## 0. Weiterarbeiten mit Claude Code

Ordner in Claude Code öffnen. Die Datei `CLAUDE.md` enthält den kompletten Projektkontext (Architektur, Preislogik, Steuern, offene Punkte).

## 1. Starten (5 Minuten)

1. **Node.js** installieren: https://nodejs.org → Version „LTS“.
2. Ordner entpacken, z. B. nach `Dokumente\Tsumiki`.
3. **Windows:** Doppelklick auf `START-WINDOWS.bat`. **Mac:** Rechtsklick auf `START-MAC.command` → Öffnen.
   Beim ersten Start werden die Pakete installiert (1–2 Minuten).
4. Der Browser öffnet **http://localhost:3000** – das ist die Website.
5. Die Verwaltung liegt unter **http://localhost:3000/admin/** (Passwort: `tsumiki`, Benutzername egal).

Beenden: Fenster schließen. Alle Daten stehen in der Excel-Datei.

## 2. Eine Beispielbestellung durchspielen

1. Website → **Bestellen** → Link einfügen, z. B. `https://jp.mercari.com/item/m12345678901`, Preis `9250`, hinzufügen.
   Zweiten Artikel hinzufügen und sehen, wie der Preis pro Artikel sinkt.
2. **Weiter zur Kasse** → Adresse → PayPal → **Zahlungspflichtig bestellen**.
3. Ohne PayPal-Zugang erscheint die **Test-Zahlung** → „Betrag vormerken“. Du landest auf der Statusseite des Kunden.
4. Verwaltung → **Kaufen**: Bei jedem Artikel „Gekauft“ oder „Nicht verfügbar“. Danach wird automatisch abgebucht
   (nur für gekaufte Artikel) und der Kunde bekommt eine Mail (siehe **Postausgang**).
5. **Japan & Kiste** → „Sammelsendung bilden“ → Kurier, Sendungsnummer, Fracht in ¥ → „Ist losgeschickt“.
6. Wenn die Kiste da ist: Zoll, Einfuhrumsatzsteuer und Verzollungsgebühr aus der Kurierrechnung → „Ist angekommen“.
   Das System verteilt die echten Kosten auf die Artikel (Nachkalkulation).
7. **Ankunft & Versand** → Artikel abhaken (oder Sendico-Nr. eintippen/scannen) → Sendungsnummer → „Versendet“.
   Rechnung und Buchungen entstehen automatisch.
8. **Buchhaltung**: Umsatzsteuer je Monat, Nachkalkulation, Rechnungen, Journal, CSV-Export für die Steuerberaterin.

Schneller: Verwaltung → **Einstellungen** → „Beispieldaten laden“ (sechs Bestellungen in allen Stufen).

## 3. Täglicher Ablauf

| Wann | Was | Wo |
| --- | --- | --- |
| Push „Neue Bestellung“ | Angebot öffnen, bei Sendico kaufen, „Gekauft“ tippen | Kaufen |
| Überweisung eingegangen | „Zahlung ist eingegangen“ | Kaufen |
| Stichtag (20.), ab 10 Aufträgen | Sammelsendung bilden, bei Sendico verschicken | Japan & Kiste |
| Kiste angekommen | Kosten eintragen, Artikel abhaken, versenden | Japan & Kiste, Ankunft & Versand |
| Monatlich | CSV-Export an die Steuerberaterin | Buchhaltung |

## 4. Preise und Regeln ändern

Alles, was eine Geschäftsentscheidung ist, steht im Excel-Blatt **Parameter** oder in Verwaltung → Einstellungen:
Servicegebühr (Grund + %), Mengenrabatt, Versandpreise, Fracht je kg, Fixkosten je Sendung, Mindestmenge, Stichtag,
Kurspuffer, Höchstwert je Artikel. Das Blatt **Kalkulator** rechnet einen Artikel exakt wie die Website.

**Excel-Datei nicht geöffnet lassen**, während der Server läuft. Ist sie gesperrt, schreibt das System eine Kopie
`…_GESPERRT_….xlsx` daneben (nichts geht verloren). Parameter am besten in der Verwaltung ändern.

## 5. Echte Zahlungen, Push, E-Mail

`.env.example` zu `.env` kopieren und ausfüllen:

- **ADMIN_PASSWORD** – unbedingt ändern.
- **NTFY_TOPIC** – App „ntfy“ aufs Handy, Thema abonnieren, hier eintragen → Push bei jeder Bestellung, Tippen öffnet „Kaufen“.
- **PayPal** – Sandbox-Zugang (developer.paypal.com). Es wird nur autorisiert (vorgemerkt) und nach dem Kauf eingezogen.
  Achtung: PayPal-Autorisierungen sind 3 Tage garantiert gültig → am selben Tag kaufen.
- **Stripe** – Testschlüssel `sk_test_…`. Karte, Apple Pay, Google Pay und Klarna im Stripe-Dashboard aktivieren.
  Kartenreservierungen verfallen nach 7 Tagen.
- **E-Mail-Versand** ist noch nicht angeschlossen: Mails landen im Postausgang (Verwaltung + Excel).
  Für den Start: Postfach zur Domain + Versanddienst (z. B. Brevo, kostenloser Einstieg) – Anschluss in `core/workflow.js` → `ctx.mailer`.

## 6. Dateien

| Ordner/Datei | Inhalt |
| --- | --- |
| `core/pricing.js` | Rechenkern (Endpreis, Gebühr, Versand, Vergleich „allein bestellt“) |
| `core/workflow.js` | Abläufe, Rechnungen, Buchungen, Umsatzsteuer, Nachkalkulation, DATEV-Export |
| `core/params.js` | Standardwerte aller Parameter, EU-Steuersätze, erlaubte Shops |
| `core/documents.js` | Rechnungsvorlage und Kunden-Mails |
| `store/` | Excel als Datenbank (Aufbau, Lesen, Schreiben) |
| `server/payments.js` | PayPal, Stripe, Demo-Zahlung |
| `public/` | Website (alle Seiten) und `public/admin/` Verwaltung |
| `tests/e2e.js` | Kompletttest: `npm test` (Server muss laufen) |

## 7. Vor dem echten Start (Checkliste)

- [ ] Name/Domain/Marke final (DPMA, TMview, denic.de) → `marke_name` + Texte
- [ ] Gewerbe anmelden, Finanzamt (Fragebogen steuerliche Erfassung), USt-IdNr., **EORI** auf Tsumiki/Bastian
- [ ] Nebentätigkeit beim Arbeitgeber anzeigen
- [ ] Anwalt: AGB, Widerruf (Ausnahme für Beschaffung im Kundenauftrag?), Impressum, Datenschutz – Entwürfe liegen bei
- [ ] Steuerberaterin: Kontenplan, Anzahlungen, §13b Sendico, OSS ab 10.000 € EU-Umsatz
- [ ] Sendico fragen: Deklaration mit Firma als Empfänger + Handelsrechnung mit allen Positionen; Artikelnummer aufs Paket
- [ ] Echte Testsendung: Fracht/kg und Fixkosten je Sendung in den Parametern kalibrieren
- [ ] PayPal/Stripe live, DHL-Geschäftskundenkonto, E-Mail-Versand
- [ ] Hosting (eigenes Google-Cloud-Projekt) – Server läuft dort unverändert; Datenbank dann Airtable statt Excel

## 8. Versionen

V1.0 (Okt 2026) – erste vollständige Fassung. Neue Funktionen +0.1, Fehlerbehebungen +0.0.1.
