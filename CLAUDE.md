# RD-Hub – Hinweise für Claude

Replay Dealers: Retro-Konsolen, Spiele, Zubehör und Pokémon-Karten. Daten liegen in der
Airtable-Base `appwhhRzsznu1LTRX`, die Web-App ist `index.html`, Airtable-Skripte in `scripts/airtable/`.

## Artikel eintragen → immer mit Produkt verknüpfen

Wenn Claude neue Artikel in `Artikel_2026` (`tbljlEbKb1ejMeuNp`) einträgt:

1. Vorher mit der Tabelle `Produkt` (`tblvfeGsh2wXVU7Xe`) abgleichen – über Plattform (ITEM_Konsole)
   und Titel (ITEM_Artikel). Pokémon-Karten über die Set-Nummer (z. B. `sv2a 169`).
2. Passt ein Produkt → Verknüpfungsfeld `ITEM_SetID` (`fldo9JagV8eBqNm2j`) setzen.
3. Kommt der Artikel öfter vor und es gibt kein Produkt → neues Produkt anlegen
   (Klarname, PROD_Kategorie, Kennung A/B nach Schema unten) und dem Nutzer melden.
4. Einzelstücke bleiben ohne Produkt.
5. Am Ende kurz berichten: neu angelegte Produkte + Artikel ohne Produkt.

Nur so stimmen `Prod_Bestand`, `PROD_Verkauft_Anzahl`, Ø EK/VK und `PROD_Nachkaufen`.

## Produkt-ID = PROD_Kennung_A + " " + PROD_Kennung_B

- Kennung A (`fldp2Ub1i8ZuNiGjv`) = Plattform, Kennung B (`fldKQy082MWYqQIsr`) = Produktkürzel
  (Großbuchstaben, Bindestrich statt Leerzeichen). Beispiele: `PSV MC16`, `N64 EXPPAK`,
  `GBA AGB-005`, `NSW POKEBALL-MEW`, `SFC SGB2`, `APL IPOD-CLASSIC`.
- Plattform-Kürzel: NSW, PSV, PSP, PS1, PS2, PS3, N64, SFC (jap. Super Famicom), SNES, GB, GBC,
  GBA, GC, WII, DC, NEO, FDS, APL (Apple), PKM (Pokémon-Merch).
- Pokémon-Karten: Kennung A = Set (`sv2a`, `sv10`, `s10a`, `m2a` …), Kennung B = Kartennummer
  ohne führende Nullen. Set-Nummer im Zweifel aus dem eBay-Titel (PlattformImport_2026 → PIMP_Title).
- Die Web-App zeigt nur Produkte mit gefüllter Produkt-ID.

## Weitere Regeln

- Skripte sprechen Felder über Feld-IDs an, nicht über Namen (Umbenennen bricht sonst nichts).
- Automation „PIMP-Verarbeitung 15 Min“ läuft produktiv – Felder, die sie nutzt, nicht umbenennen.
