/** Stable semantic identity, excluding mutable field titles and choice order. */
export function mappingSignature(m: { field_id: string; field_type: string; kind: string; rule_json: string; keep_text: number | boolean }): string {
  const rule = JSON.parse(m.rule_json);
  return JSON.stringify([m.field_id, m.field_type, m.kind, [...(rule.choices ?? [])].sort(), rule.equals ?? null, rule.min ?? null, !!m.keep_text]);
}
