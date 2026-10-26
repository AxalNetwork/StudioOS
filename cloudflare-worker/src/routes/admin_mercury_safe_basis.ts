/**
 * D966 (#2630) — the owner's repair of Mercury SAFEs accepted before #2629.
 * Mounted at `/api/admin/mercury`, beside `admin_mercury.ts` (D710), whose
 * entity accounts it never reads: the rows it repairs are the founders' own,
 * from their Raise feeds (`services/mercury/safeBasisRepair.ts`).
 *
 * POST /safe-basis-repair
 *   { dry_run?: boolean, reason?: string, after?: number, limit?: 1..100 }
 *   → { dry_run, checked, counts, written, rows, next_after }
 *
 * The guards are D892 §6's reconciliation's (`routes/admin_billing.ts`):
 *   - A DRY RUN UNLESS `dry_run: false`. A dry run reads and needs a Super Admin.
 *   - Writing takes the write bar (a TOTP session, a recent step-up, the
 *     holder) and a reason of 1 to 500 characters.
 *   - Paged by proposal id: `after` (default 0) and `limit` (default 25, at
 *     most 100). `next_after` is set while candidates may remain.
 *   - A row whose write fails is `failed` and the walk goes on, so the answer
 *     is 200 and says which rows were written. Only a page that cannot be
 *     read answers 503, and nothing has been written then.
 *   - Every run, dry or written, is audited once through `logAdminAction`,
 *     with each row's outcome, and that includes a run that fails. The audit
 *     insert stays best-effort (D159). Each written row also has its own
 *     rollback record, written with it (`ROW_AUDIT_ACTION`).
 *   - The recovery cool-off pauses it, dry runs included: the route is on
 *     `index.ts`'s `COOL_OFF_ROUTES`, as `/api/admin/billing` is on its
 *     prefixes, because it writes founders' cap tables.
 *
 * Only an entry that still carries the exact terms the Accept wrote is
 * written; one whose terms moved is `entry_changed`, and one whose repaired
 * inputs fail validation is `inputs_invalid`. Both are left for the owner.
 *
 * The answer and the run's audit hold ids, keys and outcomes: never a name,
 * an email or an amount. The owner runs it against production; no deploy,
 * cron or agent session does.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { refusalBody } from '../util/refusal';
import {
  repairReason, repairSafeBasis, SAFE_BASIS_REPAIR_LIMIT_DEFAULT, SAFE_BASIS_REPAIR_LIMIT_MAX,
} from '../services/mercury/safeBasisRepair';

const adminMercurySafeBasis = new Hono<{ Bindings: Env }>();

adminMercurySafeBasis.post('/safe-basis-repair', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown> | null;
  const write = body?.dry_run === false;
  const admin = write ? await requireSuperAdminWriteBar(c) : await requireSuperAdmin(c);
  const reason = repairReason(body);
  if (write && !reason) {
    return c.json(refusalBody({ code: 'reason_required', message: 'Give a reason of 1 to 500 characters for repairing these cap tables.' }), 400);
  }
  const whole = (v: unknown, fallback: number) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : fallback);
  const after = whole(body?.after, 0);
  const limit = Math.max(1, Math.min(SAFE_BASIS_REPAIR_LIMIT_MAX, whole(body?.limit, SAFE_BASIS_REPAIR_LIMIT_DEFAULT)));
  let result: Awaited<ReturnType<typeof repairSafeBasis>> | null = null;
  try {
    result = await repairSafeBasis(c.env, { write, after, limit, operator: { id: Number(admin.id), email: admin.email }, reason });
  } catch (e) {
    // Only the page read throws, before any row is touched.
    console.warn('[admin/mercury] SAFE basis repair page unreadable', (e as Error).message);
  }
  const rows = result?.rows ?? [];
  await logAdminAction(c.env, admin.id, admin.email, write ? 'mercury_safe_basis_repair' : 'mercury_safe_basis_repair_dry_run', {
    dry_run: !write, after, limit, checked: result?.checked ?? 0, counts: result?.counts ?? null,
    written: result?.written ?? 0, next_after: result?.next_after ?? null,
    // A run spans many ventures, so each row names its own, by id.
    rows: rows.map((r) => ({
      proposal_id: r.proposal_id, project_id: r.project_id, scenario_id: r.scenario_id, entry_key: r.entry_key,
      outcome: r.outcome, variants_untouched: r.variants_untouched,
    })),
    ...(result ? {} : { failed: 'page_unreadable' }),
    ...(reason ? { reason } : {}),
  });
  if (!result) {
    return c.json(refusalBody({
      code: 'repair_unavailable',
      message: 'The accepted SAFEs could not be read. Nothing was written; try again in a moment.',
      audience: 'admin',
    }), 503);
  }
  return c.json({ dry_run: !write, ...result });
});

export default adminMercurySafeBasis;
