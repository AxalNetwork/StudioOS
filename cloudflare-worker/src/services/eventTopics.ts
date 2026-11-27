/** D1487 (#3724): host-set event topics and the shared recommendation vocabulary. */
export const EVENT_TOPICS = ['fundraising', 'ai', 'go_to_market', 'hiring', 'climate', 'product', 'finance', 'legal', 'leadership', 'networking'] as const;
export function validEventTopics(value: unknown, max = 5): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(v => typeof v === 'string' && (EVENT_TOPICS as readonly string[]).includes(v)) && new Set(value).size === value.length;
}
export function eventTopics(raw: unknown): string[] {
  try { const v = typeof raw === 'string' ? JSON.parse(raw) : raw; return validEventTopics(v) ? v : []; } catch { return []; }
}
