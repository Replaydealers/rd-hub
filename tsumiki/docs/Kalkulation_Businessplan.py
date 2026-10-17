"""Kalkulation Japan-Sammelimport (Replay Dealers) – Stand Okt 2026.
Alle Annahmen hier zentral, damit sie leicht anpassbar sind."""

YEN = 185.0                    # EUR/JPY (EZB-Referenz Mai/Juni 2026 ~184-186)
SENDICO_FEE = 800 / YEN        # ¥500 + ¥300 Aufschlag Mercari/Yahoo (ab 1.8.2026)
JP_INLAND = 3.0                # Inlandsversand JP zum Lager (oft inkl.)

# --- Kunde bestellt allein (direkt an Haustür, Kurier, da Japan Post IOSS nach DE ausgesetzt)
SOLO_INTL = 25.0               # Kurier kleines Paket (<0,5 kg), konservativ (1 kg DHL ~$39)
PAUSCHALZOLL = 3.0             # seit 1.7.2026 je Warenkategorie bis 150 €
COURIER_CLEARANCE = 15.0       # Verzollungsgebühr Kurier (DHL Express min. 14,88 / FedEx ~15)

# --- Sammelimport durch RD
BOX_KG = 10
BOX_COST = 105.0               # ~¥19.000 Kurier-Economy 10 kg (5 kg: ¥9-13k FedEx Econ.)
ITEM_KG = 0.25                 # Ø Versandgewicht je Auftrag inkl. Schutzverpackung
ORDERS_PER_BOX = BOX_KG / ITEM_KG
CLEAR_PER_SHIPMENT = 25.0      # Verzollung kommerzielle Sendung (2 % / min ~15 € + Puffer)
DUTY_CARDS = 0.027             # 9504 40 00, ohne Ursprungsnachweis
DE_SHIP = lambda v: 2.90 if v <= 50 else 6.19   # eure Prämisse
PACK = 0.50
PAY_FEE = lambda gross: gross * 0.0249 + 0.35   # PayPal-ähnlich
RISK = 0.02                    # Rücklage Ausfälle (Mercari-Storno, Transportschaden)
VAT = 0.19

def solo(v):
    base = v + SENDICO_FEE + JP_INLAND + SOLO_INTL
    duty = PAUSCHALZOLL if v <= 150 else v * DUTY_CARDS
    eust = (base + duty) * VAT
    return base + duty + eust + COURIER_CLEARANCE

def service_fee(v):
    """Vorschlag: 5 € Grundgebühr + 8 % vom Warenwert, max. 40 €."""
    return min(5 + 0.08 * v, 40)

def ours(v):
    freight = BOX_COST / ORDERS_PER_BOX
    clear = CLEAR_PER_SHIPMENT / ORDERS_PER_BOX
    duty = (v + freight) * DUTY_CARDS
    cost_net = v + SENDICO_FEE + JP_INLAND + freight + clear + duty + DE_SHIP(v) + PACK
    fee = service_fee(v)
    net_price = cost_net + fee
    gross = net_price * (1 + VAT)
    pay = PAY_FEE(gross)
    risk = v * RISK
    profit = fee - pay - risk
    return gross, profit, fee

print(f"Aufträge je 10-kg-Box: {ORDERS_PER_BOX:.0f}\n")
print(f"{'Warenwert':>9} | {'allein':>8} | {'über RD':>8} | {'Ersparnis':>9} | {'Gebühr':>6} | {'Gewinn/Auftr.':>13}")
for v in [15, 30, 50, 100, 200, 400]:
    s = solo(v); g, p, f = ours(v)
    print(f"{v:>8} € | {s:>7.2f} € | {g:>7.2f} € | {s-g:>6.2f} € ({(s-g)/s*100:>3.0f}%) | {f:>5.2f} € | {p:>10.2f} €")

# --- Szenarien pro Monat
print("\nSzenarien (Ø Warenwert 60 €)")
AVG = 60
_, p_avg, _ = ours(AVG)
MIN_PER_ORDER = 15
H_PER_SHIPMENT = 3
FIX_MONTH = 30   # Formular-/Shop-App, Versicherung, Kleinkram
for name, n in [("Test", 30), ("Basis", 80), ("Gut", 200)]:
    shipments = max(1, round(n / ORDERS_PER_BOX + 0.49))
    profit = n * p_avg - FIX_MONTH
    hours = n * MIN_PER_ORDER / 60 + shipments * H_PER_SHIPMENT
    umsatz = n * ours(AVG)[0]
    eust_vorfin = n * (AVG + 3) * VAT
    print(f"{name:6}: {n:3} Aufträge, {shipments} Sendung(en), Umsatz {umsatz:7.0f} €, Gewinn {profit:6.0f} €, "
          f"{hours:5.1f} h → {profit/hours:5.1f} €/h, EUSt-Vorfinanz. ~{eust_vorfin:5.0f} €")
print(f"\nGewinn je Ø-Auftrag: {p_avg:.2f} €")
