/**
 * Produkt-Zuordnung V1.0 – Replay Dealers
 * ─────────────────────────────────────────────────────────────
 * Ausführen in Airtable: Erweiterungen → „Scripting“ → Skript einfügen → Run.
 * (NICHT als Automation – braucht Buttons.)
 *
 * Zweck: Artikel_2026 → Produkt verknüpfen (Feld „ITEM_SetID“, Feld-ID unten).
 *   Erst dann zählen Prod_Bestand / PROD_Verkauft_Anzahl / Ø EK / Ø VK richtig und
 *   die Einkaufsliste (PROD_Nachkaufen) funktioniert.
 *
 * Ablauf:
 *   1. Vorschau (schreibt NICHTS): welche Artikel zu welchem Produkt kommen,
 *      welche Produkte neu angelegt würden, was nicht zugeordnet werden konnte.
 *   2. Erst nach Klick auf „Zuordnen“:
 *        - fehlende Produkte anlegen (nur PROD_Klarname + PROD_Kategorie)
 *        - leere ITEM_SetID-Felder füllen
 *   Bereits verknüpfte Artikel werden NIE geändert. Gelöscht wird NICHTS.
 *   Idempotent: mehrfaches Ausführen ordnet nur noch neu hinzugekommene Artikel zu.
 *
 * Neue Produkte: einfach unten in REGELN eintragen (spezielle Regeln VOR allgemeine).
 *   produkt  = PROD_Klarname (existiert es nicht, wird es angelegt)
 *   kat      = PROD_Kategorie für neu angelegte Produkte
 *   konsole  = Regex auf ITEM_Konsole (leer = egal)
 *   komp     = Regex auf ITEM_Komponente (leer = egal)
 *   titel    = Regex auf ITEM_Artikel
 *   ohne     = Regex – wenn der Titel passt, greift die Regel NICHT
 * Pokémon-Karten werden automatisch über die Produkt-ID (z.B. „sv10 126“) zugeordnet.
 */

// Tabellen und Felder über IDs → unempfindlich gegen Umbenennen
const T_ARTIKEL = 'tbljlEbKb1ejMeuNp';
const T_PRODUKT = 'tblvfeGsh2wXVU7Xe';
const A = {
    nummer:  'fld4HikOtm9oSkdbK',   // ITEM_Artikelnummer
    konsole: 'fld72gw7eBOgYsDHo',   // ITEM_Konsole
    komp:    'fldZ2QNJXkykW5k3b',   // ITEM_Komponente
    titel:   'fldtn30Ibl29PoFR4',   // ITEM_Artikel
    status:  'fldgdO1gkh112G5Ab',   // ITEM_Status
    produkt: 'fldo9JagV8eBqNm2j'    // ITEM_SetID (→ Produkt)
};
const P = {
    klarname:  'fldsKCgonc3xvQ5yf', // PROD_Klarname
    produktId: 'fldrh1JSFD5ti6VBF', // PROD_ProduktID (Formel aus Kennung A/B)
    kategorie: 'fldRnxxwc8NHOj3Ee'  // PROD_Kategorie
};
const STATUS_RELEVANT = ['auf Lager', 'verkauft'];
const BATCH = 50;

const R = (produkt, kat, konsole, komp, titel, ohne) => ({ produkt, kat, konsole, komp, titel, ohne });
const KON = 'Konsole/Set', ZUB = 'Zubehör', SPIEL = 'Spiel';
const SFC = /super famicom|snes/;      // Hardware: SNES und SFC gleich
const SFC_JP = /super famicom/;         // Spiele „(Super Famicom)“: nur japanische Module

const REGELN = [
    // ── Switch / Pokémon-Zubehör ──
    R('Pokéball Plus mit Mew',            ZUB, /switch|sonstige/, null, /pok[eé] ?ball.*mew/),
    R('Pokéball Plus + Lets Go Pikachu',  ZUB, /switch/, null, /let'?s ?go/),
    R('Pokéball Plus',                    ZUB, /switch/, null, /pok[eé] ?ball/, /tasche|schüttler|friends/),
    R('Pokémon Go Plus+',                 ZUB, null, null, /go plus/),
    R('Pokémon Tamagotchi',               ZUB, null, null, /pok[eé]mon tamagotchi/),
    // ── PS Vita ──
    R('Sony Vita Memory Card 32 GB',      ZUB, /vita/, null, /memory.*\b32 ?gb/),
    R('PS Vita Memory Card 64 GB',        ZUB, /vita/, null, /memory.*\b64 ?gb/),
    R('PS Vita Memory Card 16 GB',        ZUB, /vita/, null, /memory.*\b16 ?gb/),
    R('PS Vita Memory Card 8 GB',         ZUB, /vita/, null, /memory.*\b8 ?gb/),
    R('PS Vita Memory Card 4 GB',         ZUB, /vita/, null, /memory.*\b4 ?gb/),
    R('Sony Vita',                        KON, /vita/, /konsole/, /./),
    // ── Nintendo-Zubehör ──
    R('Expansion Pak (N64)',              ZUB, /n64/, null, /expansion/),
    R('Super Game Boy 2',                 ZUB, null, null, /super game ?boy 2/),
    R('SNES Multitap',                    ZUB, SFC, null, /multi ?tap/),
    R('AGB-005',                          ZUB, null, null, /a[gb][gb]-005/),
    R('GBA Wireless Adapater',            ZUB, /advance/, null, /wireless adapter|agb-015|bluetooth adapter/),
    R('DOL-011',                          ZUB, null, null, /dol-011/),
    R('DMG-04',                           ZUB, null, null, /dmg-04/),
    R('GBC Link-Kabel CGB-003',           ZUB, null, null, /cgb-003/),
    // ── Konsolen ──
    R('PSP 3000',                         KON, /psp/, /konsole/, /3000|psp konsole/),
    R('Game Boy Color Konsole',           KON, /gameboy color/, /konsole/, /./),
    R('GBA SP Konsole',                   KON, /advance/, /konsole/, /\bsp\b/),
    R('GBA Konsole',                      KON, /advance/, /konsole/, /./, /power shield/),
    R('Game Boy Classic Konsole',         KON, /^gameboy$/, /konsole/, /./),
    R('ipod',                             'Sonstiges', /ipod/, null, /classic/),
    // ── Controller / Sega / Neo Geo ──
    R('Dreamcast VMU',                    ZUB, /dream/, null, /vmu/),
    R('Dreamcast Arcade Stick',           ZUB, /dream/, null, /arcade stick|hkt-7300/),
    R('Dreamcast Controller',             ZUB, /dream/, /controller/, /controller/, /samba|arcade/),
    R('GameCube Controller',              ZUB, /gamecube/, /controller/, /controller/, /club nintendo/),
    R('Wii Controller',                   ZUB, /^wii$/, /controller/, /controller|pad/, /adapter|nunchuk|dritthersteller/),
    R('Neo Geo CD Controller',            ZUB, /neo/, null, /cd controller|controller pro/),
    R('Namco NPC-103 (PS1)',              ZUB, /ps1/, null, /guncon|npc-103/),
    R('PS2 Memory Card',                  ZUB, /ps2/, null, /memory card/),
    R('PS3 Memory Card Adapter',          ZUB, /ps3/, null, /memory card adapter/),
    R('Sega Dreamcast Samba de Amigo',    ZUB, /dream/, null, /samba de amigo/),
    // ── Spiele (bestehende Produkte) ──
    R('Zelda Ocarina of Time (N64)',      SPIEL, /n64/, /spiel/, /ocarina/),
    R('Mario Kart 64 Controller Bundle (N64)', SPIEL, /n64/, null, /mario kart.*(controller|bundle)/),
    R('Mario Kart 64 (N64)',              SPIEL, /n64/, /spiel/, /mario kart/),
    R('Pokemon Stadium 1 (N64)',          SPIEL, /n64/, /spiel/, /stadium/, /2|gold|silber/),
    R('Famicom Disk System Zelda Hyrule', SPIEL, /disk/, null, /zelda/),
    R('Zelda (Super Famicom)',            SPIEL, SFC_JP, /spiel/, /link to the past|^zelda$/),
    R('Chrono Trigger (Super Famicom)',   SPIEL, SFC_JP, /spiel/, /chrono trigger/),
    R('Super Mario World (Super Famicom)',SPIEL, SFC_JP, /spiel/, /super mario world$/),
    R('Super Mario Kart (Super Famicom)', SPIEL, SFC_JP, /spiel/, /super mario kart/),
    R("Dragon's Magic (Super Famicom)",   SPIEL, SFC_JP, /spiel/, /dragon'?s magic/),
    R("Ghouls 'n Ghosts (Super Famicom)", SPIEL, SFC_JP, /spiel/, /ghouls/),
    R('Super Donkey Kong 1 (Super Famicom)', SPIEL, SFC_JP, /spiel/, /super donkey kong( 1)?$/),
    R('Super Donkey Kong 2 (Super Famicom)', SPIEL, SFC_JP, /spiel/, /super donkey kong 2$/),
    R('Super Donkey Kong 3 (Super Famicom)', SPIEL, SFC_JP, /spiel/, /super donkey kong 3$/),
    R('Breath of Fire (Super Famicom)',   SPIEL, SFC_JP, /spiel/, /breath of fire( 1)?$/),
    R('Tales of Phantasia (Super Famicom)', SPIEL, SFC_JP, /spiel/, /tales of phantasia/),
    R('Sailor Moon R (Super Famicom)',    SPIEL, SFC_JP, /spiel/, /sailor moon r$/),
    R('Super Bomberman 3 (Super Famicom)', SPIEL, SFC_JP, /spiel/, /super bomberman 3/),
    R('Dungeon Master (Super Famicom)',   SPIEL, SFC_JP, /spiel/, /dungeon master/),
    R('Einhander (PS1)',                  SPIEL, /ps1/, /spiel/, /einh[aä]nder/),
    R('Ghost in the Shell (PS1)',         SPIEL, /ps1/, /spiel/, /ghost in the shell/),
    R('Story of Galaxy Express 999 (PS1)', SPIEL, /ps1/, /spiel/, /galaxy express/),
    R('Biohazard 2 (PS1)',                SPIEL, /ps1/, /spiel/, /biohazard 2/),
    R('Biohazard 3 (PS1)',                SPIEL, /ps1/, /spiel/, /biohazard 3/),
    R("Biohazard Director's Cut (PS1)",   SPIEL, /ps1/, /spiel/, /biohazard.*director/),
    R('Pokemon Silber (Gameboy Color)',   SPIEL, /gameboy color/, /spiel/, /silber/),
    R('Hatsune Miku Project DIVA (PSP)',  SPIEL, /psp/, /spiel/, /project diva$/),
];

// ── Hilfsfunktionen ──────────────────────────────────────────
const low = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
/** „SV10 126“, „sv10 126“, „M1L 067“ → „sv10 126“, „m1l 67“ (führende Nullen weg) */
const kartenKey = s => {
    const m = low(s).match(/^([a-z]+\d*[a-z]*)\s+0*(\d+)$/);
    return m ? `${m[1]} ${m[2]}` : null;
};
function passt(regel, konsole, komp, titel) {
    if (regel.konsole && !regel.konsole.test(konsole)) return false;
    if (regel.komp && !regel.komp.test(komp)) return false;
    if (!regel.titel.test(titel)) return false;
    if (regel.ohne && regel.ohne.test(titel)) return false;
    return true;
}

/** Reine Logik (ohne Airtable) – auch lokal testbar. */
function ermittleZuordnung(artikel, produkte) {
    const produktByName = new Map(produkte.map(p => [low(p.klarname), p]));
    const produktByKarte = new Map();
    for (const p of produkte) { const k = kartenKey(p.produktId); if (k) produktByKarte.set(k, p); }

    const zuordnung = [];          // { artikel, produktName, produkt|null, kat }
    const offen = [];
    for (const a of artikel) {
        if (a.hatProdukt || !STATUS_RELEVANT.includes(a.status)) continue;
        const konsole = low(a.konsole), komp = low(a.komp), titel = low(a.titel);

        if (komp === 'karte') {
            const p = produktByKarte.get(kartenKey(a.titel));
            if (p) { zuordnung.push({ artikel: a, produktName: p.klarname, produkt: p, kat: null }); continue; }
        }
        const regel = REGELN.find(r => passt(r, konsole, komp, titel));
        if (regel) {
            zuordnung.push({ artikel: a, produktName: regel.produkt, produkt: produktByName.get(low(regel.produkt)) || null, kat: regel.kat });
        } else {
            offen.push(a);
        }
    }
    return { zuordnung, offen };
}

// ── Airtable-Teil ────────────────────────────────────────────
async function main() {
    output.markdown('# 🏷️ Produkt-Zuordnung V1.0');
    const tblArtikel = base.getTable(T_ARTIKEL);
    const tblProdukt = base.getTable(T_PRODUKT);

    const qa = await tblArtikel.selectRecordsAsync({ fields: Object.values(A) });
    const qp = await tblProdukt.selectRecordsAsync({ fields: Object.values(P) });

    const artikel = qa.records.map(r => ({
        id: r.id,
        nummer: r.getCellValueAsString(A.nummer),
        konsole: r.getCellValueAsString(A.konsole),
        komp: r.getCellValueAsString(A.komp),
        titel: r.getCellValueAsString(A.titel),
        status: r.getCellValueAsString(A.status),
        hatProdukt: (r.getCellValue(A.produkt) || []).length > 0
    }));
    const produkte = qp.records.map(r => ({
        id: r.id,
        klarname: r.getCellValueAsString(P.klarname),
        produktId: r.getCellValueAsString(P.produktId)
    }));

    const { zuordnung, offen } = ermittleZuordnung(artikel, produkte);

    // Vorschau je Produkt
    const proProdukt = new Map();
    for (const z of zuordnung) {
        if (!proProdukt.has(z.produktName)) proProdukt.set(z.produktName, { neu: !z.produkt, kat: z.kat, lager: 0, verkauft: 0, beispiele: new Set() });
        const e = proProdukt.get(z.produktName);
        if (z.artikel.status === 'auf Lager') e.lager++; else e.verkauft++;
        if (e.beispiele.size < 3) e.beispiele.add(z.artikel.titel);
    }
    const zeilen = [...proProdukt.entries()]
        .sort((a, b) => (b[1].lager + b[1].verkauft) - (a[1].lager + a[1].verkauft))
        .map(([name, e]) => ({
            'Produkt': name, 'Neu?': e.neu ? '🆕 wird angelegt' : 'vorhanden',
            'auf Lager': e.lager, 'verkauft': e.verkauft, 'Beispiel-Titel': [...e.beispiele].join(' | ')
        }));

    const bereitsVerknuepft = artikel.filter(a => a.hatProdukt).length;
    output.markdown(`**${zuordnung.length}** Artikel würden zugeordnet, **${zeilen.filter(z => z['Neu?'] !== 'vorhanden').length}** Produkte neu angelegt. ` +
        `(${bereitsVerknuepft} Artikel sind schon verknüpft und bleiben unverändert.)`);
    output.table(zeilen);

    // Nicht zugeordnet: häufigste Titel (Lager zuerst) als Anregung für neue Regeln
    const offenZaehler = new Map();
    for (const a of offen) {
        const key = `${a.konsole} | ${a.titel}`;
        const e = offenZaehler.get(key) || { lager: 0, verkauft: 0 };
        if (a.status === 'auf Lager') e.lager++; else e.verkauft++;
        offenZaehler.set(key, e);
    }
    const offenTop = [...offenZaehler.entries()]
        .filter(([, e]) => e.lager + e.verkauft >= 3)
        .sort((a, b) => (b[1].lager + b[1].verkauft) - (a[1].lager + a[1].verkauft))
        .slice(0, 40)
        .map(([k, e]) => ({ 'Konsole | Titel': k, 'auf Lager': e.lager, 'verkauft': e.verkauft }));
    output.markdown(`### Nicht zugeordnet: ${offen.length} Artikel (Einzelstücke bleiben bewusst ohne Produkt)`);
    output.markdown('Häufigste Titel ab 3 Stück – Kandidaten für weitere Regeln:');
    if (offenTop.length) output.table(offenTop);

    if (!zuordnung.length) { output.markdown('✅ Nichts zu tun.'); return; }

    const ok = await input.buttonsAsync('Zuordnung jetzt schreiben?', [
        { label: `✅ Zuordnen (${zuordnung.length} Artikel)`, value: 'ja', variant: 'primary' },
        { label: '❌ Abbrechen', value: 'nein' }
    ]);
    if (ok !== 'ja') { output.markdown('Abgebrochen – nichts geschrieben.'); return; }

    // 1) Fehlende Produkte anlegen
    const neuNamen = [...new Set(zuordnung.filter(z => !z.produkt).map(z => z.produktName))];
    const neueIds = new Map();
    const kategorieOptionen = new Set(tblProdukt.getField(P.kategorie).options.choices.map(c => c.name));
    for (let i = 0; i < neuNamen.length; i += BATCH) {
        const teil = neuNamen.slice(i, i + BATCH);
        const ids = await tblProdukt.createRecordsAsync(teil.map(name => {
            const kat = zuordnung.find(z => z.produktName === name).kat;
            const fields = { [P.klarname]: name };
            if (kat && kategorieOptionen.has(kat)) fields[P.kategorie] = { name: kat };
            return { fields };
        }));
        teil.forEach((name, j) => neueIds.set(name, ids[j]));
    }
    output.markdown(`🆕 ${neuNamen.length} Produkte angelegt.`);

    // 2) Artikel verknüpfen (nur leere Felder)
    const updates = zuordnung.map(z => ({
        id: z.artikel.id,
        fields: { [A.produkt]: [{ id: z.produkt ? z.produkt.id : neueIds.get(z.produktName) }] }
    }));
    for (let i = 0; i < updates.length; i += BATCH)
        await tblArtikel.updateRecordsAsync(updates.slice(i, i + BATCH));

    output.markdown(`## ✅ ${updates.length} Artikel mit Produkten verknüpft.`);
}

if (typeof module !== 'undefined' && typeof base === 'undefined') {
    module.exports = { ermittleZuordnung, REGELN, kartenKey };   // lokaler Test
} else {
    await main();
}
