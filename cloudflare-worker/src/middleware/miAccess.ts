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
 * Idempotent column bootstrap for D1. Each ALTER is wrapped individually
 * because SQLite throws "duplicate column" on re-add and we want the rest
 * of the statements to still run on first boot. The flag only flips after
 * every statement either succeeded or harmlessly failed on duplicate.
 */
export async function ensureMiPaywallSchema(env: Env): Promise<void> {
  if (migrated) return;
  const stmts = [
    `ALTER TABLE users ADD COLUMN mi_subscription_status TEXT NOT NULL DEFAULT 'free'`,
    `ALTER TABLE users ADD COLUMN mi_subscription_id TEXT`,
    `ALTER TABLE users ADD COLUMN mi_subscription_plan TEXT`,
    `ALTER TABLE users ADD COLUMN mi_subscription_period_end TIMESTAMP`,
    `ALTER TABLE users ADD COLUMN mi_stripe_customer_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_users_mi_status ON users(mi_subscription_status)`,
    `CREATE INDEX IF NOT EXISTS idx_users_mi_customer ON users(mi_stripe_customer_id)`,
  ];
  for (const s of stmts) {
    try {
      await env.DB.prepare(s).run();
    } catch (e) {
      const msg = (e as Error).message || '';
      // SQLite emits "duplicate column name" once a column exists. Anything
      // else is a real schema error and we want the next request to retry.
      if (!/duplicate column/i.test(msg)) throw e;
    }
  }
  migrated = true;
}
