"""Task #27 — Cap-table computation engine.

Pure-python, deterministic, fully unit-testable. No I/O, no DB.

Conventions
-----------
* Shares are integers; we round to whole shares at every issuance step so
  the totals stay exact (no float drift across rounds).
* SAFEs follow the **pre-money SAFE** convention (the classic YC v1 — not
  the post-money variant). At conversion:
    cap_price       = cap / shares_outstanding_pre_round
    discount_price  = round_price * (1 - discount)
    conversion_price = min(cap_price, discount_price)  (whichever owner-favourable)
    safe_shares     = amount / conversion_price
* Option-pool top-ups are pre-money: the target post-round pool % is
  satisfied by issuing new pool shares before the priced money comes in,
  so existing holders eat the dilution (standard term-sheet behaviour).
* Waterfall assumes **1× non-participating preferred** for every priced-round
  investor and converted SAFE; founders and option-pool holders get common.
  Each preferred holder picks the better of (preference $) vs (pro-rata of
  the residual). This is a deliberate simplification — real terms (multiple,
  participation caps, seniority stacks) are out of scope per the task spec.
"""
from __future__ import annotations

from typing import Any


def _round_shares(x: float) -> int:
    return int(round(x))


def _safe_div(a: float, b: float) -> float:
    return a / b if b else 0.0


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def validate_inputs(inputs: dict) -> list[str]:
    """Return a list of human-readable validation errors. Empty = OK."""
    errs: list[str] = []
    founders = inputs.get("founders") or []
    if not founders:
        errs.append("At least one founder is required.")
    for f in founders:
        if not f.get("name"):
            errs.append("Every founder needs a name.")
        if float(f.get("shares") or 0) <= 0:
            errs.append(f"Founder '{f.get('name','?')}' needs shares > 0.")

    pool = float(inputs.get("option_pool_pct") or 0)
    if pool < 0 or pool > 80:
        errs.append("Option pool % must be between 0 and 80.")

    for s in inputs.get("safes") or []:
        if float(s.get("amount") or 0) <= 0:
            errs.append(f"SAFE '{s.get('name','?')}' needs amount > 0.")
        if float(s.get("cap") or 0) <= 0 and float(s.get("discount") or 0) <= 0:
            errs.append(f"SAFE '{s.get('name','?')}' needs a cap or a discount.")
        if not (0 <= float(s.get("discount") or 0) <= 0.9):
            errs.append(f"SAFE '{s.get('name','?')}' discount must be 0..0.9.")

    for r in inputs.get("rounds") or []:
        if not r.get("name"):
            errs.append("Every round needs a name.")
        if float(r.get("pre_money") or 0) <= 0:
            errs.append(f"Round '{r.get('name','?')}' needs pre-money > 0.")
        if float(r.get("investment") or 0) <= 0:
            errs.append(f"Round '{r.get('name','?')}' needs investment > 0.")
        pool_after = float(r.get("post_round_pool_pct") or 0)
        if pool_after and (pool_after < 0 or pool_after > 80):
            errs.append(f"Round '{r.get('name','?')}' pool % must be 0..80.")
    return errs


# ---------------------------------------------------------------------------
# Holder ledger helpers
# ---------------------------------------------------------------------------
def _ledger_total(ledger: list[dict]) -> int:
    return sum(int(h["shares"]) for h in ledger)


def _set_pct(ledger: list[dict]) -> None:
    total = _ledger_total(ledger)
    for h in ledger:
        h["pct"] = round(100.0 * _safe_div(h["shares"], total), 4)


def _add_or_merge(ledger: list[dict], holder: str, holder_type: str, shares: int) -> None:
    for h in ledger:
        if h["holder"] == holder and h["type"] == holder_type:
            h["shares"] = int(h["shares"]) + int(shares)
            return
    ledger.append({"holder": holder, "type": holder_type, "shares": int(shares)})


def _snapshot(ledger: list[dict]) -> list[dict]:
    """Deep-ish copy of the ledger with % recomputed."""
    out = [dict(h) for h in ledger]
    _set_pct(out)
    return out


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------
def simulate(inputs: dict) -> dict:
    """Run the full cap-table simulation. Returns:
        {
          "rounds": [
            { "name", "price_per_share", "pre_money", "post_money",
              "shares_pre", "shares_post",
              "ledger": [{holder, type, shares, pct}],
              "events": [free-form trace of issuances this round],
            }
          ],
          "founder_dilution": [
            { "founder": name,
              "series": [{round, pct, shares}, ... including 'Founding'] },
          ],
          "waterfall": {
            "exit_value": float,
            "rows": [{holder, type, shares, pct, preference, payout, source}],
            "totals": {preference_paid, common_pool, total_distributed}
          } | None,
          "warnings": [str, ...]
        }
    """
    errs = validate_inputs(inputs)
    if errs:
        return {"errors": errs}

    warnings: list[str] = []

    # ---- Round 0: founding ledger -------------------------------------
    founders = inputs["founders"]
    ledger: list[dict] = []
    for f in founders:
        _add_or_merge(ledger, f["name"], "founder", _round_shares(float(f["shares"])))

    initial_pool_pct = float(inputs.get("option_pool_pct") or 0)
    if initial_pool_pct > 0:
        # Pool = pool_pct of (founders + pool). Solve: pool / (founders+pool) = p
        founder_total = _ledger_total(ledger)
        target = initial_pool_pct / 100.0
        pool_shares = _round_shares(founder_total * target / max(1e-9, 1 - target))
        if pool_shares > 0:
            _add_or_merge(ledger, "Option Pool", "option_pool", pool_shares)

    founding_snapshot = _snapshot(ledger)

    # SAFEs are not yet on the cap table — they sit off-ledger until the
    # first priced round converts them.
    pending_safes = list(inputs.get("safes") or [])

    rounds_out: list[dict] = []
    for round_def in (inputs.get("rounds") or []):
        events: list[str] = []
        pre_money = float(round_def["pre_money"])
        investment = float(round_def["investment"])
        target_pool_post = float(round_def.get("post_round_pool_pct") or 0) / 100.0

        shares_pre = _ledger_total(ledger)
        # Round price uses *pre-money* shares (excluding SAFE conversions)
        # — this is the standard pre-money SAFE definition that makes SAFE
        # holders take dilution from each other but NOT from the new round.
        price_per_share = _safe_div(pre_money, shares_pre)

        # 1) Top up option pool BEFORE SAFEs + new money (pre-money pool top-up
        #    is the standard term-sheet behaviour: existing holders bear it).
        if target_pool_post > 0:
            # Solve so that after pool top-up + SAFEs + new money, the pool
            # is `target_pool_post` of the post-money cap. We approximate
            # by assuming SAFEs + new money first, then pool. To stay simple
            # & deterministic, we set the pool to `target_pool_post` of the
            # estimated post-round share count.
            est_safe_shares = 0.0
            for s in pending_safes:
                cap = float(s.get("cap") or 0)
                disc = float(s.get("discount") or 0)
                cap_price = _safe_div(cap, shares_pre) if cap else float("inf")
                disc_price = price_per_share * (1 - disc) if disc else float("inf")
                conv_price = min(cap_price, disc_price)
                if conv_price and conv_price != float("inf"):
                    est_safe_shares += float(s["amount"]) / conv_price
            est_new_inv_shares = _safe_div(investment, price_per_share)
            est_post_excl_pool = shares_pre + est_safe_shares + est_new_inv_shares
            current_pool = sum(h["shares"] for h in ledger if h["type"] == "option_pool")
            # target_pool_shares / (est_post_excl_pool - current_pool + target_pool_shares) = target_pool_post
            t = target_pool_post
            target_pool_shares = _round_shares(
                (est_post_excl_pool - current_pool) * t / max(1e-9, 1 - t)
            )
            top_up = target_pool_shares - current_pool
            if top_up > 0:
                _add_or_merge(ledger, "Option Pool", "option_pool", top_up)
                events.append(f"Option pool topped up by {top_up:,} shares "
                              f"(target {target_pool_post*100:.1f}% post)")
                # Recompute price after pool top-up — pool is pre-money.
                shares_pre = _ledger_total(ledger)
                price_per_share = _safe_div(pre_money, shares_pre)

        # 2) Convert SAFEs at this round.
        # Track each converted SAFE's *original* invested $ so the waterfall
        # can use it as the liquidation preference (not back-calc from round
        # price, which would inflate it when the cap binds).
        safe_preferences_this_round: dict[str, float] = {}
        for s in pending_safes:
            cap = float(s.get("cap") or 0)
            disc = float(s.get("discount") or 0)
            cap_price = _safe_div(cap, shares_pre) if cap else float("inf")
            disc_price = price_per_share * (1 - disc) if disc else float("inf")
            conv_price = min(cap_price, disc_price)
            binding = "cap" if cap_price <= disc_price else ("discount" if disc else "—")
            if not conv_price or conv_price == float("inf"):
                warnings.append(f"SAFE '{s.get('name')}' has no cap and no discount; skipped.")
                continue
            shares = _round_shares(float(s["amount"]) / conv_price)
            _add_or_merge(ledger, s["name"], "safe", shares)
            safe_preferences_this_round[s["name"]] = (
                safe_preferences_this_round.get(s["name"], 0.0) + float(s["amount"])
            )
            events.append(
                f"SAFE '{s['name']}' converted: {shares:,} shares "
                f"@ ${conv_price:,.4f} (binding: {binding})"
            )
        pending_safes = []  # all converted

        # 3) New investor.
        new_inv_shares = _round_shares(_safe_div(investment, price_per_share))
        investor_label = f"{round_def['name']} Investors"
        _add_or_merge(ledger, investor_label, "preferred", new_inv_shares)
        events.append(
            f"{investor_label}: {new_inv_shares:,} shares for ${investment:,.0f} "
            f"@ ${price_per_share:,.4f}/sh"
        )

        shares_post = _ledger_total(ledger)
        rounds_out.append({
            "name": round_def["name"],
            "pre_money": pre_money,
            "post_money": pre_money + investment,
            "investment": investment,
            "price_per_share": round(price_per_share, 6),
            "shares_pre": shares_pre,
            "shares_post": shares_post,
            "ledger": _snapshot(ledger),
            "events": events,
            "round_meta": {
                # carry through for waterfall preference calculation
                "investor_label": investor_label,
                "investment": investment,
                "safe_preferences": safe_preferences_this_round,
            },
        })

    # ---- Founder dilution series --------------------------------------
    founder_names = [f["name"] for f in founders]
    series = {n: [] for n in founder_names}
    for n in founder_names:
        f0 = next((h for h in founding_snapshot if h["holder"] == n), None)
        series[n].append({
            "round": "Founding",
            "shares": int(f0["shares"]) if f0 else 0,
            "pct": float(f0["pct"]) if f0 else 0.0,
        })
    for r in rounds_out:
        for n in founder_names:
            row = next((h for h in r["ledger"] if h["holder"] == n), None)
            series[n].append({
                "round": r["name"],
                "shares": int(row["shares"]) if row else 0,
                "pct": float(row["pct"]) if row else 0.0,
            })
    founder_dilution = [{"founder": n, "series": series[n]} for n in founder_names]

    # ---- Exit waterfall ------------------------------------------------
    waterfall = None
    exit_value = inputs.get("exit_value")
    if exit_value is not None and rounds_out:
        waterfall = _waterfall(rounds_out, float(exit_value))
    elif exit_value is not None:
        # Pre-round exit: just pro-rata across founders + pool.
        waterfall = _waterfall_pre_round(_snapshot(ledger), float(exit_value))

    return {
        "founding": founding_snapshot,
        "rounds": rounds_out,
        "founder_dilution": founder_dilution,
        "waterfall": waterfall,
        "warnings": warnings,
        "totals": {
            "shares_outstanding": _ledger_total(ledger),
            "rounds_completed": len(rounds_out),
        },
    }


# ---------------------------------------------------------------------------
# Waterfall
# ---------------------------------------------------------------------------
def _waterfall(rounds_out: list[dict], exit_value: float) -> dict:
    """1× non-participating preferred for each priced-round investor and SAFE.
    Founders + option pool are common. Each preferred holder picks the
    better of (preference) vs (pro-rata of residual)."""
    final = rounds_out[-1]["ledger"]
    total_shares = sum(h["shares"] for h in final)
    if total_shares <= 0:
        return {"exit_value": exit_value, "rows": [],
                "totals": {"preference_paid": 0.0, "common_pool": 0.0,
                           "total_distributed": 0.0},
                "assumptions": ["No outstanding shares — nothing to distribute."]}

    # Build preference map — investment$ for the priced-round investors and
    # *original* invested $ for each converted SAFE (carried through the
    # round_meta so we don't have to back-calc from share price).
    preferences: dict[str, float] = {}
    for r in rounds_out:
        meta = r["round_meta"]
        preferences[meta["investor_label"]] = (
            preferences.get(meta["investor_label"], 0.0) + meta["investment"]
        )
        for safe_name, amt in (meta.get("safe_preferences") or {}).items():
            preferences[safe_name] = preferences.get(safe_name, 0.0) + amt

    rows: list[dict] = []
    # Step 1 — decide for each preferred whether to take preference or convert.
    take_preference: dict[str, bool] = {}
    for h in final:
        pref = preferences.get(h["holder"], 0.0)
        if h["type"] not in ("preferred", "safe"):
            take_preference[h["holder"]] = False
            continue
        pro_rata_if_all_common = exit_value * h["shares"] / total_shares
        # Heuristic — preferred takes pref if pref > pro-rata-as-common.
        take_preference[h["holder"]] = pref > pro_rata_if_all_common

    # Step 2 — pay preferences first.
    preference_paid = 0.0
    for h in final:
        if take_preference.get(h["holder"]):
            pref = preferences.get(h["holder"], 0.0)
            payout = min(pref, max(0.0, exit_value - preference_paid))
            preference_paid += payout
            rows.append({
                "holder": h["holder"], "type": h["type"], "shares": h["shares"],
                "pct": h["pct"], "preference": pref, "payout": round(payout, 2),
                "source": "1x non-participating preference",
            })

    # Step 3 — distribute the residual pro-rata across holders who DIDN'T
    # take preference (founders, pool, and converted preferred).
    residual = max(0.0, exit_value - preference_paid)
    common_holders = [h for h in final if not take_preference.get(h["holder"])]
    common_total_shares = sum(h["shares"] for h in common_holders)
    for h in common_holders:
        share_payout = (residual * h["shares"] / common_total_shares) if common_total_shares > 0 else 0.0
        rows.append({
            "holder": h["holder"], "type": h["type"], "shares": h["shares"],
            "pct": h["pct"], "preference": preferences.get(h["holder"], 0.0),
            "payout": round(share_payout, 2),
            "source": ("pro-rata (converted preferred)"
                       if h["type"] in ("preferred", "safe") else "pro-rata (common)"),
        })

    # Sort biggest payout first for readability.
    rows.sort(key=lambda r: r["payout"], reverse=True)
    return {
        "exit_value": exit_value,
        "rows": rows,
        "totals": {
            "preference_paid": round(preference_paid, 2),
            "common_pool": round(residual, 2),
            "total_distributed": round(preference_paid + residual, 2),
        },
        "assumptions": [
            "1× non-participating preferred for SAFE + priced-round investors.",
            "No participation, no multiple, no seniority stack.",
            "Pro-rata across common when residual is distributed.",
        ],
    }


def _waterfall_pre_round(ledger: list[dict], exit_value: float) -> dict:
    """Exit before any priced round — pure pro-rata."""
    total = sum(h["shares"] for h in ledger)
    rows = [{
        "holder": h["holder"], "type": h["type"], "shares": h["shares"],
        "pct": h["pct"], "preference": 0.0,
        "payout": round(exit_value * h["shares"] / total, 2) if total else 0.0,
        "source": "pro-rata (common)",
    } for h in ledger]
    rows.sort(key=lambda r: r["payout"], reverse=True)
    return {
        "exit_value": exit_value, "rows": rows,
        "totals": {"preference_paid": 0.0, "common_pool": exit_value,
                   "total_distributed": exit_value},
        "assumptions": ["Pre-round exit — all common, pro-rata."],
    }


# ---------------------------------------------------------------------------
# CSV export — 409A-friendly (Carta-ish columns)
# ---------------------------------------------------------------------------
def to_csv(result: dict) -> str:
    import csv, io
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Cap-table simulation export", "draft, not a 409A valuation"])
    w.writerow([])

    if result.get("founding"):
        w.writerow(["Section", "Founding cap table"])
        w.writerow(["Stakeholder", "Type", "Shares", "Ownership %"])
        for h in result["founding"]:
            w.writerow([h["holder"], h["type"], h["shares"], f"{h['pct']:.4f}"])
        w.writerow([])

    for r in result.get("rounds", []):
        w.writerow(["Section", f"Post-{r['name']} cap table"])
        w.writerow(["Pre-money", r["pre_money"], "Investment", r["investment"],
                    "Post-money", r["post_money"], "PPS", r["price_per_share"]])
        w.writerow(["Stakeholder", "Security Type", "Shares", "Ownership %"])
        for h in r["ledger"]:
            w.writerow([h["holder"], h["type"], h["shares"], f"{h['pct']:.4f}"])
        w.writerow([])

    if result.get("waterfall"):
        wf = result["waterfall"]
        w.writerow(["Section", f"Exit waterfall @ ${wf['exit_value']:,.0f}"])
        w.writerow(["Stakeholder", "Type", "Shares", "Ownership %",
                    "Liquidation preference $", "Payout $", "Source"])
        for row in wf["rows"]:
            w.writerow([row["holder"], row["type"], row["shares"],
                        f"{row['pct']:.4f}", f"{row['preference']:.2f}",
                        f"{row['payout']:.2f}", row["source"]])
        w.writerow([])
        w.writerow(["Total preference paid", wf["totals"]["preference_paid"]])
        w.writerow(["Common pool",            wf["totals"]["common_pool"]])
        w.writerow(["Total distributed",      wf["totals"]["total_distributed"]])

    return buf.getvalue()
