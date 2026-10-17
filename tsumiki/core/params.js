// Tsumiki V1.0 – zentrale Parameter (werden in Excel im Blatt "Parameter" gepflegt)
// Jede Zahl, die eine Geschäftsentscheidung ist, steht hier – nicht im Code.

export const DEFAULT_PARAMS = [
  // Marke & Firma
  ['marke_name', 'Tsumiki', '', 'Markenname auf Website, Mails und Rechnungen'],
  ['firma_inhaber', 'Bastian Karlshaus', '', 'Unternehmer (Einzelunternehmen)'],
  ['firma_strasse', '[Straße Hausnummer]', '', 'Anschrift für Impressum und Rechnung'],
  ['firma_plz_ort', '[PLZ] Wuppertal', '', ''],
  ['firma_email', 'hallo@[domain].de', '', 'Kontakt-E-Mail'],
  ['firma_ustid', '[USt-IdNr. folgt]', '', 'USt-IdNr. oder Steuernummer für Rechnungen'],
  ['firma_iban', 'DE00 0000 0000 0000 0000 00', '', 'Bankverbindung für Überweisung (Platzhalter)'],

  // Wechselkurs & Einkauf
  ['kurs_jpy_je_eur_fallback', 185, 'JPY/EUR', 'Fallback-Kurs, falls der Tageskurs nicht abrufbar ist'],
  ['kurs_puffer', 0.02, '%', 'Sicherheitsabschlag auf den Tageskurs (Wise-Gebühr + Schwankung bis zum Kauf)'],
  ['sendico_gebuehr_jpy', 500, 'JPY', 'Sendico-Servicegebühr je Kauf'],
  ['sendico_aufschlag_marktplatz_jpy', 300, 'JPY', 'Zusatz bei Mercari und Yahoo Auctions (seit 01.08.2026)'],
  ['inlandsversand_japan_schaetzung_jpy', 750, 'JPY', 'Schätzung, wenn der Inlandsversand nicht im Preis enthalten ist'],

  // Sammelsendung (Kalkulation; Ist-Werte kommen pro Sendung)
  ['fracht_eur_je_kg', 10, 'EUR/kg', 'Kurier-Economy Japan → DE (Schätzung aus Tarifen)'],
  ['sendung_fixkosten_eur', 45, 'EUR', 'Grundpreis Fracht + Verzollungsgebühr je Sammelsendung (RD-Ist: 15–89 € Gebühren)'],
  ['sendung_erwartete_positionen', 30, 'Stück', 'Auf so viele Positionen werden die Fixkosten verteilt'],
  ['zoll_satz_karten', 0.027, '%', 'Zollsatz 9504 40 00 (Spielkarten), ohne Ursprungsnachweis'],
  ['mindestmenge_sendung', 10, 'Aufträge', 'Sammelsendung geht ab dieser Anzahl Aufträge raus'],
  ['stichtag_tag', 20, 'Tag', 'Monatlicher Stichtag für die Sammelsendung'],
  ['laufzeit_tage_min', 10, 'Tage', 'Lieferzeit ab Stichtag bis zum Kunden (min)'],
  ['laufzeit_tage_max', 16, 'Tage', 'Lieferzeit ab Stichtag bis zum Kunden (max)'],

  // Gewichte je Artikelart (inkl. Schutzverpackung)
  ['gewicht_einzelkarte_kg', 0.04, 'kg', ''],
  ['gewicht_slab_kg', 0.13, 'kg', 'Gegradete Karte (PSA/BGS/CGC)'],
  ['gewicht_booster_kg', 0.05, 'kg', 'Booster / einzelne Packs'],
  ['gewicht_display_kg', 0.45, 'kg', 'Display / Box (versiegelt)'],
  ['gewicht_sonstiges_kg', 0.25, 'kg', 'Deck, Promo-Set, Zubehör'],

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

export const ITEM_TYPES = {
  einzelkarte: { label: 'Einzelkarte', weightKey: 'gewicht_einzelkarte_kg' },
  slab: { label: 'Gegradete Karte (PSA, BGS, CGC)', weightKey: 'gewicht_slab_kg' },
  booster: { label: 'Booster / Packs', weightKey: 'gewicht_booster_kg' },
  display: { label: 'Display / Box (versiegelt)', weightKey: 'gewicht_display_kg' },
  sonstiges: { label: 'Deck, Promo-Set, Zubehör', weightKey: 'gewicht_sonstiges_kg' },
};

export const PLATFORMS = [
  { id: 'mercari', label: 'Mercari', hosts: ['jp.mercari.com', 'mercari.com', 'mercari-shops.com'], surcharge: true },
  { id: 'yahoo', label: 'Yahoo! Auctions', hosts: ['auctions.yahoo.co.jp', 'page.auctions.yahoo.co.jp'], surcharge: true },
  { id: 'paypayfleamarket', label: 'Yahoo! Flohmarkt', hosts: ['paypayfleamarket.yahoo.co.jp'], surcharge: true },
  { id: 'rakuma', label: 'Rakuma', hosts: ['fril.jp', 'item.fril.jp'], surcharge: false },
  { id: 'surugaya', label: 'Suruga-ya', hosts: ['suruga-ya.jp', 'www.suruga-ya.jp'], surcharge: false },
  { id: 'amazon', label: 'Amazon Japan', hosts: ['amazon.co.jp', 'www.amazon.co.jp'], surcharge: false },
  { id: 'rakuten', label: 'Rakuten', hosts: ['rakuten.co.jp', 'item.rakuten.co.jp'], surcharge: false },
  { id: 'sendico', label: 'Sendico', hosts: ['sendico.com', 'www.sendico.com'], surcharge: false },
];

export function paramsToObject(rows) {
  const o = {};
  for (const r of rows) o[r[0]] = r[1];
  return o;
}

export function defaultParams() {
  return paramsToObject(DEFAULT_PARAMS);
}
