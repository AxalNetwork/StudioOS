/**
 * D1092 (#2957, part 3 of #2402) — Google Workspace's Validate feeds: the
 * files a founder chose (part 2, `google_workspace_files`) reach Validate.
 *
 *   Customer research  a Doc of interview notes becomes the text of a session
 *                      on the interview the founder mapped it to, through
 *                      `interviewIntake` (provider `google_docs`), which
 *                      re-checks the member and the venture on every write.
 *                      A FACT: the founder's own notes.
 *   Demand signals     a Form: the founder maps one question and the answers
 *                      that count (GW5). Each qualifying response becomes a
 *                      `demand_signals` row at `to_confirm`, source
 *                      `google_forms`. A PROPOSAL: counted only once the
 *                      founder confirms it.
 *   Experiments        each signal the founder confirmed is offered as
 *                      evidence (`google_workspace_proposals`, kind
 *                      `signal_evidence`); Accept links it to the hypothesis
 *                      the founder picks.
 *
 * NO RESPONDENT IDENTITY. A response is read for its id, its submit date and
 * the one mapped answer. `respondentEmail` and every other answer are never
 * read, stored or logged; the note names the Form, never a person.
 *
 * ONCE, AND DELETED STAYS DELETED. Every landed item has a `connector_fed_items`
 * row keyed `<drive file id>:<venture>[:<response id>]`. A key already there is
 * never landed again; a row whose `local_id` is NULL was deleted or stopped,
 * and stays so. A decided proposal is never proposed again (its source key is
 * unique). Logs hold codes and counts only.
 */
import type { Env } from '../../types';
import { WorkspaceError, workspaceRead, type WorkspaceRead } from './workspace';
import { IntakeError, importTranscript, openSession, writableInterview, writableSession } from '../interviewIntake';
import { deleteSession, loadSession } from '../interviewSessions';
import { DEMAND_KINDS, WriterError, addEvidence, writeDemandSignal } from '../validateWriters';
import { logCycleWriteStatement } from '../cycleActivity';
import type { ImportedSegment } from '../channels/types';

/** The Validate modules a chosen file feeds, by `google_workspace_files.module`. */
export const VALIDATE_GOOGLE_MODULES = Object.freeze(['customer_research', 'demand_signals', 'experiments'] as const);
export type ValidateGoogleModule = typeof VALIDATE_GOOGLE_MODULES[number];
/** The page slug each module logs under. */
export const MODULE_SLUG: Record<ValidateGoogleModule, 'customer-research' | 'demand-signals' | 'experiments'> = Object.freeze({
  customer_research: 'customer-research', demand_signals: 'demand-signals', experiments: 'experiments',
});
/** Files read per sync, Google reads per sync, responses read per Form, and a Doc's characters. */
export const SYNC_LIMITS = Object.freeze({ files: 20, reads: 40, formResponses: 500, docChars: 200_000, docLines: 2000 });
const PAGE_SIZE = 100;
const DRIVE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const KIND_WORDS: Record<string, string> = Object.freeze({
  loi: 'Letter of intent', pre_sale: 'Pre-sale', waitlist: 'Waitlist', need_to_have: 'Need-to-have', would_pay: 'Would pay',
});

// ---------------------------------------------------------------------------
// Reading what Google returned
// ---------------------------------------------------------------------------

/** A Doc's text, paragraphs and table cells in order, bounded. Never throws on an odd shape. */
export function docText(doc: any): string {
  const out: string[] = [];
  let size = 0;
  const walk = (content: unknown) => {
    for (const el of Array.isArray(content) ? content : []) {
      if (size >= SYNC_LIMITS.docChars) return;
      if (el?.paragraph) {
        const t = (Array.isArray(el.paragraph.elements) ? el.paragraph.elements : [])
          .map((e: any) => (typeof e?.textRun?.content === 'string' ? e.textRun.content : '')).join('');
        out.push(t); size += t.length;
      } else if (el?.table) {
        for (const row of Array.isArray(el.table.tableRows) ? el.table.tableRows : []) {
          for (const cell of Array.isArray(row?.tableCells) ? row.tableCells : []) { walk(cell?.content); out.push('\n'); }
        }
      } else if (el?.tableOfContents) walk(el.tableOfContents.content);
    }
  };
  walk(doc?.body?.content);
  return out.join('').slice(0, SYNC_LIMITS.docChars);
}

/**
 * Notes as segments: one per line. A line that opens with a short label and a
 * colon ("Me: …", "[Customer 4]: …") is that speaker's; any other is "Notes".
 */
export function noteSegments(text: string): ImportedSegment[] {
  return String(text ?? '').split(/\r?\n|\u000b/).map((l) => l.trim()).filter(Boolean).slice(0, SYNC_LIMITS.docLines).map((line) => {
    const m = /^([^:]{1,40}):\s+(\S.*)$/.exec(line);
    return m && !/https?$/i.test(m[1].trim())
      ? { speaker: m[1].trim(), text: m[2], startMs: null, endMs: null }
      : { speaker: 'Notes', text: line, startMs: null, endMs: null };
  });
}

export interface FormMapping { question_id: string; answers: string[]; kind: string }

/** A Form mapping the feed accepts, or null: one question, 1–20 answers, a demand kind. */
export function formMapping(raw: unknown): FormMapping | null {
  const m = raw as any;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const question = typeof m.question_id === 'string' ? m.question_id.trim() : '';
  const kind = String(m.kind ?? 'waitlist');
  const answers = Array.isArray(m.answers) ? [...new Set(m.answers.map((a: unknown) => (typeof a === 'string' ? a.trim() : '')).filter((a: string) => a && a.length <= 200))] as string[] : [];
  if (!question || question.length > 100 || !answers.length || answers.length > 20 || !(DEMAND_KINDS as readonly string[]).includes(kind)) return null;
  return { question_id: question, answers, kind };
}

/** The Form's questions with their offered choices: titles and options only. */
export function formQuestions(form: any): Array<{ question_id: string; title: string; choices: string[] }> {
  return (Array.isArray(form?.items) ? form.items : []).flatMap((item: any) => {
    const q = item?.questionItem?.question;
    if (!q || typeof q.questionId !== 'string') return [];
    const choices = (Array.isArray(q.choiceQuestion?.options) ? q.choiceQuestion.options : [])
      .map((o: any) => (typeof o?.value === 'string' ? o.value.slice(0, 200) : '')).filter(Boolean);
    return [{ question_id: q.questionId, title: String(item.title || '').slice(0, 500), choices }];
  });
}

/** Whether a response's answer to the mapped question is one that counts. Reads that one answer only. */
export function qualifies(response: any, mapping: FormMapping): boolean {
  const answers = response?.answers?.[mapping.question_id]?.textAnswers?.answers;
  return Array.isArray(answers) && answers.some((a: any) => typeof a?.value === 'string' && mapping.answers.includes(a.value.trim()));
}

const responseDay = (r: any): string | null => {
  const at = typeof r?.lastSubmittedTime === 'string' ? r.lastSubmittedTime : typeof r?.createTime === 'string' ? r.createTime : '';
  return DAY.test(at.slice(0, 10)) ? at.slice(0, 10) : null;
};

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

class OutOfReads extends Error {}

export interface SyncCounts {
  files: number; imported: number; unchanged: number; unmapped: number; unreadable: number;
  proposed_signals: number; offered_evidence: number; withdrawn_offers: number; partly: boolean;
}

interface Ctx {
  env: Env; userId: number; projectId: number; integrationId: number;
  read: (call: WorkspaceRead, id: string, options?: { pageToken?: string; pageSize?: number }) => Promise<any>;
}

const ledgerRow = (ctx: Ctx, key: string) => ctx.env.DB.prepare('SELECT id, local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ?')
  .bind(ctx.integrationId, key).first<{ id: number; local_id: number | null }>();
const touch = (ctx: Ctx, id: number) => ctx.env.DB.prepare('UPDATE connector_fed_items SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run();
/** Claim a key before landing it, so two syncs at once land it once. Null when another holds it. */
async function claim(ctx: Ctx, module: string, kind: string, key: string, table: string): Promise<number | null> {
  const row = await ctx.env.DB.prepare(
    `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (integration_id, external_id) DO NOTHING RETURNING id`,
  ).bind(ctx.integrationId, ctx.projectId, module, kind, key, table).first<{ id: number }>();
  return row ? Number(row.id) : null;
}
const land = (ctx: Ctx, id: number, localId: number) => ctx.env.DB.prepare('UPDATE connector_fed_items SET local_id = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').bind(localId, id).run();
const release = (ctx: Ctx, id: number) => ctx.env.DB.prepare('DELETE FROM connector_fed_items WHERE id = ? AND local_id IS NULL').bind(id).run();

/** A Doc mapped to an interview: its notes become (or replace) that interview's session text. */
async function syncDoc(ctx: Ctx, file: any, mapping: any): Promise<'imported' | 'unchanged' | 'unmapped'> {
  const interviewId = Number(mapping?.interview_id);
  if (!Number.isSafeInteger(interviewId) || interviewId <= 0) return 'unmapped';
  const key = `${file.drive_file_id}:${ctx.projectId}`;
  const held = await ledgerRow(ctx, key);
  const session = held?.local_id != null ? await loadSession(ctx.env, Number(held.local_id)) : null;
  if (held && !session) {
    // Deleted here, stopped, or deleted in Customer research: it stays deleted.
    if (held.local_id != null) await ctx.env.DB.prepare('UPDATE connector_fed_items SET local_id = NULL WHERE id = ?').bind(held.id).run();
    return 'unchanged';
  }
  const meta = await ctx.read('files.get', file.drive_file_id);
  if (meta?.trashed === true) throw new WorkspaceError('file_not_shared', 403);
  const modified = typeof meta?.modifiedTime === 'string' ? meta.modifiedTime : null;
  if (held && session && file.last_synced_at && modified && modified === file.modified_time) {
    await touch(ctx, held.id);
    return 'unchanged';
  }
  const segments = noteSegments(docText(await ctx.read('documents.get', file.drive_file_id)));
  if (held && session) {
    // The Doc changed: its text replaces the session's. interviewIntake re-checks the member and the venture.
    await importTranscript(ctx.env, ctx.userId, session.id, segments, 'google_docs');
    await touch(ctx, held.id);
  } else {
    const scoped = await writableInterview(ctx.env, ctx.userId, interviewId);
    if (Number(scoped.project.id) !== ctx.projectId) throw new IntakeError(404, 'interview_not_found', 'That interview no longer exists.');
    if (!segments.length) throw new IntakeError(422, 'transcript_empty', 'The document had no text to import.');
    const claimed = await claim(ctx, 'customer_research', 'interview_notes', key, 'interview_sessions');
    if (claimed == null) return 'unchanged';
    let opened: number | null = null;
    try {
      opened = (await openSession(ctx.env, scoped, 'google_docs', 'text')).id;
      await importTranscript(ctx.env, ctx.userId, opened, segments, 'google_docs');
      await land(ctx, claimed, opened);
    } catch (e) {
      if (opened != null) {
        await ctx.env.DB.prepare('DELETE FROM interview_sessions WHERE id = ? AND NOT EXISTS (SELECT 1 FROM interview_transcript_segments WHERE session_id = ?)')
          .bind(opened, opened).run().catch(() => {});
      }
      await release(ctx, claimed);
      throw e;
    }
  }
  await ctx.env.DB.prepare('UPDATE google_workspace_files SET modified_time = ? WHERE id = ?').bind(modified, file.id).run();
  return 'imported';
}

/** A mapped Form: each new qualifying response becomes a signal to confirm. */
async function syncForm(ctx: Ctx, file: any, raw: any): Promise<{ outcome: 'imported' | 'unmapped'; proposed: number }> {
  const mapping = formMapping(raw);
  if (!mapping) return { outcome: 'unmapped', proposed: 0 };
  const form = await ctx.read('forms.get', file.drive_file_id);
  if (!formQuestions(form).some((q) => q.question_id === mapping.question_id)) throw new WorkspaceError('mapping_question_missing', 409);
  let proposed = 0; let seen = 0; let pageToken: string | undefined;
  do {
    const page = await ctx.read('forms.responses.list', file.drive_file_id, { pageSize: PAGE_SIZE, ...(pageToken ? { pageToken } : {}) });
    for (const r of Array.isArray(page?.responses) ? page.responses : []) {
      if (++seen > SYNC_LIMITS.formResponses) break;
      const id = typeof r?.responseId === 'string' && DRIVE_ID.test(r.responseId) ? r.responseId : null;
      if (!id || !qualifies(r, mapping)) continue;
      const key = `${file.drive_file_id}:${ctx.projectId}:${id}`;
      const claimed = await claim(ctx, 'demand_signals', 'form_response', key, 'demand_signals');
      if (claimed == null) continue;
      try {
        const signal = await writeDemandSignal(ctx.env, {
          projectId: ctx.projectId, userId: ctx.userId, kind: mapping.kind, signal_date: responseDay(r) ?? undefined,
          status: 'to_confirm', source_kind: 'google_forms', note: `From Google Forms: “${String(file.name).slice(0, 200)}”`,
        });
        await land(ctx, claimed, signal.id);
        proposed += 1;
      } catch (e) { await release(ctx, claimed); throw e; }
    }
    pageToken = typeof page?.nextPageToken === 'string' && page.nextPageToken ? page.nextPageToken : undefined;
  } while (pageToken && seen < SYNC_LIMITS.formResponses);
  return { outcome: 'imported', proposed };
}

/**
 * Offer each confirmed Google Forms signal as evidence once, and withdraw a
 * pending offer whose signal is no longer confirmed or no longer there.
 * Accepted and dismissed offers are never touched.
 */
async function offerEvidence(ctx: Ctx): Promise<{ offered: number; withdrawn: number }> {
  const confirmed = (await ctx.env.DB.prepare(
    `SELECT d.id, d.kind, d.signal_date FROM connector_fed_items f JOIN demand_signals d ON d.id = f.local_id AND d.project_id = f.project_id
      WHERE f.integration_id = ? AND f.project_id = ? AND f.local_table = 'demand_signals' AND d.status IN ('confirmed', 'counted')
      ORDER BY d.id`,
  ).bind(ctx.integrationId, ctx.projectId).all<{ id: number; kind: string; signal_date: string }>()).results || [];
  const statements = confirmed.map((s) => ctx.env.DB.prepare(
    `INSERT INTO google_workspace_proposals (integration_id, project_id, module, kind, source_key, fingerprint, title, payload_json)
     VALUES (?, ?, 'experiments', 'signal_evidence', ?, ?, ?, ?) ON CONFLICT (integration_id, project_id, source_key) DO NOTHING`,
  ).bind(ctx.integrationId, ctx.projectId, `signal:${s.id}`, `signal-${s.id}`,
    `${KIND_WORDS[s.kind] ?? 'Demand'} signal from Google Forms, ${s.signal_date}`, JSON.stringify({ signal_id: Number(s.id), kind: s.kind, signal_date: s.signal_date })));
  statements.push(ctx.env.DB.prepare(
    `DELETE FROM google_workspace_proposals WHERE integration_id = ? AND project_id = ? AND module = 'experiments' AND kind = 'signal_evidence' AND status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM demand_signals d WHERE 'signal-' || d.id = google_workspace_proposals.fingerprint AND d.project_id = google_workspace_proposals.project_id AND d.status IN ('confirmed', 'counted'))`,
  ).bind(ctx.integrationId, ctx.projectId));
  const results = await ctx.env.DB.batch(statements);
  const changed = (r: any) => Number(r?.meta?.changes ?? 0);
  return { offered: results.slice(0, -1).reduce((n, r) => n + changed(r), 0), withdrawn: changed(results[results.length - 1]) };
}

/** Read the founder's chosen Validate files, land what is new, offer what was confirmed. */
export async function syncValidateFromGoogle(env: Env, userId: number, projectId: number, integrationId: number): Promise<SyncCounts> {
  let reads = 0;
  const ctx: Ctx = {
    env, userId, projectId, integrationId,
    read: (call, id, options = {}) => {
      if (reads >= SYNC_LIMITS.reads) throw new OutOfReads();
      reads += 1;
      return workspaceRead(env, userId, call, id, options);
    },
  };
  const counts: SyncCounts = { files: 0, imported: 0, unchanged: 0, unmapped: 0, unreadable: 0, proposed_signals: 0, offered_evidence: 0, withdrawn_offers: 0, partly: false };
  const files = (await env.DB.prepare(
    `SELECT * FROM google_workspace_files WHERE integration_id = ? AND user_id = ? AND project_id = ?
        AND module IN ('customer_research', 'demand_signals') AND status <> 'stopped' ORDER BY id LIMIT ?`,
  ).bind(integrationId, userId, projectId, SYNC_LIMITS.files + 1).all<any>()).results || [];
  if (files.length > SYNC_LIMITS.files) { counts.partly = true; files.length = SYNC_LIMITS.files; }
  for (const file of files) {
    counts.files += 1;
    const mapping = file.mapping_json ? (() => { try { return JSON.parse(file.mapping_json); } catch { return null; } })() : null;
    try {
      let outcome: 'imported' | 'unchanged' | 'unmapped';
      if (file.module === 'customer_research' && file.kind === 'doc') outcome = await syncDoc(ctx, file, mapping);
      else if (file.module === 'demand_signals' && file.kind === 'form') {
        const r = await syncForm(ctx, file, mapping);
        outcome = r.outcome; counts.proposed_signals += r.proposed;
      } else outcome = 'unmapped';
      counts[outcome] += 1;
      if (outcome !== 'unmapped') {
        await env.DB.prepare("UPDATE google_workspace_files SET status = 'active', last_error = NULL, last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(file.id).run();
      }
    } catch (e) {
      if (e instanceof OutOfReads || (e instanceof WorkspaceError && e.code === 'google_rate_limited')) { counts.partly = true; break; }
      const code = e instanceof WorkspaceError || e instanceof IntakeError ? e.code : e instanceof WriterError ? 'not_stored' : 'google_unreadable';
      if (!(e instanceof WorkspaceError || e instanceof IntakeError || e instanceof WriterError)) console.warn('[google validate] file sync failed:', (e as Error)?.name);
      counts.unreadable += 1;
      await env.DB.prepare("UPDATE google_workspace_files SET status = 'unreadable', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(code, file.id).run();
    }
  }
  const offers = await offerEvidence(ctx);
  counts.offered_evidence = offers.offered;
  counts.withdrawn_offers = offers.withdrawn;
  return counts;
}

/** GW5's preview: the Form's questions and how many read responses the mapping would propose. Stores nothing. */
export async function previewFormMapping(env: Env, userId: number, file: any, raw: unknown) {
  if (file.kind !== 'form' || file.module !== 'demand_signals') throw new WorkspaceError('preview_not_supported', 400);
  const form = await workspaceRead(env, userId, 'forms.get', file.drive_file_id);
  const questions = formQuestions(form);
  const mapping = raw == null ? null : formMapping(raw);
  if (raw != null && (!mapping || !questions.some((q) => q.question_id === mapping.question_id))) throw new WorkspaceError('invalid_mapping', 400);
  let read = 0; let qualifying = 0; let pageToken: string | undefined; let pages = 0;
  if (mapping) {
    do {
      const page = await workspaceRead(env, userId, 'forms.responses.list', file.drive_file_id, { pageSize: PAGE_SIZE, ...(pageToken ? { pageToken } : {}) });
      for (const r of Array.isArray(page?.responses) ? page.responses : []) {
        if (read >= SYNC_LIMITS.formResponses) break;
        read += 1;
        if (qualifies(r, mapping)) qualifying += 1;
      }
      pageToken = typeof page?.nextPageToken === 'string' && page.nextPageToken ? page.nextPageToken : undefined;
      pages += 1;
    } while (pageToken && read < SYNC_LIMITS.formResponses && pages < 5);
  }
  return { questions, responses: mapping ? read : null, qualifying: mapping ? qualifying : null, capped: !!pageToken, stored: false };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type Decided = 'ok' | 'not_found' | 'decided' | 'not_confirmed';

/** Accept an evidence offer: link its signal to the hypothesis the founder picks. */
export async function acceptEvidenceProposal(env: Env, ctx: { userId: number; projectId: number; integrationId: number }, id: number,
  pick: { hypothesis_id: unknown; direction?: unknown; strength?: unknown }): Promise<Decided> {
  const row = await env.DB.prepare(
    "SELECT id, status, payload_json FROM google_workspace_proposals WHERE id = ? AND integration_id = ? AND project_id = ? AND module = 'experiments' AND kind = 'signal_evidence'",
  ).bind(id, ctx.integrationId, ctx.projectId).first<{ id: number; status: string; payload_json: string }>();
  if (!row) return 'not_found';
  if (row.status !== 'pending') return 'decided';
  const signalId = Number(JSON.parse(row.payload_json || '{}').signal_id);
  const hypothesisId = Number(pick.hypothesis_id);
  if (!Number.isSafeInteger(hypothesisId) || hypothesisId <= 0) throw new WriterError(400, 'Pick the hypothesis this signal is evidence for');
  const signal = await env.DB.prepare("SELECT 1 AS ok FROM demand_signals WHERE id = ? AND project_id = ? AND status IN ('confirmed', 'counted')")
    .bind(signalId, ctx.projectId).first();
  if (!signal) return 'not_confirmed';
  const claimed = await env.DB.prepare("UPDATE google_workspace_proposals SET status = 'accepted', decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
    .bind(ctx.userId, id).run();
  if (!Number(claimed.meta?.changes ?? 0)) return 'decided';
  try {
    await addEvidence(env, { projectId: ctx.projectId, userId: ctx.userId, hypothesisId, kind: 'signal', ref_id: `signal-${signalId}`, direction: pick.direction ?? 'supports', strength: pick.strength });
  } catch (e) {
    await env.DB.prepare("UPDATE google_workspace_proposals SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ?").bind(id).run();
    throw e;
  }
  return 'ok';
}

export async function dismissProposal(env: Env, ctx: { userId: number; projectId: number; integrationId: number }, id: number): Promise<Decided> {
  const res = await env.DB.prepare(
    `UPDATE google_workspace_proposals SET status = 'dismissed', decided_by = ?, decided_at = CURRENT_TIMESTAMP
      WHERE id = ? AND integration_id = ? AND project_id = ? AND module IN ('customer_research', 'demand_signals', 'experiments') AND status = 'pending'`,
  ).bind(ctx.userId, id, ctx.integrationId, ctx.projectId).run();
  if (Number(res.meta?.changes ?? 0)) return 'ok';
  const row = await env.DB.prepare("SELECT 1 AS hit FROM google_workspace_proposals WHERE id = ? AND integration_id = ? AND project_id = ? AND module IN ('customer_research', 'demand_signals', 'experiments')")
    .bind(id, ctx.integrationId, ctx.projectId).first();
  return row ? 'decided' : 'not_found';
}

/**
 * Delete a landed fact by its ledger id: the signal (with its evidence links
 * and its pending offer) or the session. The ledger row stays, unlinked, so
 * the next sync leaves it deleted. Returns the module it was in, or null.
 */
export async function deleteValidateFact(env: Env, ctx: { userId: number; projectId: number; integrationId: number }, ledgerId: number): Promise<ValidateGoogleModule | null> {
  const row = await env.DB.prepare(
    `SELECT id, module, local_table, local_id FROM connector_fed_items
      WHERE id = ? AND integration_id = ? AND project_id = ? AND module IN ('customer_research', 'demand_signals') AND local_id IS NOT NULL`,
  ).bind(ledgerId, ctx.integrationId, ctx.projectId).first<{ id: number; module: ValidateGoogleModule; local_table: string; local_id: number }>();
  if (!row) return null;
  const unlink = env.DB.prepare('UPDATE connector_fed_items SET local_id = NULL WHERE id = ?').bind(row.id);
  const log = logCycleWriteStatement(env, { projectId: ctx.projectId, userId: ctx.userId, cycle: 'validate', module: MODULE_SLUG[row.module], entityId: row.id, action: 'google_fact_deleted', summary: 'Google fact deleted' });
  if (row.local_table === 'demand_signals') {
    const ref = `signal-${row.local_id}`;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM hypothesis_evidence_links WHERE kind = 'signal' AND ref_id = ? AND project_id = ?").bind(ref, ctx.projectId),
      env.DB.prepare("DELETE FROM google_workspace_proposals WHERE integration_id = ? AND project_id = ? AND fingerprint = ? AND status = 'pending'").bind(ctx.integrationId, ctx.projectId, ref),
      env.DB.prepare('DELETE FROM demand_signals WHERE id = ? AND project_id = ?').bind(row.local_id, ctx.projectId),
      unlink, log,
    ]);
    return row.module;
  }
  if (row.local_table === 'interview_sessions') {
    const { session } = await writableSession(env, ctx.userId, row.local_id);
    if (Number(session.project_id) !== ctx.projectId) return null;
    await deleteSession(env, session, ctx.userId);
    await env.DB.batch([unlink, log]);
    return row.module;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The From Google read
// ---------------------------------------------------------------------------

/** What `parts.from_google` draws on one Validate module, for the member's own connection. */
export async function validateFromGoogle(env: Env, ctx: { userId: number; projectId: number; integrationId: number }, module: ValidateGoogleModule) {
  const files = module === 'experiments' ? [] : ((await env.DB.prepare(
    `SELECT uid, name, kind, status, last_error, last_synced_at, modified_time, mapping_json FROM google_workspace_files
      WHERE integration_id = ? AND user_id = ? AND project_id = ? AND module = ? AND status <> 'stopped' ORDER BY id`,
  ).bind(ctx.integrationId, ctx.userId, ctx.projectId, module).all<any>()).results || []).map((f: any) => ({
    uid: f.uid, name: f.name, kind: f.kind, status: f.status, last_error: f.last_error, last_synced_at: f.last_synced_at,
    modified_time: f.modified_time, mapped: !!f.mapping_json,
  }));
  const facts = module === 'demand_signals' ? ((await env.DB.prepare(
    `SELECT f.id, f.last_seen_at, d.id AS signal_id, d.kind, d.signal_date, d.status FROM connector_fed_items f
       JOIN demand_signals d ON d.id = f.local_id AND d.project_id = f.project_id
      WHERE f.integration_id = ? AND f.project_id = ? AND f.module = 'demand_signals' AND f.local_table = 'demand_signals' ORDER BY d.signal_date DESC, d.id DESC LIMIT 200`,
  ).bind(ctx.integrationId, ctx.projectId).all<any>()).results || []).map((r: any) => ({
    id: Number(r.id), source: 'Google Forms', as_of: r.last_seen_at, record: `signal-${r.signal_id}`, kind: r.kind,
    label: `${KIND_WORDS[r.kind] ?? r.kind} · ${r.signal_date}`, status: r.status,
  })) : module === 'customer_research' ? ((await env.DB.prepare(
    `SELECT f.id, f.last_seen_at, s.id AS session_id, i.interviewee_name FROM connector_fed_items f
       JOIN interview_sessions s ON s.id = f.local_id AND s.project_id = f.project_id
       JOIN discovery_interviews i ON i.id = s.interview_id
      WHERE f.integration_id = ? AND f.project_id = ? AND f.module = 'customer_research' AND f.local_table = 'interview_sessions' ORDER BY f.id DESC LIMIT 200`,
  ).bind(ctx.integrationId, ctx.projectId).all<any>()).results || []).map((r: any) => ({
    id: Number(r.id), source: 'Google Docs', as_of: r.last_seen_at, record: `session-${r.session_id}`, label: `Notes on ${r.interviewee_name}`,
  })) : [];
  const proposals = module === 'experiments' ? ((await env.DB.prepare(
    `SELECT id, title, payload_json FROM google_workspace_proposals
      WHERE integration_id = ? AND project_id = ? AND module = 'experiments' AND status = 'pending' ORDER BY id`,
  ).bind(ctx.integrationId, ctx.projectId).all<any>()).results || []).map((p: any) => ({
    id: Number(p.id), title: p.title, source: 'Google Forms', record: `signal-${Number(JSON.parse(p.payload_json || '{}').signal_id)}`,
  })) : [];
  const deleted = module === 'experiments' ? null : Number((await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM connector_fed_items WHERE integration_id = ? AND project_id = ? AND module = ? AND local_id IS NULL',
  ).bind(ctx.integrationId, ctx.projectId, module).first<{ n: number }>())?.n ?? 0);
  return { state: 'ok', module, files, facts, proposals, deleted };
}
