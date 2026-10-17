// Tsumiki V1.2 – zentrale Parameter (werden in Excel im Blatt "Parameter" gepflegt)
// Jede Zahl, die eine Geschäftsentscheidung ist, steht hier – nicht im Code.

export const DEFAULT_PARAMS = [
  // Marke & Firma
  ['marke_name', 'Tsumiki', '', 'Markenname auf Website, Mails und Rechnungen'],
  ['firma_inhaber', 'Bastian Karlshaus', '', 'Unternehmer (Einzelunternehmen)'],
  ['firma_strasse', '[Straße Hausnummer]', '', 'Anschrift für Impressum und Rechnung'],
  ['firma_plz_ort', '[PLZ] Wuppertal', '', ''],
  ['firma_email', 'info@tsumiki.de', '', 'Kontakt-E-Mail'],
  ['firma_ustid', '[USt-IdNr. folgt]', '', 'USt-IdNr. oder Steuernummer für Rechnungen'],
  ['firma_iban', 'DE00 0000 0000 0000 0000 00', '', 'Bankverbindung für Überweisung (Platzhalter)'],

  // Wechselkurs & Einkauf
  ['kurs_jpy_je_eur_fallback', 185, 'JPY/EUR', 'Fallback-Kurs, falls der Tageskurs nicht abrufbar ist'],
  ['kurs_puffer', 0.02, '%', 'Sicherheitsabschlag auf den Tageskurs (Wise-Gebühr + Schwankung bis zum Kauf)'],
  ['sendico_gebuehr_jpy', 500, 'JPY', 'Sendico-Servicegebühr je Kauf'],
  ['sendico_aufschlag_marktplatz_jpy', 300, 'JPY', 'Zusatz bei Mercari und Yahoo Auctions (seit 01.08.2026)'],
  ['inlandsversand_japan_schaetzung_jpy', 750, 'JPY', 'Schätzung Inlandsversand bei Shops, die ihn meist extra berechnen (Yahoo, Suruga-ya, Amazon, Rakuten)'],

  // Sammelsendung (Kalkulation; Ist-Werte kommen pro Sendung)
  ['fracht_eur_je_kg', 10, 'EUR/kg', 'Kurier-Economy Japan → DE (Schätzung aus Tarifen)'],
  ['sendung_fixkosten_eur', 45, 'EUR', 'Grundpreis Fracht + Verzollungsgebühr je Sammelsendung (RD-Ist: 15–89 € Gebühren)'],
  ['sendung_erwartete_positionen', 30, 'Stück', 'Auf so viele Positionen werden die Fixkosten verteilt'],
  ['zoll_satz_karten', 0.027, '%', 'Zollsatz für die Kalkulation (Spielkarten 9504 40 00); andere Waren laut Zollbescheid prüfen'],
  ['mindestmenge_sendung', 10, 'Aufträge', 'Interne Richtgröße: ab hier lohnt sich eine Kiste (wird Kunden nicht angezeigt)'],
  ['stichtag_tag', 20, 'Tag', 'Bis zu diesem Tag muss die Ware im Lager bei Sendico sein, dann wird gepackt'],
  ['tage_japan_inland', 5, 'Tage', 'Versand vom Verkäufer zu Sendico; Bestellschluss = Stichtag minus diese Tage'],
  ['tage_packen_min', 2, 'Tage', 'Sendico packt die Kiste (min)'],
  ['tage_packen_max', 3, 'Tage', 'Sendico packt die Kiste (max)'],
  ['tage_fracht_min', 5, 'Tage', 'Kiste Japan → Wuppertal inkl. Zoll (min)'],
  ['tage_fracht_max', 7, 'Tage', 'Kiste Japan → Wuppertal inkl. Zoll (max)'],
  ['tage_umpacken', 2, 'Tage', 'Auspacken, prüfen, Pakete an Kunden aufgeben'],
  ['tage_zustellung_min', 3, 'Tage', 'Zustellung zum Kunden (min)'],
  ['tage_zustellung_max', 5, 'Tage', 'Zustellung zum Kunden (max)'],

  // Gewichte je Artikelart (inkl. Schutzverpackung)
  ['gewicht_einzelkarte_kg', 0.04, 'kg', 'Sehr klein und flach (Karte, Sticker, Anstecker)'],
  ['gewicht_slab_kg', 0.13, 'kg', 'Karte im Case (gegradet, PSA/BGS/CGC)'],
  ['gewicht_booster_kg', 0.1, 'kg', 'Klein (Booster, Spielmodul, Schlüsselanhänger)'],
  ['gewicht_display_kg', 0.45, 'kg', 'Mittel (Display, Spiel mit Box, Artbook)'],
  ['gewicht_sonstiges_kg', 0.25, 'kg', 'Unbekannt / sonstiges'],

  // Preise für den Kunden
  ['gebuehr_grund_eur', 5, 'EUR', 'Servicegebühr fix je Bestellung'],
  ['gebuehr_prozent', 0.05, '%', 'Servicegebühr auf den Warenwert (1–2 Artikel)'],
  ['gebuehr_prozent_ab3', 0.045, '%', 'Mengenrabatt ab 3 Artikeln'],
  ['gebuehr_prozent_ab6', 0.04, '%', 'Mengenrabatt ab 6 Artikeln'],
  ['gebuehr_max_eur', 40, 'EUR', 'Deckel für die Servicegebühr je Bestellung'],
  ['warenwert_min_eur', 5, 'EUR', 'Mindestwert je Artikel'],
  ['warenwert_max_eur', 300, 'EUR', 'Höchstwert je Artikel (Versandrisiko!)'],
  ['versand_de_grenze_eur', 50, 'EUR', 'Bis zu diesem Warenwert günstiger Versand'],
  ['versand_de_klein_eur', 1.8, 'EUR', 'Versand DE bis Grenze (Brief mit Sendungsverfolgung)'],
  ['versand_de_paket_eur', 6.19, 'EUR', 'Versand DE über Grenze (DHL Paket, versichert)'],
  ['versand_eu_klein_eur', 6.5, 'EUR', 'Versand EU bis Grenze – ZU PRÜFEN (Warenpost International)'],
  ['versand_eu_paket_eur', 14.9, 'EUR', 'Versand EU über Grenze (Paket mit Tracking)'],
  ['verpackung_eur_je_bestellung', 0.8, 'EUR', 'Karton/Versandtasche, Polster, Klebeband, Etikett, Drucker und Toner anteilig'],

  // Steuern
  ['ust_satz_de', 0.19, '%', 'Umsatzsteuer Deutschland'],
  ['oss_aktiv', 0, '0/1', '1 = Lieferschwelle 10.000 € überschritten → USt des Ziellandes (OSS)'],

  // Kostenannahmen für Vergleich "allein bestellt"
  ['allein_kurier_grund_eur', 22, 'EUR', 'Kurier Japan → Haustür, Grundpreis kleines Paket'],
  ['allein_kurier_eur_je_kg', 9, 'EUR/kg', ''],
  ['allein_pauschalzoll_eur', 3, 'EUR', 'Pauschalzoll je Warenkategorie bis 150 € (seit 01.07.2026)'],
  ['allein_verzollungsgebuehr_eur', 15, 'EUR', 'Gebühr des Kuriers für die Verzollung (DHL Express min. 14,88 €)'],

  // Zahlungsgebühren (nur intern für Gewinnrechnung)
  ['zahlung_prozent', 0.0249, '%', 'Zahlungsgebühr variabel (PayPal/Stripe, Schätzung)'],
  ['zahlung_fix_eur', 0.35, 'EUR', 'Zahlungsgebühr fix je Zahlung'],
];

// USt-Normalsätze EU (für OSS). Stand Okt 2026 – vor Aktivierung prüfen.
export const EU_COUNTRIES = {
  DE: ['Deutschland', 0.19], AT: ['Österreich', 0.20], BE: ['Belgien', 0.21], BG: ['Bulgarien', 0.20],
  CY: ['Zypern', 0.19], CZ: ['Tschechien', 0.21], DK: ['Dänemark', 0.25], EE: ['Estland', 0.24],
  ES: ['Spanien', 0.21], FI: ['Finnland', 0.255], FR: ['Frankreich', 0.20], GR: ['Griechenland', 0.24],
  HR: ['Kroatien', 0.25], HU: ['Ungarn', 0.27], IE: ['Irland', 0.23], IT: ['Italien', 0.22],
  LT: ['Litauen', 0.21], LU: ['Luxemburg', 0.17], LV: ['Lettland', 0.21], MT: ['Malta', 0.18],
  NL: ['Niederlande', 0.21], PL: ['Polen', 0.23], PT: ['Portugal', 0.23], RO: ['Rumänien', 0.21],
  SE: ['Schweden', 0.25], SI: ['Slowenien', 0.22], SK: ['Slowakei', 0.23],
};

// Größenklassen (bestimmen das Gewicht und damit den Frachtanteil). Schlüssel bleiben für alte Daten gleich.
export const ITEM_TYPES = {
  einzelkarte: { label: 'Sehr klein (Karte)', weightKey: 'gewicht_einzelkarte_kg' },
  slab: { label: 'Karte im Case', weightKey: 'gewicht_slab_kg' },
  booster: { label: 'Klein (Booster, Modul)', weightKey: 'gewicht_booster_kg' },
  display: { label: 'Mittel (Display, Spiel)', weightKey: 'gewicht_display_kg' },
  sonstiges: { label: 'Weiß nicht', weightKey: 'gewicht_sonstiges_kg' },
};

// domesticExtra: Shop berechnet den Versand innerhalb Japans meist extra → Schätzung wird eingerechnet
export const PLATFORMS = [
  { id: 'mercari', label: 'Mercari', hosts: ['jp.mercari.com', 'mercari.com', 'mercari-shops.com'], surcharge: true, domesticExtra: false },
  { id: 'yahoo', label: 'Yahoo! Auctions', hosts: ['auctions.yahoo.co.jp', 'page.auctions.yahoo.co.jp'], surcharge: true, domesticExtra: true },
  { id: 'paypayfleamarket', label: 'Yahoo! Flohmarkt', hosts: ['paypayfleamarket.yahoo.co.jp'], surcharge: true, domesticExtra: false },
  { id: 'rakuma', label: 'Rakuma', hosts: ['fril.jp', 'item.fril.jp'], surcharge: false, domesticExtra: false },
  { id: 'surugaya', label: 'Suruga-ya', hosts: ['suruga-ya.jp', 'www.suruga-ya.jp'], surcharge: false, domesticExtra: true },
  { id: 'amazon', label: 'Amazon Japan', hosts: ['amazon.co.jp', 'www.amazon.co.jp'], surcharge: false, domesticExtra: true },
  { id: 'rakuten', label: 'Rakuten', hosts: ['rakuten.co.jp', 'item.rakuten.co.jp'], surcharge: false, domesticExtra: true },
  { id: 'sendico', label: 'Sendico', hosts: ['sendico.com', 'www.sendico.com'], surcharge: false, domesticExtra: true },
];

export function paramsToObject(rows) {
  const o = {};
  for (const r of rows) o[r[0]] = r[1];
  return o;
}

export function defaultParams() {
  return paramsToObject(DEFAULT_PARAMS);
}
