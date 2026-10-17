# Tsumiki online stellen (tsumiki.de)

Stand V1.1, 17.10.2026. Dauer für dich: etwa 20 Minuten, danach 1–24 Stunden warten, bis die Domain umgestellt ist.

## So ist es eingerichtet

- **Server:** Render (render.com), Rechenzentrum Frankfurt. Rund 7,25 $ im Monat (Server 7 $ + 1 GB Festplatte 0,25 $).
  Render holt den Code selbst aus GitHub und aktualisiert die Seite bei jeder Änderung im Ordner `tsumiki/`.
- **Datenbank:** die Excel-Datei auf einer dauerhaften Festplatte bei Render. Render sichert die Festplatte täglich.
  Du lädst die aktuelle Datei in der Verwaltung unter *Einstellungen → Excel herunterladen*.
- **E-Mails:** Kundenmails gehen über dein IONOS-Postfach `noreply@tsumiki.de` raus. Antworten der Kunden landen in
  `info@tsumiki.de`. `rechnung@tsumiki.de` bleibt frei für eingehende Rechnungen (Sendico, DHL, Zoll).
- **Start im Warteliste-Modus:** Preisrechner und alle Seiten laufen, Bestellen ist noch zu. Besucher können sich
  stattdessen mit ihrer E-Mail eintragen. Die Liste siehst du in der Verwaltung unter *Einstellungen*.
- **Passwortschutz:** Die ganze Seite fragt zuerst nach einem Passwort (`SEITEN_PASSWORT`). Nur wer es kennt,
  sieht etwas; Suchmaschinen nehmen die Seite nicht auf. Das Verwaltungspasswort öffnet die Seite ebenfalls.
- **Sicherheit:** Die Verwaltung bekommt automatisch ein eigenes langes Zufallspasswort. Die Demo-Zahlung ist online abgeschaltet.

## Schritt 1: Render-Konto und Server (10 Minuten)

1. Auf **render.com** → *Get Started* → **mit GitHub anmelden** (dasselbe Konto wie für das Repo `rd-hub`).
   Render fragt, auf welche Repositories es zugreifen darf: `rd-hub` freigeben.
2. Zahlungsmittel hinterlegen (*Billing*), sonst lässt Render keine Festplatte zu.
3. Oben *New* → **Blueprint** → Repository `rd-hub` wählen, Branch `claude/new-session-emwkmn`
   (oder `main`, sobald die Änderung dort ist).
4. Render zeigt die Einstellungen aus `render.yaml` und fragt nach diesen Werten:
   - `SMTP_PASS`: das **Passwort des Postfachs noreply@tsumiki.de** (IONOS → E-Mail → noreply → Passwort ändern,
     falls du es nicht weißt).
   - `NTFY_TOPIC`: optional, für Push aufs Handy (siehe `ANLEITUNG.md`). Kann leer bleiben.
   - PayPal und Stripe: **leer lassen**, kommt erst beim echten Start.
5. *Apply* klicken. Nach 2–3 Minuten läuft die Seite unter einer Adresse wie `https://tsumiki-xxxx.onrender.com`.
6. Die beiden Passwörter stehen in Render beim Dienst *tsumiki* → *Environment* (Auge-Symbol):
   - `SEITEN_PASSWORT`: für die Seite, zum Weitergeben an Tester. Du kannst es dort durch ein eigenes ersetzen.
   - `ADMIN_PASSWORD`: für die Verwaltung, nur für dich.
   Der Benutzername ist bei beiden egal (z. B. `tsumiki`).

## Schritt 2: Domain bei IONOS umstellen (5 Minuten)

1. In Render beim Dienst *tsumiki* → *Settings* → *Custom Domains*. Dort stehen `tsumiki.de` und `www.tsumiki.de`
   schon drin, jeweils mit dem Eintrag, den IONOS bekommen soll. **Diese Werte abschreiben.**
   Üblich ist: für `tsumiki.de` ein **A-Eintrag auf 216.24.57.1**, für `www` ein **CNAME auf `tsumiki-xxxx.onrender.com`**.
2. Bei IONOS: *Domains & SSL* → `tsumiki.de` → *DNS*.
   - Den vorhandenen **A-Eintrag für `@`** auf die IP von Render ändern.
   - Einen vorhandenen **AAAA-Eintrag für `@`** löschen (der zeigt sonst auf die IONOS-Parkseite).
   - Für `www` einen **CNAME** auf die Render-Adresse anlegen (vorhandenen `www`-Eintrag vorher löschen).
   - **Nicht anfassen:** MX, TXT (SPF), `autodiscover` und alles andere rund um E-Mail. Sonst kommen keine Mails mehr an.
3. Zurück in Render auf *Verify* klicken. Das HTTPS-Zertifikat kommt automatisch, meist innerhalb einer Stunde.

## Schritt 3: Testen (5 Minuten)

- `https://tsumiki.de` öffnen → Passwortabfrage erscheint → `SEITEN_PASSWORT` eingeben, auf *Bestellen* einen Link einfügen → Preis erscheint, darunter die Warteliste.
- Dich selbst mit einer privaten Adresse eintragen.
- `https://tsumiki.de/admin/` öffnen → *Einstellungen*: Die Adresse steht in der Warteliste,
  bei *Anbindungen* steht „E-Mail-Versand: aktiv“.

## Später: den Shop freischalten

Wenn Gewerbe, Steuerberatung, Rechtstexte und PayPal/Stripe fertig sind:

1. Render → *Environment*: `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_ENV=live` und/oder `STRIPE_SECRET_KEY` eintragen.
2. `SHOP_OFFEN` auf `1` setzen und `SEITEN_PASSWORT` löschen → *Save*. Render startet neu, Bestellen ist offen.
3. In der Verwaltung unter *Einstellungen* mit *Alles leeren* eventuelle Testbestellungen entfernen
   (die Warteliste bleibt erhalten) und der Warteliste Bescheid geben.

Ohne eingetragene PayPal- bzw. Stripe-Schlüssel ist online nur Überweisung möglich.

## Vor dem ersten Besucher

Auch die Warteliste-Seite braucht ein **echtes Impressum und eine Datenschutzerklärung** (die Texte sind noch Entwürfe
mit Platzhaltern). Die Datenschutzerklärung muss die Warteliste, Render als Hoster und IONOS als E-Mail-Dienst nennen.
