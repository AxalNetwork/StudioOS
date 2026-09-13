/**
 * Queue consumer — claims pending jobs and dispatches them to AI/business
 * handlers. Invoked by the cron `scheduled()` handler and by the manual
 * admin trigger POST /api/infra/process.
 *
 * Each job's outcome is logged to system_metrics so the Infrastructure tab
 * can show throughput live.
 */
import type { Env, User } from '../types';
// `QueueJob` and `BuyerCandidate` below are interfaces, so they are imported with
// `type`. Not cosmetic: Node's `--experimental-strip-types` — which this repo's
// own worker-test loader uses — erases the import list literally, and a bare
// `import { QueueJob }` becomes a runtime request for an export that does not
// exist. Task #197 found this the first time any test imported this module.
import { Jobs, type QueueJob } from '../models/jobs';
import { aiScoreDeal } from '../../ai-workers/scoring';
import { aiTractionReview } from '../../ai-workers/traction';
import { aiRecommendEquity } from '../../ai-workers/equity';
import { aiValueAsset, aiMatchBuyers, type BuyerCandidate } from '../../ai-workers/valuation';
import { aiGenerateLPA } from '../../ai-workers/lpa';
import { Listings, Matches } from '../models/liquidity';
import { Funds } from '../models/funds';
import { Distributions } from '../models/distributions';
import { insertCapitalCalls } from '../routes/_capital_call_writes';
import {
  recentSnapshots, metricPointsFrom, recordReview, latestMomentum,
} from './tractionSnapshots';

async function meter(env: Env, jobType: string, status: 'completed' | 'failed', latency: number) {
  try {
    await env.DB.prepare(
      `INSERT INTO system_metrics (metric_name, value, labels) VALUES (?, ?, ?)`
    ).bind('job', 1, JSON.stringify({ job_type: jobType, status, latency_ms: latency })).run();
  } catch {}
}

export async function handleJob(env: Env, job: QueueJob): Promise<void> {
  return handle(env, job);
}

async function handle(env: Env, job: QueueJob): Promise<void> {
  // T8 — payload is opaque JSON. A malformed string (corrupted D1 row,
  // hand-crafted enqueue from /api/infra/enqueue, future schema migration
  // with an old in-flight job, etc.) must NOT throw and trigger a retry
  // loop — the parse will fail identically forever. Log to error_logs and
  // ack-equivalent (return cleanly so the caller marks the job completed
  // / acks the CF message).
  let payload: any = {};
  if (job.payload) {
    try {
      payload = JSON.parse(job.payload);
    } catch (e: any) {
      console.error(`[queueWorker] payload parse failed job=${job.job_type} id=${job.id}: ${e?.message || e}`);
      try {
        await env.DB.prepare(
          `INSERT INTO error_logs (level, source, message, details) VALUES ('ERROR','queueWorker.handle',?,?)`,
        ).bind(
          `Invalid JSON payload for ${job.job_type} job ${job.id}`,
          JSON.stringify({ job_id: job.id, job_type: job.job_type, parse_error: String(e?.message || e), payload_prefix: String(job.payload).slice(0, 200) }),
        ).run();
      } catch {/* best-effort */}
      return; // ack-skip — re-running won't help.
    }
  }
  switch (job.job_type) {
    case 'ai_scoring': {
      // Writes to `ai_score_drafts`, not `score_snapshots` (migration 179).
      // This scorer produces 4 category totals on a 0-75 scale with no
      // sub-scores, no anomaly detection and no integrity stamp; the canonical
      // table is 6 dimensions on 0-100 with all three, and seventeen consumers
      // read it — including the tier decision, whose thresholds a 0-75 total
      // can never reach. The previous INSERT named five columns that do not
      // exist and swallowed the error, so no row was ever written; correcting
      // the names would have started mixing the two instruments instead.
      const result = await aiScoreDeal(env, payload);
      try {
        await env.DB.prepare(
          `INSERT INTO ai_score_drafts (project_id, market_0_25, team_0_20, product_0_15, capital_0_15, total_0_75, rationale, model)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          payload.project_id, result.market, result.team, result.product,
          result.capital, result.total, result.rationale,
          env.AI ? '@cf/meta/llama-3.1-8b-instruct-fp8' : null,
        ).run();
      } catch (e: any) {
        // Logged, not swallowed. A silent catch here is what hid the broken
        // column names for as long as it did.
        console.error('[queueWorker] ai_score_drafts insert failed:', e?.message);
      }
      return;
    }
    case 'traction_review': {
      // WAS DEAD END TO END against the generic-series shape `metrics_snapshots`
      // does not have — `SELECT metric_name, value, captured_at … WHERE scope =
      // 'project'` threw `no such column` before the AI ever ran, and the INSERT
      // after it threw too. See `services/tractionSnapshots.ts` for the whole
      // story and for why the review lands on `ai_review` rather than in a new
      // table or on `traction_score`.
      const projectId = Number(payload.project_id);
      if (!projectId) throw new Error('missing project_id');
      const rows = await recentSnapshots(env, projectId);
      const snapshots = metricPointsFrom(rows);
      const result = await aiTractionReview(env, { project_id: projectId, snapshots });
      // NOTHING TO ANNOTATE IS NOT A FAILURE. A venture whose metrics nobody has
      // entered has no snapshot to carry a review, and throwing here would put
      // the job back to `pending` to fail again on every retry for as long as the
      // venture stays un-measured.
      if (!rows.length) {
        console.warn(`[queueWorker] traction_review: project ${projectId} has no metrics snapshot to review`);
        return;
      }
      await recordReview(env, rows[0].id, {
        momentum: result.momentum,
        trend: result.trend,
        summary: result.summary,
        reviewed_at: new Date().toISOString(),
        // The count the review was actually based on. `aiTractionReview` returns
        // `momentum: 0` with "No metrics captured yet" for an empty input, and a
        // reader cannot otherwise tell that zero from a genuine zero.
        points: snapshots.length,
      });
      return;
    }
    case 'spinout_processing': {
      // Move spin-out to next state if guard passes
      const subId = payload.subsidiary_id;
      const target = payload.target_status;
      if (!subId || !target) throw new Error('missing subsidiary_id/target_status');
      await env.DB.prepare(
        `UPDATE subsidiaries SET spinout_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(target, subId).run();
      return;
    }
    case 'capital_call': {
      const fundId = payload.fund_id;
      const amount = Number(payload.amount) || 0;
      if (!fundId) throw new Error('missing fund_id');
      await env.DB.prepare(
        `UPDATE vc_funds SET deployed_capital = deployed_capital + ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(amount, fundId).run();
      return;
    }
    case 'pipeline_advance': {
      const dealId = payload.deal_id;
      const stage = payload.next_stage;
      if (!dealId || !stage) throw new Error('missing deal_id/next_stage');
      await env.DB.prepare(
        `UPDATE deals SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(stage, dealId).run();
      // Task #2 — mirror queue-driven stage transitions to HubSpot in
      // near-real-time so reconciliation isn't waiting on the 30-min cron.
      // Best-effort; failures land in integration_logs via the autopush
      // helper, never blocking the queue worker.
      try {
        const owner = await env.DB.prepare(
          'SELECT f.user_id AS founder_user_id FROM deals d ' +
          'LEFT JOIN projects p ON p.id = d.project_id ' +
          'LEFT JOIN founders f ON f.id = p.founder_id WHERE d.id = ?',
        ).bind(dealId).first<{ founder_user_id: number | null }>();
        const founderUserId = owner?.founder_user_id ?? null;
        if (founderUserId) {
          const { schedulePushFromEnv } = await import('../integrations/autopush');
          schedulePushFromEnv({
            env, user: { id: founderUserId } as User, providerKey: 'hubspot',
            payload: { deal_id: dealId },
            eventType: 'auto_push:queue_pipeline_advance',
          });
        }
      } catch (e) {
        console.warn('[queue] pipeline_advance hubspot autopush failed', (e as Error).message);
      }
      return;
    }
    case 'metrics_aggregation': {
      // Roll up project metrics into a global counter.
      //
      // WRITES `system_metrics`, NOT `metrics_snapshots`. The old INSERT named
      // `scope, scope_id, metric_name, value` on a DEAL metrics table and threw
      // `no such column`, so this counter has never once been recorded. A global
      // figure has no `deal_id` and never belonged in that table — and the
      // generic named series it wanted already exists as `system_metrics`
      // (`metric_name, value, labels`), which `meter()` twenty lines up writes to
      // on every job and `analyticsReports.ts` reads in five places.
      //
      // Safe to add a name there: every existing read filters
      // `metric_name = 'request'`, so `projects_24h` rows pollute nothing. The
      // `labels` JSON carries the window so a reader is never guessing what "24h"
      // was measured from.
      const totals = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM projects WHERE created_at > datetime('now','-1 day')`
      ).first<{ n: number }>();
      await env.DB.prepare(
        `INSERT INTO system_metrics (metric_name, value, labels) VALUES ('projects_24h', ?, ?)`
      ).bind(totals?.n ?? 0, JSON.stringify({
        window: '24h',
        trigger: typeof payload.trigger === 'string' ? payload.trigger : null,
      })).run();
      return;
    }
    case 'liquidity_valuation': {
      const listingId = payload.listing_id;
      const subId = payload.subsidiary_id;
      if (!listingId || !subId) throw new Error('missing listing_id/subsidiary_id');
      const sub: any = await env.DB.prepare(
        `SELECT s.*, p.sector, p.stage FROM subsidiaries s
         LEFT JOIN projects p ON p.id = s.deal_id WHERE s.id = ?`
      ).bind(subId).first();
      const lastScore: any = await env.DB.prepare(
        `SELECT total_score FROM score_snapshots WHERE project_id = ?
         ORDER BY id DESC LIMIT 1`
      ).bind(sub?.deal_id ?? 0).first();
      // THE SHARPEST CONSEQUENCE OF THE COLLISION WAS HERE, not in the job the
      // task was filed about. This read named `scope`, `scope_id`, `metric_name`
      // and `value` — four columns `metrics_snapshots` does not have — and it sits
      // BEFORE `Listings.updateValuation`, with no catch between. So the whole
      // valuation job threw: a founder listed a subsidiary for sale,
      // `ai_valuation_cents` stayed NULL, and `LiquidityPage.jsx:562` rendered
      // "— pending" for that listing forever.
      //
      // `latestMomentum` reads it out of the review JSON and returns null rather
      // than throwing on a row it cannot parse — because a valuation that dies on
      // a malformed annotation is the failure this line already caused once.
      const momentum = await latestMomentum(env, Number(sub?.deal_id ?? 0));
      const result = await aiValueAsset(env, {
        subsidiary_id: subId,
        subsidiary_name: sub?.subsidiary_name,
        deal_id: sub?.deal_id,
        sector: sub?.sector,
        stage: sub?.stage,
        total_score: lastScore?.total_score,
        momentum: momentum ?? undefined,
      });
      await Listings.updateValuation(env, listingId, result.valuation_cents);
      return;
    }
    case 'liquidity_matching': {
      const listingId = payload.listing_id;
      if (!listingId) throw new Error('missing listing_id');
      const listing = await Listings.getById(env, listingId);
      if (!listing) throw new Error(`listing ${listingId} not found`);
      const subRow: any = await env.DB.prepare(
        `SELECT s.subsidiary_name, p.sector FROM subsidiaries s
         LEFT JOIN projects p ON p.id = s.deal_id WHERE s.id = ?`
      ).bind(listing.subsidiary_id).first();
      // Candidates: any partner + any LP user (excluding the seller themself).
      const cands = await env.DB.prepare(
        `SELECT u.id AS user_id, u.email, u.name, u.role,
                COALESCE(SUM(lp.commitment_amount - lp.invested_amount), 0) AS available_capital
           FROM users u LEFT JOIN limited_partners lp ON lp.user_id = u.id
          WHERE u.id != ? AND (u.role = 'partner' OR u.role = 'investor' OR lp.id IS NOT NULL)
          GROUP BY u.id LIMIT 50`
      ).bind(listing.user_id).all<{ user_id: number; email: string; name: string; role: any; available_capital: number }>();
      const candidates: BuyerCandidate[] = (cands.results || []).map(r => ({
        user_id: r.user_id,
        email: r.email,
        name: r.name,
        role: r.role,
        available_capital_cents: Math.round((r.available_capital || 0) * 100),
        preferred_sectors: subRow?.sector ? [subRow.sector] : [],
      }));
      const matches = await aiMatchBuyers(env, {
        id: listing.id,
        subsidiary_name: subRow?.subsidiary_name,
        sector: subRow?.sector,
        shares: listing.shares,
        asking_price_cents: listing.asking_price_cents,
        ai_valuation_cents: listing.ai_valuation_cents,
      }, candidates, 5);
      await Matches.insertMany(env, listing.id, matches);
      if (matches.length) await Listings.markMatched(env, listing.id);
      return;
    }
    case 'lpa_generation': {
      const fundId = payload.fund_id;
      if (!fundId) throw new Error('missing fund_id');
      const fund = await Funds.getById(env, fundId);
      if (!fund) throw new Error(`fund ${fundId} not found`);
      // Skip if an LPA is already on file.
      if (fund.lpa_doc_id) return;
      const body = await aiGenerateLPA(env, {
        fund_name: fund.name,
        vintage_year: fund.vintage_year,
        fund_size_cents: fund.fund_size_cents ?? 0,
        carried_interest: fund.carried_interest ?? 0.20,
        management_fee: fund.management_fee ?? 0.02,
      });
      // Store in legal_documents under fund_id (deal_id=0 sentinel for fund-level docs).
      const doc: any = await env.DB.prepare(
        `INSERT INTO legal_documents (deal_id, fund_id, type, status, content, generated_by, version)
         VALUES (0, ?, 'LPA', 'generated', ?, NULL, 1) RETURNING id`
      ).bind(fundId, body).first();
      if (doc?.id) await Funds.setLpaDoc(env, fundId, doc.id);
      return;
    }
    case 'capital_call_notice': {
      // A GP's capital call: one `capital_calls` ledger row per LP and a pro-rata
      // notice to each. Nothing else — see the note at the end of this case about
      // the `deployed_capital` bump that used to live here and why it left.
      //
      // TASK #197 ADDED THE LEDGER ROWS, WHICH WERE THE MISSING HALF. Before
      // this, a call produced an activity_log line and a moved dashboard number
      // and nothing else — while `PartnerPortal.jsx` and `CapitalPage.jsx` both
      // read `capital_calls` through `api.listCapitalCalls()` and both carry a
      // working Pay button over it. The receivable a GP had just issued existed
      // nowhere, so there was nothing to pay.
      //
      // AND THE REASON THIS HANDLER IS WRITTEN THE WAY IT IS: **it gets re-run.**
      // On the D1 path `Jobs.markFailed` puts the same row back to `pending`; on
      // the CF Queue path the consumer DELETES its idempotency claim in the
      // failure branch on purpose, "so a CF retry actually re-runs the handler".
      // `claimDelivery` only dedupes concurrent redeliveries of one message — its
      // own comment names the race it closed as the one where "both run the job
      // and we double-charge LPs". So every effect below has to be once-only by
      // construction, or a retry turns a missing receivable into a doubled one.
      const fundId = payload.fund_id;
      const amountCents = Math.round(payload.amount_cents ?? 0);
      if (!fundId || amountCents <= 0) throw new Error('fund_id and amount_cents required');
      const lps = await env.DB.prepare(
        `SELECT lp.*, u.email, u.name AS user_name FROM limited_partners lp
         LEFT JOIN users u ON u.id = lp.user_id
         WHERE lp.fund_id = ? AND lp.status IN ('committed','active')`
      ).bind(fundId).all<{ id: number; user_id: number; email: string; commitment_amount: number }>();
      const rows = lps.results || [];
      if (!rows.length) return;
      const totalCommit = rows.reduce((s, r) => s + Number(r.commitment_amount || 0), 0);
      if (totalCommit <= 0) return;
      const amountDollars = amountCents / 100;

      // The call's identity, minted by the enqueueing route. A payload without
      // one predates this change or came from `/api/infra/enqueue` by hand; it
      // still has to work, so it falls back to the fund and the amount — which
      // means such a call is deduped per AMOUNT rather than per press, and two
      // identical hand-enqueued calls would collapse into one. That is the right
      // trade for a path nobody presses: a lost duplicate beats a doubled
      // receivable.
      const callUid = String(payload.call_uid || '').trim()
        || `legacy:${fundId}:${amountCents}`;
      const dueDate = typeof payload.due_date === 'string' && payload.due_date.trim()
        ? payload.due_date.trim() : null;

      // Each LP's share, computed ONCE so the ledger row and the notice text
      // cannot disagree about what this LP owes.
      const shares = rows.map((lp) => ({
        lp,
        share: (Number(lp.commitment_amount || 0) / totalCommit) * amountDollars,
      }));

      // A zero share means an LP with no commitment. A zero-dollar receivable is
      // noise on a page whose job is to say what is owed, so it is skipped here
      // rather than rejected in the writer — `POST /capital/capitalCall` still
      // accepts 0 and this is not the place to change that.
      const billable = shares.filter((s) => s.share > 0);
      if (!billable.length) return;

      // ONE ROW PER LP, IDEMPOTENT ON `uid`. `insertCapitalCalls` batches them
      // into a single round-trip and reports which ones were actually new.
      const writes = await insertCapitalCalls(env, billable.map(({ lp, share }) => ({
        limitedPartnerId: lp.id,
        amount: share,
        dueDate,
        uid: `cc:${callUid}:${lp.id}`,
      })));

      // Notices go ONLY to the LPs whose row was just created, so a retry that
      // fills in the rows it missed does not tell everyone again.
      const notices = billable
        .map((s, i) => ({ ...s, inserted: writes[i]?.inserted }))
        .filter((s) => s.inserted)
        .map(({ lp, share }) => env.DB.prepare(
          `INSERT INTO activity_logs (action, details, actor, user_id)
           VALUES ('capital_call_notice', ?, 'system', ?)`
        ).bind(
          `Capital call from fund #${fundId}: $${share.toFixed(2)} due (pro-rata of $${amountDollars.toFixed(0)}).`,
          lp.user_id ?? null,
        ));
      if (notices.length) await env.DB.batch(notices);

      // AND THIS HANDLER NO LONGER TOUCHES `vc_funds.deployed_capital`. It used
      // to bump it by the call amount here, and removing that is a deliberate,
      // visible behaviour change — a fund dashboard no longer advances the moment
      // a call is issued, only when an LP pays.
      //
      // WRITING THE LEDGER ROW IS WHAT FORCED IT. `POST /capital/calls/:id/pay`
      // already does `deployed_capital += call.amount` when an LP actually pays
      // (`routes/capital.ts`), and `test/capital.test.ts` pins that: a 500 call
      // marked paid leaves `deployed_capital` at 500. Until now the two could not
      // both fire for one call, because there was no row to pay. The moment this
      // job creates the row, issuing and then paying would count the same money
      // twice on an investor's dashboard.
      //
      // Of the three ways out, only this one is sound. Keeping both and
      // suppressing the pay-path bump per row needs a marker and leaves the
      // figure meaning neither called nor deployed; dropping the PAY bump instead
      // would contradict an existing money invariant to fit a new feature. So the
      // issuance bump goes, which is also the only option the readers agree with:
      // `FundPerformancePage` labels this figure "Invested into portfolio",
      // `InvestorFundLanding` shows Deployed beside Called expecting
      // called ≥ deployed, and `services/fundRollup.ts` records that a call is not
      // a dated cash receipt at all — which is why it refuses to compute IRR.
      //
      // What a GP loses is a number that moved on a notice that might never be
      // paid. What they gain is `capital_calls`, which says who owes what.
      return;
    }
    case 'returns_distribution': {
      // Calculate pro-rata distributions to LPs of an EXPLICITLY targeted fund.
      // We refuse to fan out across funds without operator targeting — silently
      // splitting proceeds across unrelated funds would corrupt LP ledgers.
      const eventId = payload.liquidity_event_id;
      const fundIdHint = payload.fund_id;
      const proceedsCents = Math.round(payload.proceeds_cents ?? 0);
      const subId = payload.subsidiary_id;
      if (!eventId || proceedsCents <= 0) throw new Error('liquidity_event_id + proceeds_cents required');
      if (!fundIdHint) {
        // Fail loudly into DLQ so an admin can re-run with an explicit fund_id.
        throw new Error('fund_id required: returns_distribution refuses to fan out across funds');
      }
      const fundIds: number[] = [fundIdHint];

      for (const fundId of fundIds) {
        const fund = await Funds.getById(env, fundId);
        if (!fund) continue;
        const lps = await env.DB.prepare(
          `SELECT id, commitment_amount, invested_amount FROM limited_partners
           WHERE fund_id = ? AND status IN ('committed','active')`
        ).bind(fundId).all<{ id: number; commitment_amount: number; invested_amount: number }>();
        const rows = lps.results || [];
        const totalCommit = rows.reduce((s, r) => s + Number(r.commitment_amount || 0), 0);
        if (!rows.length || totalCommit <= 0) continue;

        // Apply carry on profit portion only. Without per-LP basis tracking we
        // approximate basis as the sum of invested_amount; the rest is profit.
        const totalInvested = rows.reduce((s, r) => s + Number(r.invested_amount || 0), 0) * 100; // -> cents
        const grossCents = proceedsCents;        // single targeted fund
        const basisReturnCents = Math.min(grossCents, Math.round(totalInvested));
        const profitCents = Math.max(0, grossCents - basisReturnCents);
        const carryCents = Math.round(profitCents * (fund.carried_interest ?? 0.20));
        const distributableCents = grossCents - carryCents;

        const items = rows.map(lp => {
          const share = Number(lp.commitment_amount || 0) / totalCommit;
          return {
            fund_id: fundId,
            lp_id: lp.id,
            amount_cents: Math.round(distributableCents * share),
            distribution_type: profitCents > 0 ? 'exit_proceeds' as const : 'return_of_capital' as const,
            source_liquidity_event_id: eventId,
            status: 'pending' as const,
            notes: subId ? `From subsidiary #${subId}` : null,
          };
        }).filter(d => d.amount_cents > 0);

        await Distributions.insertMany(env, items);
      }
      return;
    }
    case 'embed_entity': {
      // Vectorize re-index for a single entity. Cheap (Workers AI bge-base) so
      // we run it inline; failures are non-fatal — search just lags by one job.
      const { embedAndUpsertById } = await import('./vectorize');
      const type = payload.type;
      const id = Number(payload.id);
      if (!type || !id) throw new Error('embed_entity requires {type,id}');
      await embedAndUpsertById(env, type, id);
      return;
    }
    case 'embed_delete': {
      const { deleteEntity } = await import('./vectorize');
      const type = payload.type;
      const id = Number(payload.id);
      if (!type || !id) throw new Error('embed_delete requires {type,id}');
      await deleteEntity(env, type, id);
      return;
    }
    case 'score_hash_audit': {
      // Nightly: re-verify every non-sandbox approved snapshot's HMAC. We page
      // through the entire dataset (id-cursor) so coverage doesn't degrade as
      // the table grows. Mismatches are logged to error_logs + system_metrics
      // and the row is downgraded to 'flagged' so it disappears from LP/partner
      // views immediately. `payload.page_size` (default 500) caps each batch.
      const { verifyScoreHash } = await import('./scoreIntegrity');
      const { notifyAdminsOfFlaggedScore } = await import('./notifications');
      const flagged: Array<{ snapshotId: number; projectId: number; totalScore: number | null; reason: string }> = [];
      const pageSize = Math.max(50, Math.min(2000, Number(payload.page_size) || 500));
      let cursor = 0;
      let checked = 0, mismatched = 0, missing = 0;
      // Loop until a page returns fewer rows than pageSize.
      // Hard cap iterations as a safety net against runaway loops.
      for (let iter = 0; iter < 1000; iter++) {
        const rows = await env.DB.prepare(
          `SELECT id, project_id, total_score, integrity_hash, integrity_version,
                  created_at, admin_review_status
             FROM score_snapshots
            WHERE is_sandbox = 0
              AND admin_review_status IN ('auto_approved','approved')
              AND id > ?
            ORDER BY id ASC LIMIT ?`,
        ).bind(cursor, pageSize).all<any>();
        const batch = rows.results || [];
        if (batch.length === 0) break;
        for (const row of batch) {
          checked++;
          cursor = Math.max(cursor, Number(row.id));
          if (!row.integrity_hash) {
            missing++;
            await env.DB.prepare(
              `UPDATE score_snapshots SET admin_review_status='flagged',
                  anomaly_flags = COALESCE(anomaly_flags, '[]')
                WHERE id = ?`,
            ).bind(row.id).run().catch(() => {});
            flagged.push({ snapshotId: Number(row.id), projectId: Number(row.project_id), totalScore: row.total_score ?? null, reason: 'missing_hash' });
            continue;
          }
          const v = await verifyScoreHash(env, row);
          if (!v.valid) {
            mismatched++;
            await env.DB.prepare(
              `UPDATE score_snapshots
                  SET admin_review_status='flagged',
                      anomaly_flags = json_insert(COALESCE(anomaly_flags,'[]'), '$[#]',
                        json_object('type','hash_mismatch','severity','high','detail',?))
                WHERE id = ?`,
            ).bind(v.reason || 'mismatch', row.id).run().catch(async () => {
              // json_insert may not exist on older D1; fall back to plain status flip.
              await env.DB.prepare(
                `UPDATE score_snapshots SET admin_review_status='flagged' WHERE id = ?`,
              ).bind(row.id).run().catch(() => {});
            });
            await env.DB.prepare(
              `INSERT INTO error_logs (level, source, message, details)
               VALUES ('ERROR','score_hash_audit', ?, ?)`,
            ).bind(
              `Hash mismatch on score_snapshots.id=${row.id}`,
              JSON.stringify({ snapshot_id: row.id, project_id: row.project_id, reason: v.reason }),
            ).run().catch(() => {});
            flagged.push({ snapshotId: Number(row.id), projectId: Number(row.project_id), totalScore: row.total_score ?? null, reason: v.reason || 'hash_mismatch' });
          }
        }
        if (batch.length < pageSize) break;
      }
      await env.DB.prepare(
        `INSERT INTO system_metrics (metric_name, value, labels) VALUES ('score_hash_audit', ?, ?)`,
      ).bind(checked, JSON.stringify({ checked, mismatched, missing })).run().catch(() => {});
      // Page admins for each newly-downgraded row. notifyAdminsOfFlaggedScore
      // is idempotent per snapshot, so re-runs of this audit don't double-page.
      for (const f of flagged) {
        try {
          let projectName: string | null = null;
          try {
            const p: any = await env.DB.prepare(`SELECT name FROM projects WHERE id = ?`).bind(f.projectId).first();
            projectName = p?.name ?? null;
          } catch {}
          await notifyAdminsOfFlaggedScore(env, {
            snapshotId: f.snapshotId,
            projectId: f.projectId,
            projectName,
            totalScore: f.totalScore,
            flags: [{
              type: f.reason === 'missing_hash' ? 'missing_hash' : 'hash_mismatch',
              severity: 'high',
              detail: f.reason,
            }],
            source: 'hash_audit',
          });
        } catch (e) { console.error('[score_hash_audit] notify failed', e); }
      }
      return;
    }
    case 'flagged_score_digest': {
      // Daily digest of flagged-but-unreviewed snapshots older than 24h.
      const { digestUnreviewedFlaggedScores } = await import('./notifications');
      await digestUnreviewedFlaggedScores(env);
      return;
    }
    case 'mi_extract': {
      // Task #6 (AT-1) — runs the six extractors over one advisor answer.
      // Idempotent via UNIQUE(extractor, user_id, advisor_answer_id, content_hash).
      const { runExtractorsForAnswer } = await import('./market_intel/extractors');
      const { ensureExtractorSchema } = await import('./market_intel/extractor_schema');
      await ensureExtractorSchema(env);
      await runExtractorsForAnswer({
        env,
        userId: Number(payload.user_id),
        persona: String(payload.persona || 'unknown'),
        questionId: String(payload.question_id || ''),
        rawValue: String(payload.raw_value || ''),
        advisorAnswerId: payload.advisor_answer_id != null ? Number(payload.advisor_answer_id) : null,
      });
      return;
    }
    case 'mi_reduce': {
      // Task #6 (AT-1) — full reducer sweep + opt-out purge. Triggered
      // by the nightly cron (02:15 UTC) and on-demand from
      // /api/infra/process. Stats land in system_metrics via meter().
      const { runReducer } = await import('./market_intel/reducer');
      const { ensureExtractorSchema } = await import('./market_intel/extractor_schema');
      await ensureExtractorSchema(env);
      const r = await runReducer(env, payload?.since_iso ? { sinceIso: String(payload.since_iso) } : undefined);
      console.info(`[mi.reducer] cells=${r.cells_written} suppressed=${r.cells_suppressed} fit_pairs=${r.fit_pairs_written} purged=${r.optout_purged}`);
      return;
    }
    case 'email_send': {
      // Task #2 (IB) — transactional email delivery. Payload is the
      // rendered envelope produced by services/email/send.ts (subject,
      // text, html, from, reply_to, list_unsubscribe, log_id, …).
      // Failure throws so Cloudflare Queues retries up to max_retries
      // and then DLQs onto studioos-job-queue-dlq.
      const { deliverNow } = await import('./email/send');
      const ok = await deliverNow(env, payload);
      if (!ok) throw new Error(`email_send failed template=${payload?.template_key} log=${payload?.log_id}`);
      return;
    }
    case 'incorporation_packet_start': {
      // Task #11 — downstream seam: advances status to 'packet_processing'.
      // The real packet-build pipeline (eSign PDF assembler) will be wired
      // here by a separate task. For now, the queue handler just sets the
      // state so the success-page poll knows work started.
      const { startIncorporationPacket } = await import('./incorporations');
      const id = Number(payload.incorporation_id ?? 0);
      if (!id) throw new Error('incorporation_packet_start requires incorporation_id');
      await startIncorporationPacket(env, id);
      return;
    }
    default:
      throw new Error(`unknown job type ${job.job_type}`);
  }
}

// AI calls are expensive — cap per drain so a backlog doesn't burn the AI quota.
const AI_JOB_TYPES = new Set(['ai_scoring', 'traction_review', 'liquidity_valuation', 'liquidity_matching', 'lpa_generation']);
const MAX_AI_PER_DRAIN = 5;

export async function processQueueBatch(env: Env, batchSize = 10): Promise<{ processed: number; failed: number; deferred: number }> {
  const jobs = await Jobs.claimBatch(env, batchSize);
  let processed = 0, failed = 0, deferred = 0, aiUsed = 0;
  for (const job of jobs) {
    // AI budget enforcement: defer extra AI jobs back to pending so they run next minute.
    if (AI_JOB_TYPES.has(job.job_type) && aiUsed >= MAX_AI_PER_DRAIN) {
      await env.DB.prepare(
        `UPDATE queue_jobs SET status='pending', attempts = attempts - 1, started_at = NULL, updated_at = datetime('now') WHERE id = ?`
      ).bind(job.id).run().catch(() => {});
      deferred++;
      continue;
    }
    if (AI_JOB_TYPES.has(job.job_type)) aiUsed++;

    const t0 = Date.now();
    try {
      await handle(env, job);
      await Jobs.markCompleted(env, job.id);
      processed++;
      await meter(env, job.job_type, 'completed', Date.now() - t0);
    } catch (e: any) {
      failed++;
      await Jobs.markFailed(env, job.id, String(e?.message || e));
      await meter(env, job.job_type, 'failed', Date.now() - t0);
    }
  }
  return { processed, failed, deferred };
}

/** Lightweight equity helper for the spin-out flow. */
export async function recommendEquityForSpinout(env: Env, subsidiaryId: number) {
  const sub: any = await env.DB.prepare(`SELECT * FROM subsidiaries WHERE id = ?`).bind(subsidiaryId).first();
  if (!sub) throw new Error('subsidiary not found');
  // Minimal contributor list (extend with real founders/partners join when wired).
  const contributors = [
    { name: 'Axal Studio', role: 'studio' as const, impact_tier: 1 as const },
    { name: 'Founders', role: 'founder' as const, impact_tier: 1 as const },
  ];
  return aiRecommendEquity(env, contributors, { spinout_name: sub.subsidiary_name });
}
