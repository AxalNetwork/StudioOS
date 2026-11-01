/**
 * D1511 (#3762) — a small JSON Schema (2020-12) validator for the contract
 * schemas in `cloudflare-worker/src/contracts/`. No dependency: the repo had
 * none, and the contracts need only this subset.
 *
 * Supported: type (one or a list; "integer" is a whole number), enum, const,
 * properties, required, additionalProperties (false or a schema), items,
 * minItems, maxItems, minimum, maximum, exclusiveMinimum, minLength,
 * maxLength, pattern, anyOf, oneOf, allOf, and local `$ref` (`#/$defs/<name>`).
 * Metadata ($schema, $id, $comment, title, description, $defs and any `x-`
 * key) is read by nobody here.
 *
 * ANY OTHER KEYWORD THROWS. A validator that skipped a keyword it does not
 * know would pass a reply the schema means to refuse, so a schema can only
 * say what this file checks.
 *
 * `validate(schema, value)` → `[]` when the value matches, else one line per
 * failure, each naming its JSON path (`$.cards[0].areas[1].c2`).
 */
const META = new Set(['$schema', '$id', '$comment', 'title', 'description', '$defs', 'examples']);
const CHECKS = new Set([
  'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems',
  'minimum', 'maximum', 'exclusiveMinimum', 'minLength', 'maxLength', 'pattern', 'anyOf', 'oneOf', 'allOf', '$ref',
]);

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const isType = (v, t) => (t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeOf(v) === t);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function resolveRef(root, ref) {
  const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
  if (!m || !root.$defs || !root.$defs[m[1]]) throw new Error(`json schema: unresolvable $ref ${ref}`);
  return root.$defs[m[1]];
}

function check(root, schema, value, path, out) {
  if (schema === true) return;
  if (schema === false) { out.push(`${path}: no value is allowed here`); return; }
  for (const k of Object.keys(schema)) {
    if (!CHECKS.has(k) && !META.has(k) && !k.startsWith('x-')) throw new Error(`json schema: unsupported keyword "${k}" at ${path}`);
  }
  if (schema.$ref) check(root, resolveRef(root, schema.$ref), value, path, out);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => isType(value, t))) { out.push(`${path}: expected ${types.join(' or ')}, got ${typeOf(value)}`); return; }
  }
  if (schema.enum && !schema.enum.some((e) => same(e, value))) out.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  if ('const' in schema && !same(schema.const, value)) out.push(`${path}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) out.push(`${path}: ${value} < minimum ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) out.push(`${path}: ${value} > maximum ${schema.maximum}`);
    if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) out.push(`${path}: ${value} ≤ exclusiveMinimum ${schema.exclusiveMinimum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) out.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) out.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern != null && !new RegExp(schema.pattern, 'u').test(value)) out.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) out.push(`${path}: ${value.length} items, fewer than ${schema.minItems}`);
    if (schema.maxItems != null && value.length > schema.maxItems) out.push(`${path}: ${value.length} items, more than ${schema.maxItems}`);
    if (schema.items != null) value.forEach((v, i) => check(root, schema.items, v, `${path}[${i}]`, out));
  }
  if (typeOf(value) === 'object') {
    for (const k of schema.required ?? []) if (!(k in value)) out.push(`${path}: missing required "${k}"`);
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      if (k in props) check(root, props[k], v, `${path}.${k}`, out);
      else if (schema.additionalProperties === false) out.push(`${path}: unexpected property "${k}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') check(root, schema.additionalProperties, v, `${path}.${k}`, out);
    }
  }
  if (schema.allOf) for (const s of schema.allOf) check(root, s, value, path, out);
  if (schema.anyOf && !schema.anyOf.some((s) => { const o = []; check(root, s, value, path, o); return !o.length; })) out.push(`${path}: matches none of anyOf`);
  if (schema.oneOf) {
    const hits = schema.oneOf.filter((s) => { const o = []; check(root, s, value, path, o); return !o.length; }).length;
    if (hits !== 1) out.push(`${path}: matches ${hits} of oneOf, not exactly 1`);
  }
}

export function validate(schema, value) {
  const out = [];
  check(schema, schema, value, '$', out);
  return out;
}
