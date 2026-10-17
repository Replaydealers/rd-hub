// Tsumiki V1.2 – Rechenkern
// Läuft identisch im Browser (Live-Preis auf der Website) und auf dem Server (verbindlicher Preis).
import { EU_COUNTRIES, ITEM_TYPES, PLATFORMS } from './params.js';

export const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const num = (x, d = 0) => (x === '' || x === null || x === undefined || isNaN(Number(x)) ? d : Number(x));

export function detectPlatform(url) {
  try {
    const u = new URL(String(url).trim());
    const host = u.hostname.toLowerCase();
    for (const p of PLATFORMS) {
      if (p.hosts.some((h) => host === h || host.endsWith('.' + h))) return p;
    }
  } catch (e) { /* ungültige URL */ }
  return null;
}

export function effectiveRate(params, fxRate) {
  const rate = num(fxRate, num(params.kurs_jpy_je_eur_fallback, 185));
  return rate * (1 - num(params.kurs_puffer, 0.02)); // weniger Yen je Euro = vorsichtig
}

export function vatRateFor(country, params) {
  const de = num(params.ust_satz_de, 0.19);
  if (!country || country === 'DE') return de;
  if (num(params.oss_aktiv, 0) === 1 && EU_COUNTRIES[country]) return EU_COUNTRIES[country][1];
  return de; // unter der Lieferschwelle gilt deutsche USt
}

export function serviceFee(goodsTotal, itemCount, params) {
  let pct = num(params.gebuehr_prozent, 0.05);
  if (itemCount >= 6) pct = num(params.gebuehr_prozent_ab6, pct);
  else if (itemCount >= 3) pct = num(params.gebuehr_prozent_ab3, pct);
  const fee = num(params.gebuehr_grund_eur, 5) + pct * goodsTotal;
  return { fee: r2(Math.min(fee, num(params.gebuehr_max_eur, 40))), pct };
}

// Versand zu Kunden inkl. Verpackungsmaterial
export function customerShipping(goodsTotal, country, params) {
  const small = goodsTotal <= num(params.versand_de_grenze_eur, 50);
  const pack = num(params.verpackung_eur_je_bestellung, 0.8);
  if (!country || country === 'DE') {
    return { cost: r2((small ? num(params.versand_de_klein_eur, 1.8) : num(params.versand_de_paket_eur, 6.19)) + pack), method: small ? 'Brief mit Sendungsverfolgung' : 'DHL Paket, versichert' };
  }
  return { cost: r2((small ? num(params.versand_eu_klein_eur, 6.5) : num(params.versand_eu_paket_eur, 14.9)) + pack), method: small ? 'Warenpost International' : 'Paket International mit Tracking' };
}

// Ein Artikel: alles in EUR netto (ohne USt)
export function priceItem(item, params, fxRate) {
  const rate = effectiveRate(params, fxRate);
  const platform = item.platform ? PLATFORMS.find((p) => p.id === item.platform) : detectPlatform(item.url);
  const qty = Math.max(1, Math.round(num(item.qty, 1)));
  const priceJPY = num(item.priceJPY);
  // Inlandsversand: ausdrücklich angegeben (alte Bestellungen, Neuberechnung) oder nach Shop geschätzt
  const explicit = item.domesticIncluded === true || item.domesticIncluded === false || item.domesticIncluded === 'ja' || item.domesticIncluded === 'nein';
  const extra = explicit ? (item.domesticIncluded === false || item.domesticIncluded === 'nein') : !!(platform && platform.domesticExtra);
  const domesticJPY = extra ? num(item.domesticJPY, num(params.inlandsversand_japan_schaetzung_jpy, 750)) : 0;
  const sendicoJPY = num(params.sendico_gebuehr_jpy, 500) + (platform && platform.surcharge ? num(params.sendico_aufschlag_marktplatz_jpy, 300) : 0);
  const type = ITEM_TYPES[item.type] ? item.type : 'einzelkarte';
  const weightKg = num(params[ITEM_TYPES[type].weightKey], 0.05) * qty;

  const goodsEUR = r2((priceJPY * qty) / rate);
  const domesticEUR = r2(domesticJPY / rate);
  const sendicoEUR = r2(sendicoJPY / rate);
  const freightEUR = r2(weightKg * num(params.fracht_eur_je_kg, 10));
  const fixedShareEUR = r2(num(params.sendung_fixkosten_eur, 45) / Math.max(1, num(params.sendung_erwartete_positionen, 30)));
  // Zollwert = Ware + Inlandsversand + Fracht bis EU-Grenze
  const dutyEUR = r2((goodsEUR + domesticEUR + freightEUR) * num(params.zoll_satz_karten, 0.027));
  const importCostEUR = r2(domesticEUR + sendicoEUR + freightEUR + fixedShareEUR + dutyEUR);
  return {
    platform: platform ? platform.id : 'unbekannt',
    platformLabel: platform ? platform.label : 'Unbekannt',
    type, typeLabel: ITEM_TYPES[type].label, qty, weightKg: r2(weightKg),
    priceJPY, domesticJPY, sendicoJPY, rate: r2(rate),
    goodsEUR, domesticEUR, sendicoEUR, freightEUR, fixedShareEUR, dutyEUR, importCostEUR,
    netCostEUR: r2(goodsEUR + importCostEUR),
  };
}

// Was würde der Kunde zahlen, wenn er dieselben Artikel allein über einen Proxy bestellt?
export function soloEstimate(lines, country, params) {
  const goods = lines.reduce((s, l) => s + l.goodsEUR + l.domesticEUR, 0);
  const sendico = lines.reduce((s, l) => s + l.sendicoEUR, 0);
  const kg = lines.reduce((s, l) => s + l.weightKg, 0);
  const courier = num(params.allein_kurier_grund_eur, 22) + Math.max(0.5, kg) * num(params.allein_kurier_eur_je_kg, 9);
  const customsValue = goods + courier;
  const duty = customsValue <= 150 ? num(params.allein_pauschalzoll_eur, 3) : customsValue * num(params.zoll_satz_karten, 0.027);
  const vat = (customsValue + duty) * vatRateFor(country, params);
  const fee = Math.max(num(params.allein_verzollungsgebuehr_eur, 15), 0.02 * customsValue);
  return r2(goods + sendico + courier + duty + vat + fee);
}

/**
 * Angebot für einen Warenkorb.
 * items: [{url, priceJPY, qty, type, domesticIncluded, domesticJPY, title}]
 * Ergebnis: Positionen mit Nettopreis + Bestellsummen (Kundensicht in zwei Zeilen + Details).
 */
export function quote(items, country, params, fxRate) {
  const lines = (items || []).map((it) => priceItem(it, params, fxRate));
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const goodsTotal = r2(lines.reduce((s, l) => s + l.goodsEUR, 0));
  const importCost = r2(lines.reduce((s, l) => s + l.importCostEUR, 0));
  const { fee, pct } = serviceFee(goodsTotal, count, params);
  const ship = customerShipping(goodsTotal, country, params);
  const vatRate = vatRateFor(country, params);
  const net = r2(goodsTotal + importCost + fee + ship.cost);
  const gross = r2(net * (1 + vatRate));
  const vat = r2(gross - net);

  // Positionspreise (netto), damit Teil-Stornos sauber gerechnet werden können:
  // Gebühr und Versand werden nach Warenwert auf die Positionen verteilt.
  const orderLevel = fee + ship.cost;
  let assigned = 0;
  lines.forEach((l, i) => {
    const share = goodsTotal > 0 ? l.goodsEUR / goodsTotal : 1 / lines.length;
    l.orderShareEUR = i === lines.length - 1 ? r2(orderLevel - assigned) : r2(orderLevel * share);
    assigned = r2(assigned + l.orderShareEUR);
    l.netPriceEUR = r2(l.netCostEUR + l.orderShareEUR);
    l.grossPriceEUR = r2(l.netPriceEUR * (1 + vatRate));
  });

  const solo = soloEstimate(lines, country, params);
  const payFee = r2(gross * num(params.zahlung_prozent, 0.0249) + num(params.zahlung_fix_eur, 0.35));
  const minV = num(params.warenwert_min_eur, 5);
  const maxV = num(params.warenwert_max_eur, 300);
  const problems = [];
  lines.forEach((l, i) => {
    if (l.platform === 'unbekannt') problems.push({ index: i, text: 'Diesen Shop können wir nicht erkennen. Erlaubt sind Mercari, Yahoo, Rakuma, Suruga-ya, Amazon/Rakuten Japan und Sendico-Links.' });
    if (l.goodsEUR / l.qty < minV) problems.push({ index: i, text: `Mindestwert je Artikel: ${minV} €.` });
    if (l.goodsEUR / l.qty > maxV) problems.push({ index: i, text: `Höchstwert je Artikel: ${maxV} €. Für teurere Stücke schreib uns.` });
  });

  return {
    lines,
    summary: {
      count, goodsTotal, importCost, serviceFee: fee, serviceFeePct: pct, shipping: r2(ship.cost), shippingMethod: ship.method,
      net, vatRate, vat, gross,
      // Kundensicht: zwei Zeilen
      displayGoods: goodsTotal,
      displayImportService: r2(gross - goodsTotal),
      solo, savings: r2(solo - gross),
      paymentFeeEstimate: payFee,
      expectedProfit: r2(fee - payFee),
    },
    problems,
  };
}

// Nächste Kiste: Bestellschluss, Stichtag im Lager und Zeitplan bis zum Kunden
export function nextCutoff(params, now = new Date()) {
  const day = num(params.stichtag_tag, 20);
  const lead = num(params.tage_japan_inland, 5);
  const plus = (base, days) => { const x = new Date(base); x.setDate(x.getDate() + days); return x; };
  let stock = new Date(now.getFullYear(), now.getMonth(), day, 23, 59);
  if (plus(stock, -lead) < now) stock = new Date(now.getFullYear(), now.getMonth() + 1, day, 23, 59);
  const order = plus(stock, -lead);
  const packMin = num(params.tage_packen_min, 2), packMax = num(params.tage_packen_max, 3);
  const flyMin = num(params.tage_fracht_min, 5), flyMax = num(params.tage_fracht_max, 7);
  const repack = num(params.tage_umpacken, 2);
  const delMin = num(params.tage_zustellung_min, 3), delMax = num(params.tage_zustellung_max, 5);
  const iso = (x) => x.toISOString();
  const phases = [
    { key: 'bestellschluss', label: 'Bestellschluss', text: 'Letzter Tag zum Bestellen', from: iso(order), to: iso(order) },
    { key: 'lager', label: 'Im Lager in Japan', text: 'Alle Artikel sind bei unserem Einkaufsdienst', from: iso(stock), to: iso(stock) },
    { key: 'abflug', label: 'Die Kiste fliegt los', text: 'Gepackt und auf dem Weg nach Deutschland', from: iso(plus(stock, packMin)), to: iso(plus(stock, packMax)) },
    { key: 'wuppertal', label: 'Ankunft in Wuppertal', text: 'Verzollt, geprüft, für dich gepackt', from: iso(plus(stock, packMin + flyMin)), to: iso(plus(stock, packMax + flyMax)) },
    { key: 'kunde', label: 'Bei dir', text: 'Paket mit Sendungsnummer', from: iso(plus(stock, packMin + flyMin + repack + delMin)), to: iso(plus(stock, packMax + flyMax + repack + delMax)) },
  ];
  const daysLeft = Math.max(0, Math.ceil((order - now) / 86400000));
  return { cutoff: iso(order), stockCutoff: iso(stock), deliveryFrom: phases[4].from, deliveryTo: phases[4].to, daysLeft, phases };
}

export const fmtEUR = (x) => (Number(x) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
export const fmtJPY = (x) => '¥' + (Number(x) || 0).toLocaleString('de-DE');
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }) : '');
