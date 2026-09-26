/**
 * What HQ answers when a branch asks — as plain functions (D108).
 *
 * The mirror of `branchOps.ts`, and split from the entrypoint class for the
 * same reason: `cloudflare:workers` does not exist under `node --test`, so
 * logic that lived in the class could only be verified by deploying.
 *
 * THE CALLER'S CODE IS AN ARGUMENT, AND THAT IS THE WHOLE SECURITY MODEL HERE.
 * D.7 records the one thing a service binding does not give you: a callee
 * cannot see which binding called it. So every branch→HQ call passes its own
 * `BRANCH_CODE`, and HQ cannot verify it from the transport. Three
 * consequences, each deliberate:
 *
 *   - The code is validated against the same regex `branchOf` uses, so a
 *     malformed one is refused rather than written into a row.
 *   - It is checked against `licence_deployments`, so a code HQ has never
 *     provisioned cannot file an escalation. That is the check that makes the
 *     stamp mean something, and it is why migration 258 lands in the same PR.
 *   - It is NOT enough for a call whose answer or whose effect is about money.
 *     Those carry a per-deployment secret verified against `rpc_secret_hash`:
 *     `reportUsage` (D111), which feeds a statement, and since D244 `licence`,
 *     which hands back a licence's fees, revenue share and signatory. Saying
 *     so here rather than leaving the asymmetry to be discovered.
 *
 * An entrypoint is callable by any Worker in the account. The account is ours,
 * so this is not an authentication boundary — it is an attribution one, and
 * the difference is worth stating because treating it as the former is how a
 * binding ends up trusted for something it cannot establish.
 */
import type { Env } from '../types';
import { branchOf, BRANCH_CODE_RE } from '../util/branch';
import { PERIOD_RE } from '../services/statements';
import { verifySecret } from './secret';
import { assembleLicenceRecord } from '../services/licencePush';

/** The four things a branch cannot decide for itself (migration 259). */
export const ESCALATION_KINDS = ['moderation', 'content', 'seat_increase', 'other'] as const;
export type EscalationKind = (typeof ESCALATION_KINDS)[number];

/** Hours a kind gets before it is past SLA, per the subsidiary canvas's bands. */
export const SLA_HOURS: Record<EscalationKind, number> = {
  moderation: 24,
  content: 72,
  seat_increase: 72,
  other: 72,
};

/**
 * D206 — the one sentence for the one kind a licence can hide (canvas H30,
 * verbatim). A white-label's admins have no HQ brand desk, so "content for
 * brand approval" is an escalation they could raise and nobody could answer.
 */
export const WHITE_LABEL_CONTENT_HIDDEN =
  'Hidden for this kind — there is no brand desk to send it to.';

export type EscalationKindAvailability = {
  /** What the licence says it is, or null when nothing says. */
  licence_kind: string | null;
  /** Whether that kind is one this rule recognises. */
  known: boolean;
  available: EscalationKind[];
  hidden: { kind: EscalationKind; reason: string }[];
};

/**
 * D206 — which escalation kinds a branch may raise, by the KIND of licence it
 * runs under (migration 279).
 *
 * ONE RULE, THREE READERS. HQ's `recordEscalation` refuses what this hides,
 * the branch's route refuses it before it calls HQ, and the branch's drawer
 * draws it as hidden with the reason. Each asks this function rather than
 * restating "a white-label has no brand desk", because three copies of one
 * rule is how three surfaces come to disagree about which kind is hidden.
 *
 * ONLY `white_label` HIDES ANYTHING. A subsidiary gets all four. Anything else
 * — null, because a branch's copy predates migration 284, or a value this
 * build does not recognise — gets all four with `known: false`: the branch
 * cannot tell, so it offers everything, and HQ, which can tell, decides.
 * Hiding on "is not a subsidiary" instead would take `content` away from every
 * branch whose copy is merely old, which is a refusal nobody decided.
 */
export function escalationKindsFor(licenceKind: unknown): EscalationKindAvailability {
  const k = typeof licenceKind === 'string' ? licenceKind.trim().toLowerCase() : '';
  if (k === 'white_label') {
    return {
      licence_kind: 'white_label',
      known: true,
      available: ESCALATION_KINDS.filter((x) => x !== 'content'),
      hidden: [{ kind: 'content', reason: WHITE_LABEL_CONTENT_HIDDEN }],
    };
  }
  if (k === 'subsidiary') {
    return { licence_kind: 'subsidiary', known: true, available: [...ESCALATION_KINDS], hidden: [] };
  }
  return { licence_kind: k || null, known: false, available: [...ESCALATION_KINDS], hidden: [] };
}

/**
 * The escalation kinds some licence kind can hide — the ONLY kinds HQ reads
 * its ledger for. An ungated kind never depends on that read, and that matters
 * for one of them in particular: `other` is how a suspended branch appeals
 * (D107), and an appeal that failed because HQ could not read a licence's kind
 * would lock the one door out of the freeze. A test holds this list equal to
 * every kind `escalationKindsFor` can hide, so a kind that becomes hideable
 * without joining it — hidden on the branch, unchecked at HQ — fails the
 * build rather than being recorded.
 */
export const KIND_GATED_ESCALATIONS: readonly EscalationKind[] = ['content'];

/** HQ refused an escalation for its kind — a decision, returned, never thrown. */
export type EscalationRefusal = {
  refused: 'kind_not_available';
  kind: EscalationKind;
  licence_kind: string | null;
  reason: string;
};

export type EscalationInput = {
  kind: string;
  subject: string;
  subject_ref?: string | null;
  detail?: string | null;
  raised_by_name?: string | null;
  raised_by_branch_user_id?: number | null;
  /**
   * The branch's idempotency key for this raise (D243). Generated there
   * before the call. A second insert with the same key on the same branch
   * returns the row already stored.
   */
  raise_key?: string | null;
};

/**
 * Refuse to answer on a branch.
 *
 * `BranchEntrypoint` is HQ's surface. A branch that exported and answered it
 * would be a second HQ as far as its own callers were concerned — escalations
 * filed into a database that has no HQ console to read them.
 */
function requireHq(env: Env): void {
  if (branchOf(env)) throw new Error('BranchEntrypoint is only live on HQ');
}

/**
 * Is this a branch HQ has actually provisioned — and if so, which licence
 * does it run under?
 *
 * A MISSING TABLE IS A REFUSAL, NOT A PASS. Before migration 258 runs there is
 * no deployment registry, and treating "cannot check" as "allowed" would make
 * the attribution check disappear exactly when the schema is in flux. The
 * escalation is rejected with a reason the caller can act on instead.
 *
 * D206 — it returns the licence uid rather than a boolean, because the kind
 * gate needs exactly that and a second read of the same row would be a second
 * question asked of one fact.
 */
async function deploymentOf(env: Env, code: string): Promise<{ licence_uid: string } | null> {
  return await env.DB.prepare('SELECT licence_uid FROM licence_deployments WHERE code = ?')
    .bind(code).first<{ licence_uid: string }>();
}

/**
 * The kind of licence a provisioned branch runs under (migration 279).
 *
 * FAILS CLOSED, on `deploymentOf`'s rule above and H30's: a white-label row
 * appearing in HQ's brand lane IS the gate failing, so "could not read the
 * kind" must never become "allowed". An unreadable ledger throws, and so does
 * an ORPHAN — a deployment naming a licence HQ's ledger does not hold — which
 * is a registry fault an operator should see, not a pass. A throw reaches the
 * branch as an undelivered escalation with this sentence, which is the honest
 * state: HQ did not record it, and could not say why beyond this.
 */
async function licenceKindOf(env: Env, code: string, licenceUid: string): Promise<string> {
  const row = await env.DB.prepare('SELECT kind FROM territory_licences WHERE uid = ?')
    .bind(licenceUid).first<{ kind: string | null }>();
  if (!row) {
    throw new Error(
      `escalate: ${code}'s deployment names licence ${licenceUid}, which HQ's ledger does not hold, `
      + 'so the kind of licence it runs under cannot be read',
    );
  }
  return String(row.kind ?? '');
}

/**
 * D267 — every provisioned branch's licence kind, in ONE read, keyed by code.
 *
 * FOR THE READER THAT CHECKS THE GATE, NOT FOR THE GATE. `licenceKindOf` above
 * fails closed because it decides whether a row is recorded. This one decides
 * nothing: HQ's content lane asks it whether a row that IS recorded should not
 * have been, so it answers what the ledger holds and never invents a kind.
 *
 *   - THE LEFT JOIN IS THE ORPHAN RULE. A deployment naming a licence the
 *     ledger does not hold comes back with a NULL kind rather than throwing or
 *     vanishing: "unknown" is an answer the lane can state, and one orphan must
 *     not blank every other branch's kind.
 *   - A FAILED STATEMENT THROWS, to the caller. No ledger is not "every kind is
 *     unknown", and the caller is the one that knows how to say "not checked".
 *
 * Read at display time rather than stamped on the row, because nothing changes
 * a licence's kind after it is issued, and `licence_deployments.code` and
 * `.licence_uid` are both UNIQUE (migration 258): one code, one licence, one
 * kind, today and at the time the row was raised.
 */
export async function licenceKindsByCode(env: Env): Promise<Map<string, string | null>> {
  requireHq(env);
  const rows = await env.DB.prepare(
    `SELECT d.code, l.kind
       FROM licence_deployments d
       LEFT JOIN territory_licences l ON l.uid = d.licence_uid`,
  ).all<{ code: string; kind: string | null }>();
  const kinds = new Map<string, string | null>();
  for (const r of rows.results || []) {
    kinds.set(String(r.code), r.kind == null ? null : String(r.kind));
  }
  return kinds;
}

function newUid(): string {
  return `esc_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * A branch pushes an item up. Returns the escalation's uid so the branch can
 * show it in its own "To HQ" lane and follow the answer back.
 */
export async function recordEscalation(
  env: Env, callerCode: string, item: EscalationInput,
): Promise<{ uid: string; due_at: string; status: 'open' } | EscalationRefusal> {
  requireHq(env);

  const code = String(callerCode ?? '').trim().toLowerCase();
  if (!BRANCH_CODE_RE.test(code)) {
    throw new Error('escalate: the caller must name a valid branch code');
  }
  const deployment = await deploymentOf(env, code);
  if (!deployment) {
    throw new Error(`escalate: ${code} is not a provisioned branch`);
  }

  const kind = String(item?.kind ?? '').trim().toLowerCase() as EscalationKind;
  if (!(ESCALATION_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`escalate: kind must be one of ${ESCALATION_KINDS.join(', ')}`);
  }
  const subject = String(item?.subject ?? '').trim().slice(0, 300);
  if (!subject) throw new Error('escalate: a subject is required');

  // D206 — THE KIND GATE, AT THE DOOR THAT RECORDS. The branch refuses a
  // hidden kind before it calls, but a branch's copy can be stale or missing,
  // and it is HQ's ledger that knows which licence this branch runs under — so
  // HQ checks too, and nothing is inserted when it refuses. A refusal is
  // RETURNED, not thrown: a throw reaches the branch as "HQ did not accept the
  // escalation", which the branch stores as `undelivered` and which reads as
  // retryable. A refusal is a decision, and retrying it would be refused again.
  if (KIND_GATED_ESCALATIONS.includes(kind)) {
    const gate = escalationKindsFor(await licenceKindOf(env, code, deployment.licence_uid));
    const hidden = gate.hidden.find((h) => h.kind === kind);
    if (hidden) {
      return { refused: 'kind_not_available', kind, licence_kind: gate.licence_kind, reason: hidden.reason };
    }
  }

  const uid = newUid();
  // The due date, not a band: a band stored at write time is wrong an hour
  // later, which is the whole reason migration 259 stores this column.
  const dueAt = new Date(Date.now() + SLA_HOURS[kind] * 3600_000).toISOString();
  const subjectRef = item?.subject_ref ? String(item.subject_ref).slice(0, 300) : null;
  const detail = item?.detail ? String(item.detail).slice(0, 4000) : null;
  const raisedBy = item?.raised_by_name ? String(item.raised_by_name).slice(0, 200) : null;
  const raisedById = Number.isFinite(Number(item?.raised_by_branch_user_id))
    ? Number(item.raised_by_branch_user_id) : null;

  // D243 — THE KEY IS THE BRANCH'S, AND A REPEAT IS THE SAME ROW. Absent on a
  // caller that predates the key: that insert is the old statement, so an old
  // branch still records. Present, the partial unique index makes the second
  // insert change nothing, and the uid already stored is what comes back.
  const raiseKey = String(item?.raise_key ?? '').trim().slice(0, 80);
  if (/^[A-Za-z0-9_-]{8,80}$/.test(raiseKey)) {
    const inserted = await env.DB.prepare(
      `INSERT INTO hq_escalations
         (uid, branch_code, kind, subject, subject_ref, detail,
          raised_by_name, raised_by_branch_user_id, status, due_at, raise_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
       ON CONFLICT(branch_code, raise_key) WHERE raise_key IS NOT NULL DO NOTHING`,
    ).bind(uid, code, kind, subject, subjectRef, detail, raisedBy, raisedById, dueAt, raiseKey).run();
    const changes = Number((inserted as { meta?: { changes?: number } })?.meta?.changes ?? 0);
    if (changes === 0) {
      const existing = await env.DB.prepare(
        `SELECT uid, due_at FROM hq_escalations WHERE branch_code = ? AND raise_key = ?`,
      ).bind(code, raiseKey).first<{ uid: string; due_at: string }>();
      if (!existing) throw new Error('escalate: the raise key matched no row and recorded none');
      return { uid: existing.uid, due_at: existing.due_at, status: 'open' };
    }
    return { uid, due_at: dueAt, status: 'open' };
  }

  await env.DB.prepare(
    `INSERT INTO hq_escalations
       (uid, branch_code, kind, subject, subject_ref, detail,
        raised_by_name, raised_by_branch_user_id, status, due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).bind(uid, code, kind, subject, subjectRef, detail, raisedBy, raisedById, dueAt).run();

  return { uid, due_at: dueAt, status: 'open' };
}

export type EscalationRow = {
  uid: string; branch_code: string; kind: string; subject: string; subject_ref: string | null;
  detail: string | null; raised_by_name: string | null; status: string; due_at: string | null;
  created_at: string; answer: string | null; answered_at: string | null;
};

/** The SLA band S3 and H1 both draw, derived on READ so it stays true. */
export function slaBand(dueAt: string | null, now = Date.now()): 'ok' | 'due_soon' | 'past' {
  if (!dueAt) return 'ok';
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return 'ok';
  if (now > due) return 'past';
  return due - now <= 24 * 3600_000 ? 'due_soon' : 'ok';
}

export type OpenEscalation = EscalationRow & { sla: 'ok' | 'due_soon' | 'past' };

/**
 * How many open escalations one read will count before it stops calling its
 * count a total (D204).
 *
 * Past it the read is still useful — it is ordered oldest first, so the oldest
 * items and their ages are exact — but the count is not, and a count that was
 * cut is never shown as the total (D131). `complete: false` is how a caller
 * learns that, rather than reading the length of a truncated list.
 */
export const OPEN_ESCALATION_CEILING = 2000;

/**
 * Every open escalation, oldest first — THE one statement that says what "open"
 * means for an escalation (D204).
 *
 * TWO CALLERS, ONE READ. HQ Home lists the oldest few; HQ Support counts them,
 * bands them by SLA and attributes them to a branch. Both used to be possible
 * only by writing a second `WHERE status = 'open'`, and two statements for one
 * question is how a digest and a desk come to disagree about what is waiting.
 * So the list and the count are one measurement: whoever needs the count reads
 * `items.length` of a COMPLETE summary, and a summary cut at the ceiling says so.
 *
 * Oldest first: the canvas orders queue pressure by age, not by count, on both
 * tiers. `id` breaks ties because `created_at` is `datetime('now')`, one-second
 * resolution, and two escalations raised in one second must not swap places
 * between reads.
 */
export async function openEscalationSummary(
  env: Env, now = Date.now(),
): Promise<{ items: OpenEscalation[]; complete: boolean }> {
  const rows = await env.DB.prepare(
    `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name,
            status, due_at, created_at, answer, answered_at
       FROM hq_escalations
      WHERE status = 'open'
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
  ).bind(OPEN_ESCALATION_CEILING + 1).all<EscalationRow>();
  const all = rows.results || [];
  const complete = all.length <= OPEN_ESCALATION_CEILING;
  const kept = complete ? all : all.slice(0, OPEN_ESCALATION_CEILING);
  return { items: kept.map((r) => ({ ...r, sla: slaBand(r.due_at, now) })), complete };
}

/**
 * What HQ's Home lists under "Escalations awaiting HQ" (H1) — the oldest few of
 * `openEscalationSummary`, never a second statement.
 */
export async function openEscalations(env: Env, limit = 50): Promise<OpenEscalation[]> {
  const cap = Math.max(1, Math.min(200, Number(limit) || 50));
  return (await openEscalationSummary(env)).items.slice(0, cap);
}

/* ------------------------------------------------------------------ *
 * Money-adjacent: the calls that carry a per-deployment secret (D111) *
 * ------------------------------------------------------------------ */

/**
 * Verify the branch's own RPC secret against the hash HQ stores.
 *
 * WHY THESE CALLS NEED MORE THAN A CODE, when escalations do not. The header
 * of this file records that a service binding cannot identify its caller, so
 * `callerCode` is attribution, not authentication: any Worker in the account
 * could claim to be `fr`. For an escalation that is acceptable — the worst
 * case is a spurious item in a queue a person reads. For a USAGE REPORT it is
 * not: the report is the input to a statement, so a false one changes what a
 * subsidiary is billed. The secret is what makes the claim checkable.
 *
 * SHA-256 OF THE SECRET IS WHAT HQ STORES, never the secret. It is generated
 * by `branch-provision.yml`, put on the branch Worker as `RPC_SECRET`, and its
 * hash written into `licence_deployments.rpc_secret_hash` — a read of this
 * table therefore cannot impersonate a branch.
 *
 * A DEPLOYMENT WITH NO HASH REFUSES, and this is the important default. Every
 * branch provisioned before the hash was wired has a NULL there, and treating
 * null as "skip the check" would make the guard disappear on exactly the
 * deployments nobody has audited. The refusal names what to do.
 *
 * THE COMPARISON ITSELF MOVED TO `rpc/secret.ts` (D120) when PR 11 added the
 * reverse leg. The digest, the constant-time compare and the three refusals are
 * one implementation now, shared with `authenticateHq` in `branchOps.ts` —
 * because the part that must not drift between the two directions is not the
 * SHA-256, it is the normalisation and the refusals around it.
 */
export type BranchIdentity = { code: string; licence_uid: string };

/**
 * Resolve and authenticate a branch making a money-adjacent call.
 *
 * Throws rather than returning an error shape, because every caller of this
 * wants the same thing on failure — to not perform the write — and a returned
 * error is one `if` away from being ignored.
 */
export async function authenticateBranch(
  env: Env, callerCode: string, secret: string,
): Promise<BranchIdentity> {
  requireHq(env);
  // LOWERED, DELIBERATELY — and this is the opposite of the rule the DEPLOY
  // route follows, which validates a new code exactly as typed. The difference
  // is what the string is: there, it is a name being chosen, and accepting
  // `FR` would create a branch whose code is not what the operator wrote.
  // Here it is an identifier being presented, and the deployment it resolves
  // to is the same one either way — `FR` reaches `fr` and must still present
  // `fr`'s own secret, so the normalisation cannot reach a branch the caller
  // could not already reach.
  const code = String(callerCode ?? '').trim().toLowerCase();
  if (!BRANCH_CODE_RE.test(code)) throw new Error('rpc: the caller must name a valid branch code');

  const dep = await env.DB.prepare(
    'SELECT code, licence_uid, rpc_secret_hash FROM licence_deployments WHERE code = ?',
  ).bind(code).first<{ code: string; licence_uid: string; rpc_secret_hash: string | null }>();
  if (!dep) throw new Error(`rpc: ${code} is not a provisioned branch`);

  const verdict = await verifySecret(secret, dep.rpc_secret_hash);
  if (verdict === 'no_hash') {
    throw new Error(
      `rpc: ${code} has no rpc_secret_hash on file, so a money-adjacent call from it cannot be `
      + 'verified. Re-run branch-provision.yml for this code, or set the hash from the secret '
      + 'the provisioning run generated.',
    );
  }
  if (verdict === 'no_secret') throw new Error(`rpc: ${code} presented no secret`);
  if (verdict !== 'ok') throw new Error(`rpc: ${code} presented the wrong secret`);
  return { code: dep.code, licence_uid: dep.licence_uid };
}

/**
 * A branch pulls its own licence terms from HQ's ledger.
 *
 * WHY A BRANCH WOULD PULL WHEN HQ ALSO PUSHES. The push is how a change
 * propagates; the pull is how a freshly provisioned branch gets its first copy
 * without waiting for HQ to notice it exists. Both write the same row through
 * `applyLicenceCopy`, so there is one shape and one `pushed_at` rule.
 *
 * D206 — AND ONE ASSEMBLER. This used to build its record from its own column
 * list, and the two emitters drifted: the pull never carried migration 265's
 * five fields, listed territories in join order, and sent `template_version:
 * null` under a comment saying HQ holds no template version — the contract
 * ledger does, and the push already read it from there. It now reads the row
 * whole and hands it to `assembleLicenceRecord`, the function the push uses, so
 * the two cannot send different records again. A test asserts they are equal.
 *
 * D244 — AUTHENTICATED BEFORE IT READS ANYTHING, which is why it lives in this
 * section now. What it returns is a licence's fees, revenue share, token split
 * and signatory, and a service binding cannot say who called it, so until D244
 * any Worker in the account that named a code received that branch's terms. It
 * now takes the branch's per-deployment secret and runs `authenticateBranch`
 * first, exactly as `reportUsage` does: a malformed or unprovisioned code, a
 * deployment with no hash on file, and a missing or wrong secret all throw
 * before the licence row is read. It had no caller when this changed, so
 * nothing that worked stopped working; its first caller, the branch's
 * `pullLicenceCopy` (routes/licence.ts), arrived in the same PR and sends
 * `RPC_SECRET`. A deployment whose licence row has gone still answers
 * `no_licence_for_branch` — that is a fact about HQ's ledger, not a refusal of
 * the caller.
 */
export async function licenceForBranch(
  env: Env, callerCode: string, secret: string,
): Promise<Record<string, unknown> | { error: 'no_licence_for_branch' }> {
  const who = await authenticateBranch(env, callerCode, secret);

  const row = await env.DB.prepare('SELECT * FROM territory_licences WHERE uid = ?')
    .bind(who.licence_uid).first<Record<string, unknown>>();
  if (!row) return { error: 'no_licence_for_branch' };

  // Stamped by HQ at the moment it asserts the content — the branch stores
  // this verbatim rather than the moment its own write lands.
  return assembleLicenceRecord(env, row, new Date().toISOString());
}

export type UsageFigure = {
  stream: string;
  gross_cents: number | null;
  currency?: string;
  is_estimate?: boolean;
  estimate_basis?: string;
  available?: boolean;
  reason?: string;
};

/**
 * A branch reports what it billed in a period (D.8).
 *
 * A RE-REPORT REPLACES, rather than adding a second row: a branch correcting
 * itself is a correction, not a second quarter's trading, and the UNIQUE index
 * on (licence, period, stream) is what makes that structural instead of
 * remembered. `reported_at` is the BRANCH's own stamp, so a statement built
 * from a three-week-old report shows the age of its evidence.
 *
 * A FIGURE THE BRANCH COULD NOT MEASURE IS STORED AS NULL, NOT 0. Measured
 * against the schema: no branch can total subscription revenue locally
 * (`account_subscriptions` has a plan and no amount; the charges are in
 * Stripe), so this is the normal case and not an edge one. A zero there would
 * make a statement drawn from it read as a complete quarter that earned less.
 */
export async function reportUsage(
  env: Env, callerCode: string, secret: string,
  period: string, figures: UsageFigure[],
): Promise<{ ok: true; period: string; streams: number }> {
  const who = await authenticateBranch(env, callerCode, secret);
  const p = String(period ?? '').trim();
  if (!PERIOD_RE.test(p)) throw new Error(`rpc: ${JSON.stringify(p)} is not a period (YYYY-Qn)`);

  const now = new Date().toISOString();
  const rows = (figures || []).filter((f) => f && typeof f.stream === 'string' && f.stream.trim());
  for (const f of rows) {
    // A value that is not a finite number is as unmeasured as a null one, so
    // it is stored as NULL too. `Number(x) || 0` used to turn it into a zero,
    // which is the one reading this function exists to refuse.
    const n = f.available === false || f.gross_cents === null || f.gross_cents === undefined
      ? NaN
      : Number(f.gross_cents);
    const gross = Number.isFinite(n) ? Math.trunc(n) : null;
    await env.DB.prepare(
      `INSERT INTO subsidiary_usage_reports
         (licence_uid, branch_code, period, stream, gross_cents, currency,
          is_estimate, estimate_basis, reported_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(licence_uid, period, stream) DO UPDATE SET
         gross_cents = excluded.gross_cents, currency = excluded.currency,
         is_estimate = excluded.is_estimate, estimate_basis = excluded.estimate_basis,
         reported_at = excluded.reported_at`,
    ).bind(
      who.licence_uid, who.code, p, String(f.stream).trim().slice(0, 40),
      gross, String(f.currency || 'EUR').toUpperCase().slice(0, 3),
      f.is_estimate ? 1 : 0, f.estimate_basis ? String(f.estimate_basis).slice(0, 300) : null,
      now,
    ).run();
  }
  return { ok: true, period: p, streams: rows.length };
}

/* ------------------------------------------------------------------ *
 * HQ answers an escalation (D112)                                     *
 * ------------------------------------------------------------------ */

/** What a branch's own lane needs back, beyond what `recordEscalation` returned. */
export type EscalationAnswer = {
  hq_uid: string;
  answer: string;
  answered_by_name: string;
  answered_at: string;
  status: string;
  pushed_at: string;
};

/**
 * The table's vocabulary. `open` is the write-time default. `withdrawn` is
 * the branch taking its own request back. GET filters on this list. HQ's
 * own decisions are `HQ_DECISION_STATUSES`.
 */
export const ESCALATION_STATUSES = ['open', 'answered', 'declined', 'withdrawn'] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

/** What HQ may store as its own decision. Not `open`, and not `withdrawn`. */
export const HQ_DECISION_STATUSES = ['answered', 'declined'] as const;

/**
 * Record HQ's decision on one escalation.
 *
 * WHY A DECISION AND NOT A MESSAGE. `hq_escalations` carries one `answer` with
 * one author and one time (migration 259). That is the decision half of what
 * the canvas draws and not the conversation half, and this function does not
 * pretend otherwise: a second answer REPLACES the first rather than appending,
 * because two decisions in one column is not a thread, it is a lost decision.
 * A real thread is a messages table and is its own feature.
 *
 * AN ANSWER REQUIRES TEXT even when the decision is "declined". The subsidiary
 * canvas draws the answer as something a branch admin reads and acts on; a
 * status change with nothing written is a refusal with no reason, arriving on
 * the screen of the person least able to find out why.
 *
 * DOES NOT PUSH. The push is the caller's, because whether the branch received
 * the decision is a different fact from whether HQ made it, and the route
 * reports them separately (the D111 promo-ceiling precedent).
 */
export async function answerEscalation(
  env: Env,
  uid: string,
  input: { answer: string; status?: string; answered_by_user_id: number; answered_by_name: string },
): Promise<{ row: EscalationRow; answer: Omit<EscalationAnswer, 'pushed_at'> }> {
  requireHq(env);

  const id = String(uid ?? '').trim().slice(0, 80);
  if (!id) throw new Error('answerEscalation: an escalation uid is required');

  const answer = String(input?.answer ?? '').trim().slice(0, 4000);
  if (!answer) {
    throw new Error(
      'answerEscalation: a decision needs its reason. A status change with nothing written '
      + 'reaches the branch as a refusal it cannot act on.',
    );
  }

  const status = String(input?.status ?? 'answered').trim().toLowerCase();
  // Checked before the decision list so this sentence stays the refusal.
  if (status === 'open') {
    throw new Error('answerEscalation: an answered escalation cannot stay open');
  }
  if (!(HQ_DECISION_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`answerEscalation: status must be one of ${HQ_DECISION_STATUSES.join(', ')}`);
  }

  const name = String(input?.answered_by_name ?? '').trim().slice(0, 200);
  const now = new Date().toISOString();

  const existing = await env.DB.prepare('SELECT uid FROM hq_escalations WHERE uid = ?')
    .bind(id).first<{ uid: string }>();
  if (!existing) throw new Error(`answerEscalation: ${id} is not an escalation`);

  await env.DB.prepare(
    `UPDATE hq_escalations
        SET answer = ?, answered_by_user_id = ?, answered_by_name = ?, answered_at = ?, status = ?, updated_at = ?
      WHERE uid = ?`,
  ).bind(answer, Number(input.answered_by_user_id) || null, name || null, now, status, now, id).run();

  const row = await env.DB.prepare(
    `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name,
            status, due_at, created_at, answer, answered_at
       FROM hq_escalations WHERE uid = ?`,
  ).bind(id).first<EscalationRow>();

  return {
    row: row!,
    answer: { hq_uid: id, answer, answered_by_name: name, answered_at: now, status },
  };
}

/**
 * The escalation board, filtered — H1 lists what is open, H6 lists content.
 *
 * `openEscalations` above stays as it is: H1's zone asks a narrower question
 * ("what is awaiting HQ") and a caller that had to pass `status: 'open'` to get
 * the same list would be one forgotten argument away from showing answered
 * items as a backlog.
 */
export async function listEscalations(
  env: Env,
  filter: { status?: string; kind?: string; limit?: number } = {},
): Promise<{ items: Array<EscalationRow & { sla: 'ok' | 'due_soon' | 'past' }>; complete: boolean }> {
  requireHq(env);
  const cap = Math.max(1, Math.min(200, Number(filter.limit) || 50));
  // One past the ceiling. If it comes back, the list was cut and the extra
  // row is not returned, so a caller cannot print the cap as the count.

  // FOUR LITERAL STATEMENTS RATHER THAN AN ASSEMBLED `WHERE`. The same rule
  // D111's PATCH handler follows and for the same reason: a `${…}` inside
  // `DB.prepare` lands in the query TEXT, where no binding protects it. The
  // filter space here is small enough to enumerate, so it is enumerated.
  const status = filter.status ? String(filter.status).trim().toLowerCase() : '';
  const kind = filter.kind ? String(filter.kind).trim().toLowerCase() : '';

  // AND THE COLUMN LIST IS REPEATED RATHER THAN HOISTED. A first draft put it
  // in a `COLS` const and interpolated it, which `check-sql-prepare` refused —
  // correctly, because the guard's rule is that NO `${…}` reaches the query
  // text, not that the value happens to be safe today. A hoisted fragment is
  // one refactor away from carrying a caller's string, so the four statements
  // are four statements.
  let rows: { results?: EscalationRow[] };
  if (status && kind) {
    rows = await env.DB.prepare(
      `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name,
              status, due_at, created_at, answer, answered_at
         FROM hq_escalations WHERE status = ? AND kind = ?
        ORDER BY created_at ASC LIMIT ?`,
    ).bind(status, kind, cap + 1).all<EscalationRow>();
  } else if (kind) {
    rows = await env.DB.prepare(
      `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name,
              status, due_at, created_at, answer, answered_at
         FROM hq_escalations WHERE kind = ?
        ORDER BY created_at ASC LIMIT ?`,
    ).bind(kind, cap + 1).all<EscalationRow>();
  } else if (status) {
    rows = await env.DB.prepare(
      `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name,
              status, due_at, created_at, answer, answered_at
         FROM hq_escalations WHERE status = ?
        ORDER BY created_at ASC LIMIT ?`,
    ).bind(status, cap + 1).all<EscalationRow>();
  } else {
    rows = await env.DB.prepare(
      `SELECT uid, branch_code, kind, subject, subject_ref, detail, raised_by_name,
              status, due_at, created_at, answer, answered_at
         FROM hq_escalations
        ORDER BY created_at ASC LIMIT ?`,
    ).bind(cap + 1).all<EscalationRow>();
  }

  const now = Date.now();
  const all = (rows.results || []).map((r) => ({ ...r, sla: slaBand(r.due_at, now) }));
  const complete = all.length <= cap;
  return { items: complete ? all : all.slice(0, cap), complete };
}
