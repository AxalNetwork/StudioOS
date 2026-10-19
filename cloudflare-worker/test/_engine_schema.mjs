/**
 * D757 (#1898) — what a test world needs once a session reaches the Validate
 * engine (src/services/validateEngine.ts): migration 487's digest columns,
 * 453's summary columns and receipts (every source is now summarised),
 * the queue the engine's job rides (`queue_jobs`), migration 465's
 * `ai_rail_preferences` (the member's Validate mode and model
 * picks), and the member and venture columns the engine's re-scope reads
 * (`interviewIntake.writableSession`). Call it after `interview_sessions`
 * exists. Every step is skipped when the world already has it, so a fixture
 * that builds part of this itself keeps working.
 */
import { readFileSync } from 'node:fs';
import { tableFromBaseline } from './_baseline.mjs';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (name) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');

export function applyEngineSchema(db) {
  const cols = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
  const add = (table, defs) => {
    const have = cols(table);
    if (!have.size) return;
    for (const [name, def] of defs) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  };
  add('users', [
    ['founder_id', 'INTEGER'], ['spinout_lab_active', 'INTEGER DEFAULT 0'], ['is_active', 'INTEGER DEFAULT 1'],
    ['deletion_requested_at', 'TEXT'], ['jwt_min_iat', 'INTEGER'],
  ]);
  add('projects', [['company_id', 'INTEGER'], ['deleted_at', 'TEXT']]);
  db.exec('CREATE TABLE IF NOT EXISTS pain_groups (id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT)');
  db.exec(migration('465_ai_rail_preferences.sql'));
  // Every source now gets a summary (453's columns and receipts), not only recordings.
  if (!cols('interview_sessions').has('processing_stage')) db.exec(migration('453_interview_processing.sql'));
  if (!cols('interview_sessions').has('digest_status')) db.exec(migration('487_interview_session_digest.sql'));
  // enqueueDigest queues the engine's job (session_structure).
  if (!cols('queue_jobs').size) db.exec(tableFromBaseline(BASELINE, 'queue_jobs'));
}
