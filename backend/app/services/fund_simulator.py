"""Task #46 — pure-Python fund-level simulators.

Two engines, both deterministic:

* :func:`simulate_reserves` — given a fund + per-company reserve allocations,
  computes deployment metrics (initial deployed, reserves planned, fund-level
  deployment %, reserve ratio) and a per-company MOIC + fund-level IRR
  projection. The IRR projection is intentionally simple — caller supplies
  an `expected_moic_per_company` (or we default to 3.0×) and a `years_to_exit`
  (default 5); we treat the cash flow as -invested today, +invested×MOIC at
  year N and solve via bisection.

* :func:`simulate_waterfall` — European waterfall. Inputs: exit value, total
  LP committed, total LP invested, GP carry %, hurdle rate (preferred return,
  annualized), years held. Output: tranche-by-tranche (return of capital,
  preferred return / hurdle, GP catch-up, carry split) plus a per-LP table
  pro-rated by commitment share.

Out of scope (per task brief): multi-fund consolidation, American waterfall
(deal-by-deal carry), GP commit, recycling.
"""

from __future__ import annotations

from typing import Iterable, Optional


# ---------------------------------------------------------------------------
# Reserves
# ---------------------------------------------------------------------------
def simulate_reserves(
    *,
    total_commitment: float,
    allocations: list[dict],
    expected_moic_per_company: Optional[float] = None,
    years_to_exit: float = 5.0,
    fund_expense_pct: float = 0.20,
) -> dict:
    """Compute deployment + reserve ratio + projected fund IRR.

    Args:
        total_commitment: total LP commitments to the fund (dollars).
        allocations: list of dicts with keys ``project_id``, ``project_name``,
            ``initial_check``, ``reserve_amount`` and optionally
            ``expected_moic`` (per-company override) and
            ``target_ownership_pct``.
        expected_moic_per_company: default MOIC (gross) if a row doesn't
            override. Defaults to 3.0× when None.
        years_to_exit: weighted average exit horizon in years (default 5).
        fund_expense_pct: % of commitment consumed by fees + expenses over
            the life of the fund (default 20 %, a typical 2-and-20 drag).

    Returns:
        dict with `summary` (fund-level numbers) and `companies` (per-row).
    """
    default_moic = float(expected_moic_per_company or 3.0)
    years = max(0.25, float(years_to_exit))
    commitment = max(0.0, float(total_commitment or 0.0))
    expense_drag = max(0.0, min(0.95, float(fund_expense_pct))) * commitment
    investable = max(0.0, commitment - expense_drag)

    initial_total = 0.0
    reserve_total = 0.0
    rows: list[dict] = []
    proceeds_total = 0.0

    for a in allocations:
        initial = max(0.0, float(a.get("initial_check") or 0.0))
        reserve = max(0.0, float(a.get("reserve_amount") or 0.0))
        moic = float(a.get("expected_moic") or default_moic)
        invested = initial + reserve
        proceeds = invested * moic
        rows.append({
            "project_id": a.get("project_id"),
            "project_name": a.get("project_name"),
            "initial_check": round(initial, 2),
            "reserve_amount": round(reserve, 2),
            "total_invested": round(invested, 2),
            "expected_moic": round(moic, 3),
            "projected_proceeds": round(proceeds, 2),
            "target_ownership_pct": a.get("target_ownership_pct"),
            "confidence": a.get("confidence") or "medium",
        })
        initial_total += initial
        reserve_total += reserve
        proceeds_total += proceeds

    deployed_total = initial_total + reserve_total
    over_allocated = deployed_total > investable
    uncalled = max(0.0, investable - deployed_total)

    # Fund IRR — single cash-flow approximation: -deployed at t=0,
    # +(proceeds + uncalled returned to LPs) at t=years. IRR = (proceeds_total
    # + uncalled) / commitment ^ (1/years) - 1, with commitment as the LP
    # outlay (so IRR is gross-of-fees from the LP's perspective).
    lp_outlay = commitment if commitment > 0 else deployed_total
    distributions = proceeds_total + uncalled
    if lp_outlay > 0 and distributions > 0:
        gross_multiple = distributions / lp_outlay
        irr = (gross_multiple ** (1.0 / years)) - 1.0
    else:
        gross_multiple = 0.0
        irr = 0.0

    return {
        "summary": {
            "total_commitment": round(commitment, 2),
            "investable_capital": round(investable, 2),
            "expense_drag": round(expense_drag, 2),
            "initial_deployed": round(initial_total, 2),
            "reserves_planned": round(reserve_total, 2),
            "total_deployed": round(deployed_total, 2),
            "uncalled_capital": round(uncalled, 2),
            "deployment_pct": round((deployed_total / investable * 100.0) if investable > 0 else 0.0, 2),
            "reserve_ratio_pct": round((reserve_total / deployed_total * 100.0) if deployed_total > 0 else 0.0, 2),
            "over_allocated": over_allocated,
            "projected_proceeds": round(proceeds_total, 2),
            "projected_distributions": round(distributions, 2),
            "projected_moic": round(gross_multiple, 3),
            "projected_irr_pct": round(irr * 100.0, 2),
            "years_to_exit": years,
            "company_count": len(rows),
        },
        "companies": rows,
        "assumptions": [
            f"Default MOIC per company: {default_moic:.2f}× (override per-row).",
            f"Fund expense drag: {fund_expense_pct * 100:.0f}% of commitment.",
            f"Single exit at year {years:.1f}; IRR is gross-of-carry.",
            "Uncalled capital returned to LPs at exit (no recycling).",
        ],
    }


# ---------------------------------------------------------------------------
# Waterfall (European, whole-of-fund)
# ---------------------------------------------------------------------------
def simulate_waterfall(
    *,
    exit_value: float,
    total_committed: float,
    total_invested: float,
    carry_pct: float = 0.20,
    hurdle_rate: float = 0.08,
    years_held: float = 5.0,
    gp_catchup: bool = True,
    lps: Optional[Iterable[dict]] = None,
) -> dict:
    """European waterfall: 4 tranches (return of capital → preferred return
    → GP catch-up → 80/20 carry split on the rest).

    Per-LP allocation is pro-rated by commitment share. The GP receives carry
    only; no GP commit modeled.

    Args:
        exit_value: gross proceeds to the fund (dollars).
        total_committed: total LP commitments (dollars).
        total_invested: total LP capital actually deployed (dollars).
        carry_pct: GP carry rate (0.20 = 20 %).
        hurdle_rate: annualized preferred return (0.08 = 8 %).
        years_held: years from investment to exit (for hurdle compounding).
        gp_catchup: whether to apply 100 % GP catch-up after hurdle (default
            True — full catch-up to carry_pct of profits).
        lps: optional iterable of dicts with ``name`` + ``commitment_amount``
            (and optionally ``invested_amount``); per-LP rows pro-rated.

    Returns:
        dict with `tranches`, `totals`, `lp_rows`, `assumptions`.
    """
    exit_value = max(0.0, float(exit_value or 0.0))
    invested = max(0.0, float(total_invested or 0.0))
    committed = max(invested, float(total_committed or 0.0))  # committed >= invested
    carry = max(0.0, min(0.50, float(carry_pct)))
    hurdle = max(0.0, min(0.50, float(hurdle_rate)))
    years = max(0.0, float(years_held))

    tranches: list[dict] = []
    remaining = exit_value

    # Tranche 1 — return of invested capital to LPs.
    roc = min(invested, remaining)
    remaining -= roc
    tranches.append({"name": "Return of capital", "to": "LPs", "amount": round(roc, 2)})

    # Tranche 2 — preferred return (hurdle), compounded on invested capital.
    hurdle_target = invested * (((1.0 + hurdle) ** years) - 1.0)
    pref = min(hurdle_target, remaining)
    remaining -= pref
    tranches.append({
        "name": f"Preferred return (hurdle {hurdle * 100:.1f}%)",
        "to": "LPs",
        "amount": round(pref, 2),
    })

    # Tranche 3 — GP catch-up. With full catch-up at carry_pct, GP receives
    # X such that X / (X + pref) = carry_pct, i.e. X = pref * carry / (1 - carry).
    gp_catchup_amt = 0.0
    if gp_catchup and carry > 0 and pref > 0:
        target = pref * carry / (1.0 - carry) if (1.0 - carry) > 0 else 0.0
        gp_catchup_amt = min(target, remaining)
        remaining -= gp_catchup_amt
    tranches.append({
        "name": "GP catch-up",
        "to": "GP",
        "amount": round(gp_catchup_amt, 2),
    })

    # Tranche 4 — carry split on the residual.
    lp_split = remaining * (1.0 - carry)
    gp_split = remaining * carry
    tranches.append({"name": f"Profit split — LP {(1 - carry) * 100:.0f}%", "to": "LPs", "amount": round(lp_split, 2)})
    tranches.append({"name": f"Profit split — GP carry {carry * 100:.0f}%", "to": "GP", "amount": round(gp_split, 2)})

    lp_total = roc + pref + lp_split
    gp_total = gp_catchup_amt + gp_split
    total_distributed = lp_total + gp_total

    # Per-LP pro-rate by commitment.
    lp_rows: list[dict] = []
    lps_list = list(lps or [])
    sum_commitments = sum(max(0.0, float(lp.get("commitment_amount") or 0.0)) for lp in lps_list)
    for lp in lps_list:
        lp_committed = max(0.0, float(lp.get("commitment_amount") or 0.0))
        share = (lp_committed / sum_commitments) if sum_commitments > 0 else 0.0
        lp_invested = max(0.0, float(lp.get("invested_amount") or (lp_committed * (invested / committed if committed > 0 else 1.0))))
        lp_payout = lp_total * share
        lp_profit = lp_payout - lp_invested
        lp_rows.append({
            "name": lp.get("name") or "—",
            "commitment_amount": round(lp_committed, 2),
            "invested_amount": round(lp_invested, 2),
            "share_pct": round(share * 100.0, 3),
            "payout": round(lp_payout, 2),
            "profit": round(lp_profit, 2),
            "moic": round(lp_payout / lp_invested, 3) if lp_invested > 0 else 0.0,
        })

    moic = (lp_total / invested) if invested > 0 else 0.0
    if invested > 0 and lp_total > 0 and years > 0:
        irr = ((lp_total / invested) ** (1.0 / years)) - 1.0
    else:
        irr = 0.0

    return {
        "exit_value": round(exit_value, 2),
        "tranches": tranches,
        "totals": {
            "to_lps": round(lp_total, 2),
            "to_gp": round(gp_total, 2),
            "total_distributed": round(total_distributed, 2),
            "lp_moic": round(moic, 3),
            "lp_irr_pct": round(irr * 100.0, 2),
            "total_invested": round(invested, 2),
            "total_committed": round(committed, 2),
            "carry_pct": carry,
            "hurdle_rate": hurdle,
            "years_held": years,
        },
        "lp_rows": lp_rows,
        "assumptions": [
            "European waterfall — whole-of-fund, not deal-by-deal.",
            f"1× return of capital, then {hurdle * 100:.1f}% preferred return compounded over {years:.1f} years.",
            ("100% GP catch-up to carry rate." if gp_catchup else "No GP catch-up."),
            f"Profit split above hurdle: LP {(1 - carry) * 100:.0f}% / GP {carry * 100:.0f}%.",
            "GP commit not modeled. Per-LP rows pro-rated by commitment share.",
        ],
    }
