"""Single source of truth for ALL mock fixtures.

The 11-partner ROSTER below is the ONLY place courier names/codes are defined.
Every fixture (bills + everything derived from bills) is generated here, so the
courier roster can never drift between files. Re-run after editing ROSTER:

    python scripts/generate_mock_data.py

Deterministic (seeded). Field shapes match the Pydantic schemas exactly.
"""

import json
import random
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

# --- The single source of truth: (name, code, volume weight) ---
ROSTER = [
    ("Delhivery", "DLV", 12),
    ("Amazon Shipping", "AMZ", 12),
    ("Ecom Express", "ECM", 10),
    ("XpressBees", "XB", 9),
    ("Shiprocket", "SR", 9),
    ("Bluedart", "BLD", 8),
    ("DTDC", "DTDC", 7),
    ("Shadowfax", "SFX", 7),
    ("Pickrr", "PKR", 6),
    ("Smartr", "SMR", 5),
    ("WareIQ", "WIQ", 4),
]
COURIER_NAMES = [r[0] for r in ROSTER]
CODE = {name: code for name, code, _ in ROSTER}

ZONES = ["Zone A", "Zone B", "Zone C", "Zone D", "Zone E"]
ZONE_BASE = {"Zone A": 32, "Zone B": 45, "Zone C": 58, "Zone D": 72, "Zone E": 95}
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"]
STATUS_WEIGHTS = [("delivered", 0.55), ("in_transit", 0.18), ("pending", 0.10), ("rto", 0.09), ("discrepancy", 0.08)]

START = date(2026, 1, 15)
END = date(2026, 7, 12)
SPAN = (END - START).days

OUT = Path(__file__).resolve().parent.parent / "app" / "database" / "mock"
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(11)


def r2(x: float) -> float:
    return round(x, 2)


def weighted_status() -> str:
    r = rng.random()
    acc = 0.0
    for s, w in STATUS_WEIGHTS:
        acc += w
        if r <= acc:
            return s
    return "delivered"


def kpi(key, label, value, fmt, delta, tone):
    return {"key": key, "label": label, "value": value, "format": fmt, "delta": delta, "delta_tone": tone}


# ---------------- bills.json (each courier guaranteed present) ----------------
bills = []
bid = 1
for name, code, weight in ROSTER:
    count = max(4, weight)
    for _ in range(count):
        zone = rng.choice(ZONES)
        w = round(rng.uniform(0.2, 8.0), 2)
        amount = r2(ZONE_BASE[zone] + w * rng.uniform(28, 42) + rng.uniform(-8, 20))
        is_cod = rng.random() < 0.45
        cod = r2(amount + rng.uniform(50, 900)) if is_cod else 0.0
        d = START + timedelta(days=rng.randint(0, SPAN))
        awb = f"{code}{rng.randint(10_000_000, 99_999_999)}"
        bills.append({
            "id": bid, "awb": awb, "courier": name, "date": d.isoformat(),
            "weight": w, "zone": zone, "amount": amount, "cod": cod, "status": weighted_status(),
        })
        bid += 1

bills.sort(key=lambda b: b["date"], reverse=True)
for i, b in enumerate(bills, start=1):
    b["id"] = i
(OUT / "bills.json").write_text(json.dumps(bills, indent=2), encoding="utf-8")

# ---------------- per-courier aggregates ----------------
agg = {name: {"ship": 0, "freight": 0.0, "rto_amt": 0.0, "cod": 0.0, "rto_ct": 0, "cod_ct": 0} for name in COURIER_NAMES}
for b in bills:
    a = agg[b["courier"]]
    a["ship"] += 1
    a["freight"] += b["amount"]
    a["cod"] += b["cod"]
    if b["cod"] > 0:
        a["cod_ct"] += 1
    if b["status"] == "rto":
        a["rto_amt"] += b["amount"]
        a["rto_ct"] += 1


def components(name):
    a = agg[name]
    freight = r2(a["freight"])
    fuel = r2(freight * 0.14)
    rto = r2(a["rto_amt"])
    cod_fee = r2(a["cod"] * 0.015)
    total_billed = r2(freight + cod_fee + rto + fuel)
    return freight, cod_fee, rto, fuel, total_billed


remit_ratio = {name: rng.uniform(0.6, 0.98) for name in COURIER_NAMES}


def recon_from_ratio(pending, collected):
    ratio = (pending / collected) if collected else 0
    return "reconciled" if ratio < 0.05 else "partial" if ratio < 0.25 else "pending"


# ---------------- couriers.json ----------------
couriers = []
for name in COURIER_NAMES:
    a = agg[name]
    freight, cod_fee, rto, fuel, total_billed = components(name)
    collected = r2(a["cod"])
    remitted = r2(collected * remit_ratio[name])
    pending = r2(collected - remitted)
    cr = recon_from_ratio(pending, collected)
    # couriers.recon_status enum: reconciled / pending / disputed
    recon_status = {"reconciled": "reconciled", "partial": "pending", "pending": "disputed"}[cr]
    couriers.append({
        "name": name, "code": CODE[name], "shipments": a["ship"],
        "avg_cost": r2(total_billed / a["ship"]),
        "on_time_pct": r2(rng.uniform(88, 98)),
        "total_billing": freight, "rating": r2(rng.uniform(3.6, 4.8)),
        "rto_pct": r2(rto / total_billed * 100) if total_billed else 0.0,
        "recon_status": recon_status,
        "freight": freight, "cod": cod_fee, "rto": rto, "fuel": fuel,
        "total_billed": total_billed, "cod_remitted": remitted,
        "net_payable": r2(total_billed - remitted),
    })
couriers.sort(key=lambda c: c["total_billed"], reverse=True)
couriers = [{"id": i, **c} for i, c in enumerate(couriers, start=1)]
(OUT / "couriers.json").write_text(json.dumps(couriers, indent=2), encoding="utf-8")

# ---------------- dashboard.json ----------------
total_billing = r2(sum(a["freight"] for a in agg.values()))
total_shipments = len(bills)
total_cod = r2(sum(a["cod"] for a in agg.values()))
pending_recon = r2(sum(c["cod_remitted"] and (c["cod"] * 0 + (agg[c["name"]]["cod"] - c["cod_remitted"])) or 0 for c in couriers))
# simpler: pending recon = total collected - total remitted
pending_recon = r2(total_cod - sum(c["cod_remitted"] for c in couriers))
savings = r2(total_billing * 0.065)

kpis = [
    kpi("total_billing", "Total Billing", total_billing, "currency", 8.4, "positive"),
    kpi("total_shipments", "Total Shipments", total_shipments, "number", 5.1, "positive"),
    kpi("average_cost", "Average Cost", r2(total_billing / total_shipments), "currency", -2.3, "positive"),
    kpi("total_cod", "COD", total_cod, "currency", 3.7, "neutral"),
    kpi("pending_recon", "Pending Reconciliation", pending_recon, "currency", 12.6, "negative"),
    kpi("savings", "Savings", savings, "currency", 6.9, "positive"),
]

courier_comparison = []
for name in COURIER_NAMES:
    freight, cod_fee, rto, fuel, total_billed = components(name)
    courier_comparison.append({"courier": name, "shipments": agg[name]["ship"], "billing": total_billed,
                               "freight": freight, "cod": cod_fee, "rto": rto, "fuel": fuel})
courier_comparison.sort(key=lambda x: x["billing"], reverse=True)
distribution = [{"name": c["courier"], "value": c["shipments"]} for c in courier_comparison]

m_bill = defaultdict(float); m_ship = defaultdict(int); mc_bill = defaultdict(float)
z_cost = defaultdict(float); z_ship = defaultdict(int); zc_cost = defaultdict(float); zc_ship = defaultdict(int)
for b in bills:
    m = MONTHS[int(b["date"][5:7]) - 1]
    m_bill[m] += b["amount"]; m_ship[m] += 1; mc_bill[(m, b["courier"])] += b["amount"]
    z_cost[b["zone"]] += b["amount"]; z_ship[b["zone"]] += 1
    zc_cost[(b["zone"], b["courier"])] += b["amount"]; zc_ship[(b["zone"], b["courier"])] += 1

monthly_billing = [{"month": m, "billing": r2(m_bill[m]), "shipments": m_ship[m]} for m in MONTHS]
zone_cost = [{"zone": z, "cost": r2(z_cost[z])} for z in ZONES]
zone_couriers = COURIER_NAMES[:]
zone_cost_by_courier = [{"zone": z, **{c: r2(zc_cost[(z, c)]) for c in COURIER_NAMES}} for z in ZONES]

now = datetime(2026, 7, 13, 9, 30)
recent_activity = [
    {"id": 1, "kind": "upload", "message": "Delhivery bill uploaded · 1,204 shipments", "timestamp": (now - timedelta(minutes=12)).isoformat()},
    {"id": 2, "kind": "discrepancy", "message": "38 weight discrepancies flagged for review", "timestamp": (now - timedelta(hours=1)).isoformat()},
    {"id": 3, "kind": "remittance", "message": "COD remittance reconciled for Bluedart", "timestamp": (now - timedelta(hours=3)).isoformat()},
    {"id": 4, "kind": "upload", "message": "Amazon Shipping bill uploaded · 642 shipments", "timestamp": (now - timedelta(hours=5)).isoformat()},
    {"id": 5, "kind": "system", "message": "Rate card synced for Zone D", "timestamp": (now - timedelta(hours=8)).isoformat()},
    {"id": 6, "kind": "discrepancy", "message": "RTO surge detected on Shiprocket", "timestamp": (now - timedelta(days=1)).isoformat()},
]

dashboard = {
    "kpis": kpis, "courier_comparison": courier_comparison, "distribution": distribution,
    "monthly_billing": monthly_billing, "zone_cost": zone_cost,
    "zone_couriers": zone_couriers, "zone_cost_by_courier": zone_cost_by_courier,
    "recent_activity": recent_activity, "recent_bills": bills[:8],
}
(OUT / "dashboard.json").write_text(json.dumps(dashboard, indent=2), encoding="utf-8")

# ---------------- cod.json ----------------
reconciliation = []
tot_collected = tot_remitted = tot_pending = 0.0
for name in COURIER_NAMES:
    collected = r2(agg[name]["cod"])
    remitted = r2(collected * remit_ratio[name])
    pending = r2(collected - remitted)
    status = recon_from_ratio(pending, collected)  # ReconStatus: reconciled/partial/pending
    reconciliation.append({
        "courier": name, "collected": collected, "remitted": remitted, "pending": pending,
        "status": status, "cod_shipments": agg[name]["cod_ct"], "cod_amount": collected,
        "tds": r2(collected * 0.01),
    })
    tot_collected += collected; tot_remitted += remitted; tot_pending += pending
reconciliation.sort(key=lambda x: x["collected"], reverse=True)

cod_kpis = [
    kpi("collected", "Total Collected", r2(tot_collected), "currency", 4.2, "neutral"),
    kpi("remitted", "Total Remitted", r2(tot_remitted), "currency", 6.1, "positive"),
    kpi("pending", "Pending", r2(tot_pending), "currency", 9.3, "negative"),
    kpi("recon_rate", "Reconciliation Rate", r2(tot_remitted / tot_collected * 100) if tot_collected else 0, "percent", 1.4, "positive"),
]
WEEK_W = [0.22, 0.26, 0.28, 0.24]; REMIT_W = [0.18, 0.24, 0.30, 0.28]
weekly = [{"week": f"Week {i + 1}", "collected": r2(tot_collected * WEEK_W[i]), "remitted": r2(tot_remitted * REMIT_W[i])} for i in range(4)]
(OUT / "cod.json").write_text(json.dumps({"kpis": cod_kpis, "reconciliation": reconciliation, "weekly": weekly}, indent=2), encoding="utf-8")

# ---------------- zones.json ----------------
zones = [{"zone": z, "shipments": z_ship[z], "avg_cost": r2(z_cost[z] / z_ship[z]) if z_ship[z] else 0.0,
          "total_cost": r2(z_cost[z]), "on_time_pct": r2(rng.uniform(86, 97))} for z in ZONES]
heatmap = [{"zone": z, "courier": c, "cost": r2(zc_cost[(z, c)]), "shipments": zc_ship[(z, c)]}
           for z in ZONES for c in COURIER_NAMES]
(OUT / "zones.json").write_text(json.dumps({"zones": zones, "heatmap": heatmap}, indent=2), encoding="utf-8")

# ---------------- weight.json ----------------
scatter = []; overcharged = 0; tot_actual = tot_charged = 0.0
for b in bills:
    actual = b["weight"]
    charged = round(actual + (round(rng.uniform(0.2, 1.6), 2) if rng.random() < 0.4 else 0.0), 2)
    if charged > actual + 0.05:
        overcharged += 1
    tot_actual += actual; tot_charged += charged
    scatter.append({"actual": actual, "charged": charged, "courier": b["courier"]})
buckets = [("0–0.5", 0, 0.5), ("0.5–1", 0.5, 1), ("1–2", 1, 2), ("2–5", 2, 5), ("5+", 5, 999)]
histogram = [{"bucket": lbl, "count": sum(1 for b in bills if lo <= b["weight"] < hi)} for lbl, lo, hi in buckets]
weight = {"scatter": scatter, "histogram": histogram, "summary": {
    "avg_actual": r2(tot_actual / len(bills)), "avg_charged": r2(tot_charged / len(bills)),
    "overcharge_pct": r2(overcharged / len(bills) * 100), "flagged": overcharged}}
(OUT / "weight.json").write_text(json.dumps(weight, indent=2), encoding="utf-8")

# ---------------- trend.json ----------------
trend_monthly = [{"month": m, "billing": r2(m_bill[m]), "shipments": m_ship[m],
                  "avg_cost": r2(m_bill[m] / m_ship[m]) if m_ship[m] else 0.0} for m in MONTHS]
by_month = [{"month": m, **{c: r2(mc_bill[(m, c)]) for c in COURIER_NAMES}} for m in MONTHS]
(OUT / "trend.json").write_text(json.dumps({"monthly": trend_monthly, "couriers": COURIER_NAMES, "by_month": by_month}, indent=2), encoding="utf-8")

# ---------------- discrepancies.json ----------------
disc_items = []; did = 1
statuses = ["open", "open", "disputed", "resolved"]
for b in bills:
    if b["status"] == "discrepancy" or rng.random() < 0.10:
        billed_w = round(b["weight"] + rng.uniform(0.3, 1.5), 2)
        billed_amt = b["amount"]
        expected = r2(billed_amt - rng.uniform(15, 90))
        dtype = rng.choice(["weight", "weight", "zone", "rate"])
        disc_items.append({
            "id": did, "awb": b["awb"], "courier": b["courier"], "type": dtype,
            "billed_weight": billed_w, "actual_weight": b["weight"],
            "billed_amount": billed_amt, "expected_amount": expected,
            "difference": r2(billed_amt - expected), "status": rng.choice(statuses), "date": b["date"],
        })
        did += 1
    if did > 28:
        break

REASON = {"rate": "Rate card mismatch", "zone": "Zone misclassification", "cod": "COD fee error"}
weight_discrepancies = [{"courier": it["courier"], "awb": it["awb"], "extra_kg": r2(it["billed_weight"] - it["actual_weight"])}
                        for it in disc_items if it["type"] == "weight"][:6]
overcharging_alerts = [{"courier": it["courier"], "reason": REASON.get(it["type"], "Billing mismatch"), "amount": r2(it["difference"])}
                       for it in disc_items if it["type"] in ("rate", "zone", "cod")][:5]
reconciled = [{"courier": c["name"], "period": "June 2026", "bills": c["shipments"]}
              for c in couriers if c["recon_status"] == "reconciled"]
if not reconciled:
    reconciled = [{"courier": c["name"], "period": "June 2026", "bills": c["shipments"]}
                  for c in sorted(couriers, key=lambda x: x["rto_pct"])[:4]]
rto_analysis = sorted([{"courier": c["name"], "rto_rate": c["rto_pct"]} for c in couriers],
                      key=lambda x: x["rto_rate"], reverse=True)

at_risk = r2(sum(d["difference"] for d in disc_items))
disc_kpis = [
    kpi("flagged", "Flagged", len(disc_items), "number", 7.5, "negative"),
    kpi("weight_disc", "Weight Discrepancies", sum(1 for d in disc_items if d["type"] == "weight"), "number", 3.1, "negative"),
    kpi("at_risk", "Amount at Risk", at_risk, "currency", 11.2, "negative"),
    kpi("resolved", "Resolved", sum(1 for d in disc_items if d["status"] == "resolved"), "number", 5.0, "positive"),
]
(OUT / "discrepancies.json").write_text(json.dumps({
    "kpis": disc_kpis, "items": disc_items, "weight_discrepancies": weight_discrepancies,
    "overcharging_alerts": overcharging_alerts, "reconciled": reconciled, "rto_analysis": rto_analysis}, indent=2), encoding="utf-8")

# ---------------- settings.json ----------------
api_states = {}
for i, name in enumerate(COURIER_NAMES):
    api_states[name] = "degraded" if i == 4 else "disconnected" if i == len(COURIER_NAMES) - 1 else "connected"
settings = {
    "couriers": [{"id": i + 1, "name": name, "code": CODE[name],
                  "active": api_states[name] != "disconnected", "api_status": api_states[name]}
                 for i, name in enumerate(COURIER_NAMES)],
    "ratecard": {"version": "2026.2", "effective_from": date(2026, 4, 1).isoformat(),
                 "zones": 5, "weight_slabs": 6, "last_synced": datetime(2026, 7, 13, 6, 0).isoformat()},
    "preferences": {"currency": "INR", "timezone": "Asia/Kolkata", "weight_unit": "kg",
                    "discrepancy_threshold_pct": 5.0, "email_alerts": True},
    "company": {
        "company_name": "DeoDap Retail Pvt. Ltd.",
        "gstin": "24ABCDE1234F1Z5",
        "address": "402, Silver Business Point, Utran, Surat, Gujarat 394105",
        "support_email": "support@deodap.in",
        "support_phone": "+91 98200 00000",
    },
    "notification_prefs": {
        "email_alerts": True,
        "discrepancies": True,
        "cod_pending": True,
        "rto_surge": False,
        "bill_uploaded": False,
    },
}
(OUT / "settings.json").write_text(json.dumps(settings, indent=2), encoding="utf-8")

print(f"bills: {len(bills)} across {len(COURIER_NAMES)} couriers")
print("couriers:", [c["name"] for c in couriers])
print("discrepancies items:", len(disc_items), "| reconciled:", len(reconciled))
print("all fixtures regenerated in", OUT)
