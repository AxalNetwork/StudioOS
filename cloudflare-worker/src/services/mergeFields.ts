/**
 * Pure merge-field resolver shared by the legal-template renderer
 * and any other production caller that needs to expand
 * `{{dotted.path}}` placeholders. Lives in its own module (no
 * template imports, no Wrangler `?raw` deps) so it can be exercised
 * by `node --test` smoke tests without dragging in the markdown
 * template bundle.
 */
export function applyMergeFields(
  body: string,
  merge: Record<string, unknown>,
): string {
  // Task #1 (DB) — accept dotted-path tokens like
  // `{{counterparty.founder_id}}`. The lookup walks nested objects;
  // a flat key like `{{recipient_name}}` continues to work because
  // the path of length 1 falls through to the top-level `merge[k]`.
  return body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const v = resolveDotted(merge, path);
    return v == null ? `{{${path}}}` : String(v);
  });
}

function resolveDotted(scope: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = scope;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
