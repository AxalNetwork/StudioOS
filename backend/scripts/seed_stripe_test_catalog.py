#!/usr/bin/env python3
"""Mirror the LIVE Stripe catalog into TEST mode so the dev preview can run
real test-mode checkouts against test price IDs.

Idempotent: test products/prices are tagged with metadata `live_product_id` /
`live_price_id`; re-running reuses existing objects instead of duplicating.

Also creates a couple of TEST coupons + promotion codes for promo testing.

Requires env: STRIPE_SECRET_KEY (live, read-only here), STRIPE_TEST_SECRET_KEY.
Run: UV_PROJECT_ENVIRONMENT=.venv uv run python scripts/seed_stripe_test_catalog.py
"""
import json
import os
import sys
import urllib.parse
import urllib.request

LIVE = os.environ["STRIPE_SECRET_KEY"]
TEST = os.environ["STRIPE_TEST_SECRET_KEY"]
API = "https://api.stripe.com/v1"


def call(key, method, path, data=None):
    url = f"{API}{path}"
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data, doseq=True).encode()
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", f"Bearer {key}")
    # Pin an API version where /promotion_codes still accepts `coupon`.
    req.add_header("Stripe-Version", "2023-10-16")
    if body is not None:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:500], file=sys.stderr)
        raise


def flatten(prefix, obj, out):
    """Flatten metadata dict into form params like metadata[key]=value."""
    for k, v in obj.items():
        out[f"{prefix}[{k}]"] = v


def main():
    live_products = call(LIVE, "GET", "/products?limit=100&active=true")["data"]
    live_prices = call(
        LIVE, "GET", "/prices?limit=100&active=true"
    )["data"]

    # index existing test objects by live id (idempotency)
    test_products = call(TEST, "GET", "/products?limit=100")["data"]
    test_prices = call(TEST, "GET", "/prices?limit=100")["data"]
    tp_by_live = {
        p["metadata"].get("live_product_id"): p
        for p in test_products
        if p.get("metadata", {}).get("live_product_id")
    }
    tpr_by_live = {
        pr["metadata"].get("live_price_id"): pr
        for pr in test_prices
        if pr.get("metadata", {}).get("live_price_id")
    }

    live_to_test_product = {}
    for lp in live_products:
        existing = tp_by_live.get(lp["id"])
        if existing:
            live_to_test_product[lp["id"]] = existing["id"]
            print(f"product exists: {lp['name']} -> {existing['id']}")
            continue
        data = {"name": lp["name"]}
        if lp.get("description"):
            data["description"] = lp["description"]
        meta = dict(lp.get("metadata", {}))
        meta["live_product_id"] = lp["id"]
        flatten("metadata", meta, data)
        created = call(TEST, "POST", "/products", data)
        live_to_test_product[lp["id"]] = created["id"]
        print(f"created product: {lp['name']} -> {created['id']}")

    for lpr in live_prices:
        if lpr["id"] in tpr_by_live:
            print(f"price exists: {lpr['id']} -> {tpr_by_live[lpr['id']]['id']}")
            continue
        prod = lpr["product"]
        prod = prod["id"] if isinstance(prod, dict) else prod
        test_prod = live_to_test_product.get(prod)
        if not test_prod:
            print(f"skip price {lpr['id']} (no test product for {prod})")
            continue
        data = {
            "product": test_prod,
            "currency": lpr["currency"],
            "unit_amount": lpr["unit_amount"],
        }
        if lpr.get("nickname"):
            data["nickname"] = lpr["nickname"]
        if lpr.get("type") == "recurring" and lpr.get("recurring"):
            data["recurring[interval]"] = lpr["recurring"]["interval"]
            data["recurring[interval_count]"] = lpr["recurring"].get(
                "interval_count", 1
            )
        meta = dict(lpr.get("metadata", {}))
        meta["live_price_id"] = lpr["id"]
        flatten("metadata", meta, data)
        created = call(TEST, "POST", "/prices", data)
        print(f"created price: {lpr['id']} -> {created['id']} ({lpr['unit_amount']})")

    # --- test coupons + promotion codes (idempotent by code) ---
    existing_codes = {
        pc["code"].upper(): pc
        for pc in call(TEST, "GET", "/promotion_codes?limit=100")["data"]
    }
    wanted = [
        {"code": "WELCOME10", "percent_off": 10},
        {"code": "STUDIO25", "percent_off": 25},
        {"code": "FREEINTRO", "percent_off": 100},
    ]
    for w in wanted:
        if w["code"].upper() in existing_codes:
            print(f"promo exists: {w['code']}")
            continue
        coupon = call(
            TEST,
            "POST",
            "/coupons",
            {"percent_off": w["percent_off"], "duration": "once", "name": w["code"]},
        )
        pc = call(
            TEST,
            "POST",
            "/promotion_codes",
            {"coupon": coupon["id"], "code": w["code"]},
        )
        print(f"created promo: {w['code']} ({w['percent_off']}% off) -> {pc['id']}")

    print("\nDONE. Test catalog mirrored.")


if __name__ == "__main__":
    main()
