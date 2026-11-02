/**
 * D1511 (#3762, deck v2 A18) — a reply checked against its contract schema.
 *
 * The subset of JSON Schema the contracts here use, and nothing more: `type`
 * (object, array, string, integer, number, boolean, null, or a list of these), `required`,
 * `properties`, `additionalProperties: false`, `items`, `minItems`,
 * `maxItems`, `enum`, `const`, `minimum`, `maximum` and a local `$ref` to
 * `#/$defs/<name>`. A keyword it does not know is an error, so a schema can
 * never ask for a check that silently does not run. Pure.
 */
type Schema = Record<string, any>;

const KNOWN = new Set(['$id', '$defs', '$ref', 'title', 'description', 'type', 'required', 'properties', 'additionalProperties', 'items', 'minItems', 'maxItems', 'enum', 'const', 'minimum', 'maximum']);

const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Every way `value` breaks `schema`, as `<path>: <rule>`; [] when it holds. */
export function contractErrors(schema: Schema, value: unknown, root: Schema = schema, path = '$'): string[] {
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) return [`${path}: the schema uses ${k}, which the validator does not check`];
  if (schema.$ref) {
    const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(schema.$ref);
    const target = m ? root.$defs?.[m[1]] : null;
    return target ? contractErrors(target, value, root, path) : [`${path}: unknown $ref ${schema.$ref}`];
  }
  const out: string[] = [];
  if (schema.const !== undefined && !same(schema.const, value)) out.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e: unknown) => same(e, value))) out.push(`${path}: must be one of ${JSON.stringify(schema.enum)}`);
  if (schema.type) {
    const t = typeOf(value);
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.includes(t) || (types.includes('number') && t === 'integer');
    if (!ok) return [...out, `${path}: must be ${types.join(' or ')}, is ${t}`];
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) out.push(`${path}: must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) out.push(`${path}: must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push(`${path}: needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push(`${path}: holds at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => out.push(...contractErrors(schema.items, v, root, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in obj)) out.push(`${path}: missing ${k}`);
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) out.push(...contractErrors(props[k], v, root, `${path}.${k}`));
      else if (schema.additionalProperties === false) out.push(`${path}: ${k} is not in the contract`);
    }
  }
  return out;
}
