/**
 * Task #12 — Stripe Tax (automatic_tax) helpers.
 *
 * `automatic_tax[enabled]=true` is ONLY a valid parameter on Stripe Checkout
 * Sessions, Invoices and Subscriptions — NEVER on raw PaymentIntents (Stripe
 * rejects the unknown param). It also only succeeds once Stripe Tax is
 * activated in the dashboard (origin address + tax registrations) AND the
 * customer has a tax-determinable address. Enabling it before those ops steps
 * are complete makes Stripe reject the create call, so we gate it behind the
 * `STRIPE_TAX_ENABLED` env flag (default OFF). Ops flips the flag on after
 * Stripe Tax is live; until then every charge behaves exactly as before.
 *
 * These functions are intentionally pure (no Stripe / env side effects beyond
 * reading the flag) so they can be unit-tested directly — see
 * `test/stripeTax.test.ts`.
 */

/** Truthy values accepted for the `STRIPE_TAX_ENABLED` flag. */
export function stripeTaxEnabled(env: { STRIPE_TAX_ENABLED?: string }): boolean {
  const v = (env.STRIPE_TAX_ENABLED ?? '').toString().trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Build the `automatic_tax` form params to merge into a Stripe create call.
 * Returns `{}` (a no-op) when tax is disabled so callers can unconditionally
 * spread the result.
 *
 * @param enabled  result of `stripeTaxEnabled(env)`.
 * @param opts.checkout  true when the target is a Checkout Session. Checkout
 *   collects the billing address natively; when an existing `customer` is set
 *   on the session we also pass `customer_update[address]=auto` so the
 *   collected address is saved back to the customer (required for tax to be
 *   recomputed on subscription renewals). `customer_update` is INVALID without
 *   a `customer` (i.e. when only `customer_email` is set, Checkout creates the
 *   customer and saves the address itself), so it is gated on
 *   `opts.hasExistingCustomer`.
 */
export function automaticTaxParams(
  enabled: boolean,
  opts: { checkout?: boolean; hasExistingCustomer?: boolean } = {},
): Record<string, string> {
  if (!enabled) return {};
  const params: Record<string, string> = { 'automatic_tax[enabled]': 'true' };
  if (opts.checkout && opts.hasExistingCustomer) {
    params['customer_update[address]'] = 'auto';
  }
  return params;
}
