/** D6558: add a person to the caller's own book, atomically with typed provenance and a pending duplicate review; never contact them. */
import type { Env } from '../types';
import { normaliseEmail, normaliseProfileUrl } from './linkedinCsvImport';

export type TypedContact = { name: string; company: string | null; title: string | null; email: string | null; linkedin_url: string | null };
export function typedContactInput(value: Record<string, unknown>): { contact: TypedContact } | { field: string; message: string } {
  const contact: TypedContact = { name: '', company: null, title: null, email: null, linkedin_url: null };
  for (const field of ['name', 'company', 'title', 'email', 'linkedin_url'] as const) {
    const raw = value[field];
    if (raw == null || raw === '') {
      if (field === 'name') return { field, message: 'Enter the person’s name.' };
      continue;
    }
    if (typeof raw !== 'string' || raw.trim().length > (field === 'email' ? 320 : field === 'linkedin_url' ? 2048 : 200)) {
      return { field, message: 'That field is too long or is not text.' };
    }
    const text = raw.trim();
    if (field === 'name' && !text) return { field, message: 'Enter the person’s name.' };
    if (field === 'email' || field === 'linkedin_url') {
      const normalized = field === 'email' ? normaliseEmail(text) : normaliseProfileUrl(text);
      if (text && !normalized) return { field, message: field === 'email' ? 'Enter a valid email address.' : 'Enter a LinkedIn person’s profile URL.' };
      contact[field] = normalized;
    } else if (field === 'name') contact.name = text;
    else contact[field] = text || null;
  }
  return { contact };
}

/** One D1 transaction: a new book row, its source, then a review of an existing own URL/email match. No candidate is changed. */
export async function addTypedContact(env: Env, owner: number, value: TypedContact) {
  const sourceRef = crypto.randomUUID();
  const reviewUid = crypto.randomUUID();
  const rows = await env.DB.batch<{ id: number }>([
    env.DB.prepare(`INSERT INTO network_connections (user_id, name, email, company, title, linkedin_url, source)
      VALUES (?, ?, ?, ?, ?, ?, 'typed') RETURNING id`)
      .bind(owner, value.name, value.email, value.company, value.title, value.linkedin_url),
    env.DB.prepare(`INSERT INTO contact_sources (owner_user_id, contact_table, contact_id, source, source_ref, created_row)
      VALUES (?, 'network_connections', last_insert_rowid(), 'typed', ?, 1)`).bind(owner, sourceRef),
    env.DB.prepare(`INSERT INTO contact_match_reviews (uid, owner_user_id, contact_id, candidate_table, candidate_id, reason)
      SELECT ?, s.owner_user_id, s.contact_id, 'network_connections', n.id,
        CASE WHEN ? IS NOT NULL AND lower(rtrim(n.linkedin_url, '/')) = ? THEN 'url' ELSE 'email' END
      FROM contact_sources s JOIN network_connections n ON n.user_id = s.owner_user_id
      WHERE s.owner_user_id = ? AND s.source = 'typed' AND s.source_ref = ? AND n.id <> s.contact_id
        AND ((? IS NOT NULL AND lower(rtrim(n.linkedin_url, '/')) = ?) OR (? IS NOT NULL AND lower(trim(n.email)) = ?))
      ORDER BY CASE WHEN ? IS NOT NULL AND lower(rtrim(n.linkedin_url, '/')) = ? THEN 0 ELSE 1 END, n.id LIMIT 1`)
      .bind(reviewUid, value.linkedin_url, value.linkedin_url, owner, sourceRef,
        value.linkedin_url, value.linkedin_url, value.email, value.email, value.linkedin_url, value.linkedin_url),
  ]);
  return { contact_id: Number(rows[0].results?.[0]?.id), review_uid: rows[2].meta?.changes ? reviewUid : null, contacted: false };
}
