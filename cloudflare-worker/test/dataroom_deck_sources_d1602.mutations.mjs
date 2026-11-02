/** D1602 mutation proof. Run from any directory with Node 22+; no source file is edited.
 * node cloudflare-worker/test/dataroom_deck_sources_d1602.mutations.mjs
 * Optional: --case=count-integrality (one variant, with restored controls).
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'd1602-mutations-'));
const hook = join(scratch, 'hook.mjs'), register = join(scratch, 'register.mjs');
// Each subprocess gets its own loader/variant. Controls use the same loader
// without an edit. Exact-case resolution also works on case-insensitive Macs.
writeFileSync(hook, `
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const m=JSON.parse(process.env.D1602_MUTANT || 'null');
export async function resolve(specifier,context,next) {
 if(context.parentURL && /^\\.\\.?\\//.test(specifier)) {
  const p=fileURLToPath(new URL(specifier,context.parentURL));
  if(!/\\.(tsx|ts|jsx|js|mjs|cjs|json)$/.test(p)) {
   let names=[];try{names=readdirSync(path.dirname(p));}catch{}
   for(const ext of ['.tsx','.ts','.jsx','.js','.mjs','.cjs','.json'])
    if(names.includes(path.basename(p)+ext))return {url:pathToFileURL(p+ext).href,shortCircuit:true};
  }
 }
 return next(specifier,context);
}
export async function load(url,context,next) {
 if(m && url.startsWith('file:') && fileURLToPath(url).endsWith('/'+m.file)) {
  let raw=readFileSync(new URL(url),'utf8');
  for(const [from,to] of m.edits) {
   if(!raw.includes(from))throw new Error('mutation_target_absent');
   raw=raw.replaceAll(from,to);
  }
  if(m.file.endsWith('.jsx')) {
   const {transformWithOxc}=await import(${JSON.stringify(pathToFileURL(resolve(root, 'frontend/node_modules/vite/dist/node/index.js')).href)});
   return {format:'module',source:(await transformWithOxc(raw,fileURLToPath(url),{jsx:{runtime:'automatic'}})).code,shortCircuit:true};
  }
  return {...await next(url,context),source:raw};
 }
 return next(url,context);
}`);
writeFileSync(register, `
import fs from 'node:fs';
import {register,syncBuiltinESMExports} from 'node:module';
const m=JSON.parse(process.env.D1602_MUTANT || 'null');
// SQL is read as data rather than imported. Alter that read in this isolated
// process, with the same unchanged on-disk source as module mutations.
if(m?.file.endsWith('.sql')) {
 const original=fs.readFileSync;
 fs.readFileSync=function(p,...args) {
  const value=original.call(this,p,...args);
  if(!String(p).endsWith('/'+m.file))return value;
  let text=String(value);
  for(const [from,to] of m.edits) {
   if(!text.includes(from))throw new Error('mutation_target_absent');
   text=text.replaceAll(from,to);
  }
  return typeof value==='string'?text:Buffer.from(text);
 };
 syncBuiltinESMExports();
}
register(${JSON.stringify(pathToFileURL(hook).href)},import.meta.url);`);

// A variant removes a real safety/control branch; a failing assertion must
// reject it. Syntax/import failures do not count as killed mutations.
const variants = [
  {"name":"post-conversion-deadline","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["if (sourceState(current).extraction.state === 'unreadable') throw new Error('extraction_unreadable');","if (false) throw new Error('extraction_unreadable');"]],"pattern":"conversion crossing"},
  {"name":"premature-conversion-deadline","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["if (sourceState(current).extraction.state === 'unreadable') throw new Error('extraction_unreadable');","if (true) throw new Error('extraction_unreadable');"]],"pattern":"conversion crossing"},
  {"name":"swap-archive-precondition","file":"cloudflare-worker/src/routes/data_room.ts","edits":[["AND EXISTS (SELECT 1 FROM data_room_file_versions WHERE id = ? AND file_id = ? AND r2_key = ?)","AND (? IS NOT NULL AND ? IS NOT NULL AND ? IS NOT NULL)"]],"pattern":"stale make-current pair"},
  {"name":"swap-first-write-guard","file":"cloudflare-worker/src/routes/data_room.ts","edits":[["AND changes() = 1",""]],"pattern":"stale make-current pair"},
  {"name":"cofounder-owner-gate","file":"cloudflare-worker/src/routes/data_room.ts","edits":[["if (room.role !== 'owner') return c.json(OWNER_ONLY, 403);","if (false) return c.json(OWNER_ONLY, 403);"]],"pattern":"untagged"},
  {"name":"admin-support-gate","file":"cloudflare-worker/src/routes/data_room.ts","edits":[["if (user.role === 'admin') return c.json({ code: 'support_read_required'","if (false) return c.json({ code: 'support_read_required'"]],"pattern":"untagged"},
  {"name":"boolean-body","file":"cloudflare-worker/src/routes/data_room.ts","edits":[["typeof body.enabled !== 'boolean'","false"]],"pattern":"untagged"},
  {"name":"quote-required","file":"cloudflare-worker/src/routes/data_room.ts","edits":[["body.confirm_quote !== quote.confirm_quote","false"]],"pattern":"PDF requires"},
  {"name":"withdraw-delete","file":"cloudflare-worker/src/routes/data_room.ts","edits":[["DELETE FROM dataroom_deck_values WHERE project_id = ? AND file_uid = ?'","DELETE FROM dataroom_deck_values WHERE 0 AND project_id = ? AND file_uid = ?'"]],"pattern":"CSV is code"},
  {"name":"replace-invalidate","file":"cloudflare-worker/src/routes/data_room.ts","edits":[["...(deckReady ? resetSourceStatements(env, file.id, project.id, key, null, a.userId) : [])","...[]"]],"pattern":"replacing and making"},
  {"name":"make-current-invalidate","file":"cloudflare-worker/src/routes/data_room.ts","edits":[["...(deckReady ? resetSourceStatements(c.env, file.id, project.id, version.r2_key, swapToken, Number(user.id)) : [])","...[]"]],"pattern":"replacing and making"},
  {"name":"delete-without-fks","file":"cloudflare-worker/src/routes/data_room.ts","edits":[["DELETE FROM dataroom_deck_values WHERE project_id = ? AND file_uid IN","DELETE FROM dataroom_deck_values WHERE 0 AND project_id = ? AND file_uid IN"]],"pattern":"replacing and making"},
  {"name":"job-single-claim","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["AND deck_extract_started_at IS NULL`)","`)"]],"pattern":"PDF requires"},
  {"name":"job-project-prefix","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[[" || !file.r2_key.startsWith(`data-room/${project.uid}/`)",""]],"pattern":"cited PDF values"},
  {"name":"metered-run","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["const result = await run(env, { ...opts, rail: opts.rail, surface: AI_SURFACE.raiseDataRoom });","const result = { ok: true, output: '[]' };"]],"pattern":"PDF requires"},
  {"name":"typed-citation","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["if (!valuesFromRows(evidence, page).some(v => v.slot === slot && v.value === value)) continue;","if (false) continue;"]],"pattern":"injected document"},
  {"name":"typed-page","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["pages.find(p => p.page === page)","pages[0]"]],"pattern":"injected document"},
  {"name":"typed-unit","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[[" || u !== unit(slot)",""]],"pattern":"XLSX reads"},
  {"name":"typed-exact-schema","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[[" || Object.keys(row).sort().join(',') !== 'page,slot,unit,value'",""]],"pattern":"XLSX reads"},
  {"name":"count-integrality","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["(slot === 'dataroom.revenue_plan' || Number.isSafeInteger(raw))","true"]],"pattern":"XLSX reads"},
  {"name":"word-pagination","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["if (pages.length === 1 && recorded !== 1) return [];","if (false) return [];"]],"pattern":"XLSX reads"},
  {"name":"xlsx-string-number","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["(type == null || type === 'n') && v != null","(type == null || type === 'n' || type === 'str') && v != null"]],"pattern":"XLSX reads"},
  {"name":"csv-latest-year","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["if (!slot) continue;","if (!slot || slot === \"dataroom.revenue_plan\") continue;"]],"pattern":"CSV is code"},
  {"name":"csv-conflict","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["return [...found.values()].filter(v => !conflicts.has(v.slot));","return [...found.values()];"]],"pattern":"code readers"},
  {"name":"adapter-tagged","file":"cloudflare-worker/src/services/decks/sources.ts","edits":[["AND f.deck_source = 1 AND f.deck_extract_state = 'done'","AND f.deck_extract_state = 'done'"]],"pattern":"CSV is code"},
  {"name":"adapter-done","file":"cloudflare-worker/src/services/decks/sources.ts","edits":[["AND f.deck_extract_state = 'done'",""]],"pattern":"CSV is code"},
  {"name":"adapter-revision","file":"cloudflare-worker/src/services/decks/sources.ts","edits":[["AND v.file_version = f.deck_source_revision",""]],"pattern":"CSV is code"},
  {"name":"adapter-grade","file":"cloudflare-worker/src/services/decks/sources.ts","edits":[["as_of: row.as_of, origin: 'file'","as_of: row.as_of, origin: 'typed'"]],"pattern":"CSV is code"},
  {"name":"prompt-figure-leak","file":"cloudflare-worker/src/services/decks/newDeck.ts","edits":[["(k.startsWith('dataroom.') ? 'Recorded; placed by code' : valueText(it) ?? 'Not recorded')","valueText(it)"]],"pattern":"CSV is code"},
  {"name":"untrusted-framing","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["untrustedBlock('data_room_document', text)","text"]],"pattern":"injected document"},
  {"name":"ui-capability","file":"frontend/src/pages/raise/dataroom/DataRoomDeckSource.jsx","edits":[["if (!room?.deck_sources_available) return null;","if (false) return null;"]],"pattern":"owner opts"},
  {"name":"ui-owner","file":"frontend/src/pages/raise/dataroom/DataRoomDeckSource.jsx","edits":[["const owner = room.role === 'owner';","const owner = true;"]],"pattern":"owner opts"},
  {"name":"ui-confirm-resend","file":"frontend/src/pages/raise/dataroom/DataRoomDeckSource.jsx","edits":[["confirm_quote: ask.quote.confirm_quote","confirm_quote: 'wrong'"]],"pattern":"typed quote"},
  {"name":"ui-hold-units","file":"frontend/src/pages/raise/dataroom/DataRoomDeckSource.jsx","edits":[["ask.quote.hold_microusd / 1_000_000","ask.quote.hold_microusd / 100"]],"pattern":"typed quote"},
  {"name":"ui-withdraw","file":"frontend/src/pages/raise/dataroom/DataRoomDeckSource.jsx","edits":[["enabled: !enabled","enabled: enabled"]],"pattern":"withdraw confirms"},
  {"name":"losing-swap-guard","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["AND (? IS NULL OR deck_source_token = ?)","AND (? IS NULL OR ? IS NOT NULL)"]],"pattern":"replacing and making"},
  {"name":"truncated-page-citation","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["const pages = boundedPages(await documentPages(env, bytes, kind));","const pages = await documentPages(env, bytes, kind);"]],"pattern":"Word page beyond"},
  {"name":"founder-billing","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["const opts = options(file, file.deck_source_user_id!, pages, approval!.model);","const opts = options(file, 2, pages, approval!.model);"]],"pattern":"PDF requires"},
  {"name":"upload-day","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["const asOf = object.uploaded.toISOString().slice(0, 10);","const asOf = '2026-11-01';"]],"pattern":"CSV is code"},
  {"name":"queue-deadline","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["&& Date.now() - Date.parse(since) > (file.deck_extract_started_at ? 300_000 : 1_800_000)","&& false"]],"pattern":"never-started"},
  {"name":"late-job-refusal","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["if (sourceState(file).extraction.state === 'unreadable') {","if (false) {"]],"pattern":"never-started"},
  {"name":"ceiling-before-read","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["q.hold_microusd > approval.hold_microusd","false"]],"pattern":"collaborator document changes"},
  {"name":"approver-erasure","file":"cloudflare-worker/sql/migrations/753_dataroom_deck_values.sql","edits":[["REFERENCES users(id) ON DELETE SET NULL","REFERENCES users(id)"]],"pattern":"migration cascades"},
  {"name":"file-cascade","file":"cloudflare-worker/sql/migrations/753_dataroom_deck_values.sql","edits":[["REFERENCES data_room_files(uid) ON DELETE CASCADE","REFERENCES data_room_files(uid)"]],"pattern":"migration cascades"},
  {"name":"project-cascade","file":"cloudflare-worker/sql/migrations/753_dataroom_deck_values.sql","edits":[["REFERENCES projects(id) ON DELETE CASCADE","REFERENCES projects(id)"]],"pattern":"migration cascades"},
  {"name":"stop-polling","file":"frontend/src/pages/raise/dataroom/DataRoomDeckSource.jsx","edits":[["file.extraction?.state !== 'queued'","false"]],"pattern":"polling stops"},
  {"name":"partial-numeric-row","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["return text.length <= limit ? text : text.slice(0, Math.max(0, text.lastIndexOf('\\n', limit)));","return text.slice(0, limit);"]],"pattern":"character ceiling"},
  {"name":"fixed-year-header","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["YEAR_HEADERS.has(label(String(r[0] ?? '')))","true"]],"pattern":"code readers"},
  {"name":"csv-eof-flush","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }","if (false) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }"]],"pattern":"CSV flushes"},
  {"name":"xml-comment-cells","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["at = end + 3; continue;\n    }\n    if (s.startsWith('<![CDATA['","text += keepMarkup ? s.slice(open, end + 3) : ''; at = end + 3; continue;\n    }\n    if (s.startsWith('<![CDATA['"]],"pattern":"CSV flushes"},
  {"name":"xml-cdata-text","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["text += xmlEscape(s.slice(open + 9, end));","text += '';"]],"pattern":"CSV flushes"},
  {"name":"xml-quoted-attribute","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["if (quote) { if (char === quote) quote = ''; }","if (false) { if (char === quote) quote = ''; }"]],"pattern":"CSV flushes"},
  {"name":"xml-declaration-refusal","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["if (s.startsWith('<!', open)) throw new Error('unsupported_xml_declaration');","if (s.startsWith('<!', open)) { at = s.indexOf('>', open) + 1; continue; }"]],"pattern":"unsupported XML declarations"},
  {"name":"xml-malformed-attribute","file":"cloudflare-worker/src/services/decks/dataroomFormats.ts","edits":[["if (char === '<') throw new Error('invalid_office_file');","if (false) throw new Error('invalid_office_file');"]],"pattern":"CSV flushes"},
  {"name":"collaborator-approval","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["CASE WHEN deck_source_user_id = ? THEN deck_source_quote","CASE WHEN ? > 0 THEN deck_source_quote"]],"pattern":"collaborator document changes"},
  {"name":"replacement-actor","file":"cloudflare-worker/src/routes/data_room.ts","edits":[["resetSourceStatements(env, file.id, project.id, key, null, a.userId)","resetSourceStatements(env, file.id, project.id, key, null, 1)"]],"pattern":"collaborator document changes"},
  {"name":"make-current-actor","file":"cloudflare-worker/src/routes/data_room.ts","edits":[["resetSourceStatements(c.env, file.id, project.id, version.r2_key, swapToken, Number(user.id))","resetSourceStatements(c.env, file.id, project.id, version.r2_key, swapToken, 1)"]],"pattern":"collaborator document changes"},
  {"name":"failure-diagnostic","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["VALUES ('WARN','dataroomExtract','Data-room extraction failed',?)","SELECT 'WARN','dataroomExtract','Data-room extraction failed',? WHERE 0"]],"pattern":"unexpected failure diagnostics"},
  {"name":"diagnostic-content","file":"cloudflare-worker/src/services/decks/dataroomExtract.ts","edits":[["codes.find(c => error instanceof Error && c === error.message) ?? 'extraction_failed'","error instanceof Error ? error.message : 'extraction_failed'"]],"pattern":"unexpected failure diagnostics"},
  {"name":"owner-confirmation-label","file":"frontend/src/pages/raise/dataroom/DataRoomDeckSource.jsx","edits":[["reason === 'owner_confirmation_required' ? 'Owner confirmation needed'","false ? 'Owner confirmation needed'"]],"pattern":"collaborator update asks"},
  {"name":"owner-confirmation-action","file":"frontend/src/pages/raise/dataroom/DataRoomDeckSource.jsx","edits":[["onClick={() => setAsk({ enabled: true })}","onClick={() => setAsk({ enabled: false })}"]],"pattern":"collaborator update asks"}
];

async function run(kind, variant = null) {
  const frontend = kind === 'frontend';
  const args = ['--experimental-strip-types', '--no-warnings', '--import',
    frontend ? './frontend/test/_deck-loader.mjs' : './cloudflare-worker/test/_ts-loader.mjs',
    '--import', register, '--test', ...(variant ? [`--test-name-pattern=${variant.pattern}`] : []),
    frontend ? 'frontend/test/dataroom_deck_source_d1602.test.mjs' : 'cloudflare-worker/test/dataroom_deck_sources_d1602.test.ts'];
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, D1602_MUTANT: JSON.stringify(variant) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    child.on('error', fail); child.on('close', code => done({ code, output }));
  });
}

try {
  const only = process.argv.find(v => v.startsWith('--case='))?.slice(7);
  const selected = only ? variants.filter(v => only.split(',').includes(v.name)) : variants;
  if (!selected.length) throw new Error('No such mutation');
  for (const v of selected) for (const [from] of v.edits) {
    if (!readFileSync(resolve(root, v.file), 'utf8').includes(from)) throw new Error(`Stale mutation: ${v.name}`);
  }
  const kinds = [...new Set(selected.map(v => v.file.startsWith('frontend/') ? 'frontend' : 'worker'))];
  for (const kind of kinds) {
    const r = await run(kind);
    if (r.code !== 0) throw new Error(`Control failed before mutations (${kind}):\n${r.output}`);
  }
  let killed = 0;
  for (let i = 0; i < selected.length; i += 2) {
    await Promise.all(selected.slice(i, i + 2).map(async v => {
      const r = await run(v.file.startsWith('frontend/') ? 'frontend' : 'worker', v);
      if (r.code === 0 || /mutation_target_absent|SyntaxError|ERR_MODULE_NOT_FOUND/.test(r.output)) throw new Error(`Mutation was not assertion-rejected: ${v.name}\n${r.output}`);
      killed++; console.log(`killed: ${v.name}`);
    }));
  }
  for (const kind of kinds) {
    const r = await run(kind);
    if (r.code !== 0) throw new Error(`Restored control failed (${kind}):\n${r.output}`);
  }
  console.log(`${killed}/${selected.length} mutations rejected; original controls pass before and after.`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
