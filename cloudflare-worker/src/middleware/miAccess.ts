import type { Context } from 'hono';
import type { Env, User } from '../types';

// Epic 6 — per-feature paywall map. Each Pro feature has a stable key the
// frontend matches on to render the right upsell copy. Keys are short and
// stable; never change them without bumping the frontend modal too.
export type MiFeature =
  | 'market_pulse_full'        // full sector list + live headlines
  | 'macro_full'               // full sector grid + live quotes
  | 'private_rounds_full'      // beyond 30 days of rounds
  | 'competitive_full'         // full competitive deck + AI memo
  | 'studio_benchmarks'        // peer-studio benchmarks
  | 'watchlists'               // custom watchlists with alerts
  | 'semantic_search'          // semantic search across MI corpus
  | 'export_csv'               // CSV / API export
  | 'weekly_pdf';              // weekly white-label PDF

export interface MiUpsellPayload {
  error: 'mi_pro_required';
  feature: MiFeature;
  message: string;
  products: Array<{ id: 'mi_pro_monthly' | 'mi_pro_annual'; label: string; price_label: string }>;
  checkout_path: string;
}

export const MI_PRO_PRODUCTS: MiUpsellPayload['products'] = [
  { id: 'mi_pro_monthly', label: 'Monthly', price_label: '$49 / month' },
  { id: 'mi_pro_annual',  label: 'Annual',  price_label: '$490 / year — save 17%' },
];

const FEATURE_COPY: Record<MiFeature, string> = {
  market_pulse_full:   'See every sector signal and live headlines with Market Intel Pro.',
  macro_full:          'Unlock the full sector grid and live tech quotes with Market Intel Pro.',
  private_rounds_full: 'Free covers the last 30 days. Pro unlocks the full private-rounds history.',
  competitive_full:    'Pro unlocks the full competitive deck plus the AI memo for each play.',
  studio_benchmarks:   'Peer-studio benchmarks are a Pro feature. Compare your studio against the rest.',
  watchlists:          'Custom watchlists with alerts are a Pro feature.',
  semantic_search:     'Semantic search across the Market Intel corpus is a Pro feature.',
  export_csv:          'CSV and API export are Pro features.',
  weekly_pdf:          'The weekly white-label PDF is a Pro feature.',
};

/** Build the 402 payload the frontend renders as an upsell modal. */
export function miUpsell(feature: MiFeature): MiUpsellPayload {
  return {
    error: 'mi_pro_required',
    feature,
    message: FEATURE_COPY[feature],
    products: MI_PRO_PRODUCTS,
    checkout_path: '/api/billing/mi-pro/checkout',
  };
}

/** True when the user has an active Pro subscription. Admins always pass. */
export function userHasMiPro(user: User | null): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const status = (user as User & { mi_subscription_status?: string }).mi_subscription_status;
  return status === 'active' || status === 'trialing';
}

/**
 * Throw a 402-shaped Hono response if the user lacks Pro access for `feature`.
 * Routes call this at the top of the handler instead of guessing the gate.
 */
export function requireMiPro(c: Context<{ Bindings: Env }>, user: User | null, feature: MiFeature): void {
  if (userHasMiPro(user)) return;
  // Hono lets us throw a Response to short-circuit. The global error handler
  // in index.ts turns this into a normal JSON response — no extra plumbing.
  throw new Response(JSON.stringify(miUpsell(feature)), {
    status: 402,
    headers: { 'Content-Type': 'application/json' },
  });
}

let migrated = false;
/**
 * Idempotent schema bootstrap for MI Pro. The `users` table is at D1's hard
 * 100-column limit, so MI Pro subscription state CANNOT live as new columns on
 * `users` (ALTER ADD COLUMN throws "too many columns" and used to 500 every
 * Stripe webhook). It lives in its own side table keyed by user_id instead —
 * hydrated onto the user object at auth time. See
 * .agents/memory/d1-users-column-limit.md. CREATE ... IF NOT EXISTS is safe to
 * re-run, so no per-statement try/catch is needed.
 */
export async function ensureMiPaywallSchema(env: Env): Promise<void> {
  if (migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS mi_pro_subscriptions (
       user_id INTEGER PRIMARY KEY,
       status TEXT NOT NULL DEFAULT 'free',
       subscription_id TEXT,
       plan TEXT,
       period_end TEXT,
       stripe_customer_id TEXT,
       updated_at TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_mi_pro_customer ON mi_pro_subscriptions(stripe_customer_id)`,
    // UNIQUE — must match migration 103. A Stripe subscription_id identifies at
    // most one row; the webhook's subscription_id-scoped writes rely on it.
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mi_pro_subscription ON mi_pro_subscriptions(subscription_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mi_pro_status ON mi_pro_subscriptions(status)`,
  ];
  for (const s of stmts) {
    await env.DB.prepare(s).run();
  }
  migrated = true;
}
