// Tsumiki V1.0 – Datenmodell. Jede Tabelle = ein Excel-Blatt (später eine Airtable-Tabelle).
// Spaltennamen mit Präfix wie bei Replay Dealers (z. B. BE_ = Bestellung).

export const TABLES = {
  Bestellungen: { key: 'orders', cols: [
    ['BE_Nr', 'id'], ['BE_Token', 'token'], ['BE_Datum', 'createdAt'], ['BE_Status', 'status'],
    ['BE_Name', 'name'], ['BE_Email', 'email'], ['BE_Strasse', 'street'], ['BE_PLZ', 'zip'], ['BE_Ort', 'city'], ['BE_Land', 'country'],
    ['BE_Zahlart', 'paymentMethod'], ['BE_Zahlstatus', 'paymentStatus'], ['BE_Zahlungsref', 'paymentRef'],
    ['BE_Betrag_reserviert', 'authorizedGross'], ['BE_Betrag_abgebucht', 'capturedGross'],
    ['BE_Warenwert', 'goodsTotal'], ['BE_Importkosten_kalk', 'importCost'], ['BE_Servicegebuehr', 'serviceFee'], ['BE_Versand', 'shipping'],
    ['BE_Netto', 'net'], ['BE_USt_Satz', 'vatRate'], ['BE_USt', 'vat'], ['BE_Brutto', 'gross'], ['BE_Vergleich_allein', 'solo'],
    ['BE_Kurs_JPY', 'fxRate'], ['BE_Sendung', 'shipmentId'], ['BE_Rechnung', 'invoiceId'], ['BE_Versanddatum', 'shippedAt'],
    ['BE_Tracking', 'trackingNo'], ['BE_Notiz', 'notes'],
  ] },
  Positionen: { key: 'positions', cols: [
    ['POS_Nr', 'id'], ['POS_Bestellung', 'orderId'], ['POS_Status', 'status'], ['POS_Link', 'url'], ['POS_Plattform', 'platform'],
    ['POS_Titel', 'title'], ['POS_Art', 'type'], ['POS_Menge', 'qty'], ['POS_Preis_JPY', 'priceJPY'], ['POS_Inland_JPY', 'domesticJPY'],
    ['POS_Sendico_JPY', 'sendicoJPY'], ['POS_Gewicht_kg', 'weightKg'], ['POS_Ware_EUR_kalk', 'goodsEUR'], ['POS_Import_EUR_kalk', 'importCostEUR'],
    ['POS_Zoll_EUR_kalk', 'dutyEUR'], ['POS_Fracht_EUR_kalk', 'freightEUR'], ['POS_Netto_EUR', 'netPriceEUR'], ['POS_Brutto_EUR', 'grossPriceEUR'],
    ['POS_Sendico_Nr', 'sendicoNo'], ['POS_Kaufdatum', 'purchasedAt'], ['POS_Ist_Preis_JPY', 'actualPriceJPY'], ['POS_Ist_Kurs', 'actualRate'],
    ['POS_Ist_Ware_EUR', 'actualGoodsEUR'], ['POS_Ist_Sendico_EUR', 'actualSendicoEUR'], ['POS_Ist_Logistik_EUR', 'actualLogisticsEUR'],
    ['POS_Sendung', 'shipmentId'], ['POS_Geprueft', 'checked'],
  ] },
  Sammelsendungen: { key: 'shipments', cols: [
    ['SE_Nr', 'id'], ['SE_Status', 'status'], ['SE_Erstellt', 'createdAt'], ['SE_Kurier', 'carrier'], ['SE_Tracking', 'trackingNo'],
    ['SE_Gewicht_kg', 'weightKg'], ['SE_Fracht_JPY', 'freightJPY'], ['SE_Fracht_EUR', 'freightEUR'], ['SE_Zoll_EUR', 'dutyEUR'],
    ['SE_EUSt_EUR', 'eustEUR'], ['SE_Verzollung_EUR', 'clearanceEUR'], ['SE_Sonstiges_EUR', 'otherEUR'],
    ['SE_Positionen', 'positionsCount'], ['SE_Auftraege', 'ordersCount'], ['SE_Warenwert_EUR', 'goodsEUR'],
    ['SE_Logistik_kalk_EUR', 'kalkLogisticsEUR'], ['SE_Logistik_ist_EUR', 'istLogisticsEUR'], ['SE_Abweichung_EUR', 'deltaEUR'],
    ['SE_Versendet', 'sentAt'], ['SE_Angekommen', 'arrivedAt'],
  ] },
  Rechnungen: { key: 'invoices', cols: [
    ['RE_Nr', 'id'], ['RE_Datum', 'date'], ['RE_Leistungsdatum', 'serviceDate'], ['RE_Bestellung', 'orderId'], ['RE_Typ', 'kind'], ['RE_Bezug', 'refInvoice'],
    ['RE_Kunde', 'customer'], ['RE_Land', 'country'], ['RE_Netto', 'net'], ['RE_USt_Satz', 'vatRate'], ['RE_USt', 'vat'], ['RE_Brutto', 'gross'],
    ['RE_Positionen', 'linesJson'],
  ] },
  Journal: { key: 'journal', cols: [
    ['BU_Nr', 'id'], ['BU_Datum', 'date'], ['BU_Beleg', 'beleg'], ['BU_Text', 'text'], ['BU_Soll', 'soll'], ['BU_Haben', 'haben'],
    ['BU_Betrag', 'amount'], ['BU_Steuer', 'taxKey'], ['BU_Steuerbetrag', 'taxAmount'], ['BU_Bezug', 'ref'],
  ] },
  Postausgang: { key: 'outbox', cols: [
    ['PA_Nr', 'id'], ['PA_Datum', 'date'], ['PA_An', 'to'], ['PA_Betreff', 'subject'], ['PA_Bestellung', 'orderId'], ['PA_Text', 'html'],
  ] },
  Protokoll: { key: 'log', cols: [
    ['LOG_Datum', 'date'], ['LOG_Aktion', 'action'], ['LOG_Bezug', 'ref'], ['LOG_Details', 'details'],
  ] },
};

export const NUMERIC_FIELDS = new Set(['authorizedGross', 'capturedGross', 'goodsTotal', 'importCost', 'serviceFee', 'shipping', 'net', 'vatRate', 'vat', 'gross', 'solo', 'fxRate',
  'qty', 'priceJPY', 'domesticJPY', 'sendicoJPY', 'weightKg', 'goodsEUR', 'importCostEUR', 'dutyEUR', 'freightEUR', 'netPriceEUR', 'grossPriceEUR',
  'actualPriceJPY', 'actualRate', 'actualGoodsEUR', 'actualSendicoEUR', 'actualLogisticsEUR', 'freightJPY', 'eustEUR', 'clearanceEUR', 'otherEUR',
  'positionsCount', 'ordersCount', 'kalkLogisticsEUR', 'istLogisticsEUR', 'deltaEUR', 'amount', 'taxAmount']);

export function emptyDb(params) {
  const db = { params: { ...params } };
  for (const t of Object.values(TABLES)) db[t.key] = [];
  return db;
}

export const ORDER_STATUS = {
  zahlung_offen: 'Zahlung offen',
  neu: 'Neu – bitte kaufen',
  gekauft: 'Gekauft in Japan',
  storniert: 'Storniert (nicht verfügbar)',
  unterwegs: 'Unterwegs nach Deutschland',
  angekommen: 'In Deutschland – wird gepackt',
  versendet: 'Versendet',
  retoure: 'Widerruf / Retoure',
};

export const POS_STATUS = {
  angefragt: 'Wartet auf Kauf',
  gekauft: 'Gekauft – im Lager Japan',
  nicht_verfuegbar: 'Nicht verfügbar',
  unterwegs: 'In Sammelsendung',
  angekommen: 'Angekommen',
  versendet: 'Versendet',
  retoure: 'Retoure',
};
