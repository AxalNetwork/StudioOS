/**
 * D690's gate, and D1341's (#3549) read of one record through it. The record
 * route (`routes/cycle_records.ts`) and the mail context pack
 * (`services/mail/contextPack.ts`) both use `allowed`, so a draft quotes a
 * record only where the record page would show it.
 */
import type { Env, User } from '../../types';
import { canReadBoard, canWrite, type ProjectRef } from '../../routes/_founder_validate_helpers';
import { specFor } from './index';
import { ownedRow, RECORD_ID } from './owned';
import type { Gate, RecordContent } from './types';

export async function allowed(gate: Gate, project: ProjectRef, user: User, env: Env): Promise<boolean> {
  if (typeof gate === 'function') return gate(project, user, env);
  return gate === 'write' ? canWrite(project, user) : canReadBoard(project, user);
}

export type ReadableRecord = { record: RecordContent; sections: Array<{ key: string; title: string; rows: Array<{ a: string; b?: string; c?: string }> }> };

/**
 * The record as its page reads it: the module's read gate, the id proven in
 * its store for this venture, then each section its own gate admits. Null for
 * anything the member could not open, whatever the reason.
 */
export async function readableRecord(env: Env, user: User, cycle: string, slug: string, project: ProjectRef, id: string): Promise<ReadableRecord | null> {
  const spec = specFor(cycle, slug);
  if (!spec || !RECORD_ID.test(id)) return null;
  if (!await allowed(spec.read, project, user, env)) return null;
  if (!await ownedRow(env, spec.store, id, Number(project.id))) return null;
  const ctx = { env, projectId: Number(project.id), project, user };
  const record = await spec.record(ctx, id);
  const sections: ReadableRecord['sections'] = [];
  for (const section of spec.sections) {
    if (section.gate && !await allowed(section.gate, project, user, env)) continue;
    if (section.when && !section.when(id, record)) continue;
    const data = await section.read(ctx, id, record);
    sections.push({ key: section.key, title: section.title, rows: data.rows.map(({ a, b, c }) => ({ a, b, c })) });
  }
  return { record, sections };
}
