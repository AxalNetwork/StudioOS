/** Private advisor profile drafts, with revision checks for edits and publishing. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { advisorDto, loadAdvisorById, profileWriteFields } from '../services/advisorProfile';
import { type AdvisorRow, requireMyAdvisor, sentRevision, validationRefusal } from '../services/advisorPractice';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import advisors from './advisors';

const profileDraft = new Hono<{ Bindings: Env }>();

type ProfileDraftRow = { revision: string; base_revision: string; fields_json: string; updated_at: string };

function loadProfileDraft(env: Env, advisorId: number) {
  return env.DB.prepare('SELECT revision, base_revision, fields_json, updated_at FROM advisor_profile_drafts WHERE advisor_id = ?')
    .bind(advisorId).first<ProfileDraftRow>();
}

function profileDraftDto(row: ProfileDraftRow, published: AdvisorRow) {
  const { fields_json, ...metadata } = row;
  return { ...metadata, stale: row.base_revision !== published.updated_at,
    profile: advisorDto({ ...published, ...JSON.parse(fields_json) }) };
}

const DRAFT_CHANGED = { code: 'profile_draft_conflict', message: 'The profile or draft changed. Reopen the draft before continuing.' } as const;
const DRAFT_STALE = { code: 'profile_draft_stale', message: 'The published profile changed after this draft was saved. Discard the draft to start from the current profile.' } as const;

profileDraft.get('/me/profile-draft', async (c) => {
  try {
    const advisor = await requireMyAdvisor(c, await requireAuth(c));
    const row = await loadProfileDraft(c.env, advisor.id);
    return c.json({ draft: row ? profileDraftDto(row, advisor) : null });
  } catch (e) { return mapError(c, e); }
});

profileDraft.patch('/me/profile-draft', async (c) => {
  try {
    const user = await requireAuth(c);
    const advisor = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return refuse(c, 400, { code: 'profile_draft_required', message: 'Send the profile fields you want to save.' });
    }
    const current = await loadProfileDraft(c.env, advisor.id);
    const expected = sentRevision(body);
    if ((current?.revision ?? null) !== expected) return refuse(c, 409, DRAFT_CHANGED);
    if (current && current.base_revision !== advisor.updated_at) return refuse(c, 409, DRAFT_STALE);
    const source = current ? { ...advisor, ...JSON.parse(current.fields_json) } : advisor;
    const fields = profileWriteFields(source, body, user.name || user.email);
    const draft = { revision: newUid(), base_revision: advisor.updated_at,
      fields_json: JSON.stringify(fields), updated_at: nowIso() };
    const saved = await c.env.DB.prepare(
      `INSERT INTO advisor_profile_drafts (advisor_id, revision, base_revision, fields_json, updated_at)
       SELECT id, ?, updated_at, ?, ? FROM advisors
        WHERE id = ? AND user_id = ? AND updated_at IS ?
          AND (? IS NULL OR EXISTS (
            SELECT 1 FROM advisor_profile_drafts d WHERE d.advisor_id = advisors.id AND d.revision = ?
          ))
       ON CONFLICT(advisor_id) DO UPDATE SET revision = excluded.revision, fields_json = excluded.fields_json,
         updated_at = excluded.updated_at WHERE advisor_profile_drafts.revision IS ?`
    ).bind(draft.revision, draft.fields_json, draft.updated_at, advisor.id, user.id, advisor.updated_at,
      expected, expected, expected).run();
    if (!saved.meta.changes) return refuse(c, 409, DRAFT_CHANGED);
    return c.json({ draft: profileDraftDto(draft, advisor) });
  } catch (e) { return validationRefusal(c, e) ?? mapError(c, e); }
});

profileDraft.post('/me/profile-draft/publish', async (c) => {
  try {
    const user = await requireAuth(c);
    const advisor = await requireMyAdvisor(c, user);
    const revision = sentRevision(await c.req.json().catch(() => null));
    const draft = await loadProfileDraft(c.env, advisor.id);
    if (!draft || revision !== draft.revision) return refuse(c, 409, DRAFT_CHANGED);
    if (draft.base_revision !== advisor.updated_at) return refuse(c, 409, DRAFT_STALE);
    const now = nowIso();
    const publishedAt = now === advisor.updated_at ? new Date(Date.parse(now) + 1).toISOString() : now;
    const result = await c.env.DB.prepare(
      `UPDATE advisor_profile_drafts SET publish_requested_at = ?
        WHERE advisor_id = ? AND revision = ? AND EXISTS (
          SELECT 1 FROM advisors a WHERE a.id = advisor_profile_drafts.advisor_id
            AND a.user_id = ? AND a.updated_at IS advisor_profile_drafts.base_revision
        )`
    ).bind(publishedAt, advisor.id, revision, user.id).run();
    if (!result.meta.changes) return refuse(c, 409, DRAFT_CHANGED);
    const published = await loadAdvisorById(c.env, advisor.id);
    return c.json(advisorDto(published!));
  } catch (e) { return mapError(c, e); }
});

profileDraft.delete('/me/profile-draft', async (c) => {
  try {
    const advisor = await requireMyAdvisor(c, await requireAuth(c));
    const revision = sentRevision(await c.req.json().catch(() => null));
    const result = await c.env.DB.prepare('DELETE FROM advisor_profile_drafts WHERE advisor_id = ? AND revision = ?')
      .bind(advisor.id, revision).run();
    if (!result.meta.changes) return refuse(c, 409, DRAFT_CHANGED);
    return c.json({ draft: null });
  } catch (e) { return mapError(c, e); }
});

export const mount: RouteMount[] = [
  { path: '/api/advisors', router: profileDraft, before: [advisors] },
  { path: '/api/mentors', router: profileDraft, before: [advisors] },
];
