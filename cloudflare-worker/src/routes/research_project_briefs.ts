/** D5157 part 4: private, member-authored project briefs. */
import { Hono } from 'hono';
import { requireAuth } from '../auth';
import type { Env } from '../types';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { checkProjectOwner } from './research_projects';

const briefs = new Hono<{ Bindings: Env }>();
const SECTION_COUNT = 8;
const TEXT_LIMIT = 8000;
type Section = { text: string; reviewed: boolean };
type BriefRow = { sections_json: string; version: number; updated_at: string };

export function readBriefSections(value: unknown): Section[] | null {
  if (!Array.isArray(value) || value.length !== SECTION_COUNT) return null;
  const sections: Section[] = [];
  for (const row of value) {
    if (!row || typeof row.text !== 'string' || row.text.length > TEXT_LIMIT || typeof row.reviewed !== 'boolean') return null;
    const text = row.text.trim();
    sections.push({ text, reviewed: Boolean(text) && row.reviewed });
  }
  return sections.some((section) => section.text) ? sections : null;
}

const dto = (row: BriefRow) => ({
  sections: JSON.parse(row.sections_json) as Section[],
  version: row.version,
  updated_at: row.updated_at,
});

briefs.get('/briefs/saved', async (c) => {
  const user = await requireAuth(c);
  const { results } = await c.env.DB.prepare(
    `SELECT p.uid AS project_uid, p.title, b.updated_at
       FROM research_project_briefs b JOIN research_projects p ON p.id = b.project_id
      WHERE p.owner_user_id = ?
      ORDER BY b.updated_at DESC, b.project_id DESC LIMIT 10`,
  ).bind(user.id).all<{ project_uid: string; title: string; updated_at: string }>();
  return c.json({ items: results });
});

briefs.get('/:uid/brief', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return refuse(c, 404, { code: 'project_not_found', message: 'No such research project.' });
  const row = await c.env.DB.prepare(
    'SELECT sections_json, version, updated_at FROM research_project_briefs WHERE project_id = ?',
  ).bind(project.id).first<BriefRow>();
  return c.json({ brief: row ? dto(row) : null });
});

briefs.put('/:uid/brief', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return refuse(c, 404, { code: 'project_not_found', message: 'No such research project.' });
  if (user.support_session) return refuse(c, 403, { code: 'support_read_only', message: 'Support sessions cannot change research briefs.' });
  if (project.status === 'archived') return refuse(c, 409, { code: 'project_archived', message: 'Restore this project before editing its brief.' });
  const body = await c.req.json().catch(() => null);
  const sections = readBriefSections(body?.sections);
  const version = body?.version;
  if (!sections || !Number.isSafeInteger(version) || version < 0) {
    return refuse(c, 400, { code: 'invalid_brief', message: 'Provide a current version and eight sections, with at least one written section.' });
  }

  const saved = await c.env.DB.prepare(
    `INSERT INTO research_project_briefs (project_id, sections_json)
     SELECT id, ? FROM research_projects
      WHERE id = ? AND owner_user_id = ? AND status != 'archived'
        AND (? = 0 OR EXISTS (SELECT 1 FROM research_project_briefs WHERE project_id = ?))
     ON CONFLICT(project_id) DO UPDATE SET sections_json = excluded.sections_json,
       version = research_project_briefs.version + 1, updated_at = datetime('now')
     WHERE research_project_briefs.version = ?
     RETURNING sections_json, version, updated_at`,
  ).bind(JSON.stringify(sections), project.id, user.id, version, project.id, version).first<BriefRow>();
  if (!saved) return refuse(c, 409, { code: 'brief_changed', message: 'This brief or project changed. Read it again before saving.' });
  return c.json({ brief: dto(saved) });
});

export const mount: RouteMount = { path: '/api/research/projects', router: briefs };
export default briefs;
