/**
 * Capital's round-term tiles from stores that already hold them (D364). Pure,
 * so node --test runs it.
 *
 *   Instrument · Valuation cap · Discount — the SAFEs and notes on the
 *     startup's cap-table scenario (services/captable.ts SafeIn). These are
 *     the OUTSTANDING instruments the founder modelled in Cap Table, not terms
 *     of the round being raised, so each tile says "outstanding" and where it
 *     came from. Discount is stored as a fraction (0.2) and shown as 20%.
 *   Pro-rata rights — GET /contacts/raise-pro-rata (migration 169): existing
 *     holders tracked against the active round, with the Worker's own
 *     entitlement arithmetic.
 *
 * A tile nothing records stays "Not set"; a store that could not be read is
 * "Couldn't read", never "Not set" — the two are different claims.
 */

const fmtUsd = (v) => {
  if (!Number.isFinite(v)) return null;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
};
const pos = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

const unset = (key, label) => ({ key, label, value: '—', prov: 'unset' });
const unreadable = (key, label) => ({ key, label, value: '—', prov: 'unreadable' });
const range = (vals, fmt) => {
  const uniq = [...new Set(vals)].sort((a, b) => a - b);
  return uniq.length === 1 ? fmt(uniq[0]) : `${fmt(uniq[0])}–${fmt(uniq[uniq.length - 1])}`;
};

/**
 * `scenarioRead`: { status: 'ready', scenario } | { status: 'failed' }.
 * Returns the three instrument tiles.
 */
export function instrumentTiles(scenarioRead) {
  if (!scenarioRead || scenarioRead.status !== 'ready') {
    return [unreadable('instrument', 'Instrument'), unreadable('valuation-cap', 'Valuation cap'), unreadable('discount', 'Discount')];
  }
  const raw = scenarioRead.scenario?.inputs?.safes;
  const safes = Array.isArray(raw) ? raw.filter((s) => pos(s?.amount) !== null) : [];
  if (!safes.length) {
    return [unset('instrument', 'Instrument'), unset('valuation-cap', 'Valuation cap'), unset('discount', 'Discount')];
  }
  const tool = 'Cap Table';
  const n = safes.length;
  const kinds = [...new Set(safes.map((s) => (s.instrument === 'note' ? 'Note' : 'SAFE')))];
  const caps = safes.map((s) => pos(s.cap)).filter((v) => v !== null);
  const discs = safes.map((s) => pos(s.discount)).filter((v) => v !== null && v < 1);
  const of = (k) => (k === n ? `all ${n}` : `${k} of ${n}`);
  return [
    { key: 'instrument', label: 'Instrument', value: `${kinds.join(' + ')} · ${n} outstanding`, prov: 'synced', tool },
    caps.length
      ? { key: 'valuation-cap', label: 'Valuation cap', value: `${range(caps, fmtUsd)} · ${of(caps.length)}`, prov: 'synced', tool }
      : unset('valuation-cap', 'Valuation cap'),
    discs.length
      ? { key: 'discount', label: 'Discount', value: `${range(discs.map((d) => Math.round(d * 1000) / 10), (p) => `${p}%`)} · ${of(discs.length)}`, prov: 'synced', tool }
      : unset('discount', 'Discount'),
  ];
}

/**
 * `proRataRead`: { status: 'ready', data } | { status: 'failed' } |
 * { status: 'unavailable' }. `data` is the Worker's { round, holders, result }.
 */
export function proRataTile(proRataRead) {
  const key = 'pro-rata';
  const label = 'Pro-rata rights';
  if (!proRataRead || proRataRead.status === 'failed') return unreadable(key, label);
  if (proRataRead.status !== 'ready' || !proRataRead.data?.round) return unset(key, label);
  const holders = Array.isArray(proRataRead.data.holders) ? proRataRead.data.holders : [];
  if (!holders.length) return unset(key, label);
  const taking = holders.filter((h) => h.state === 'taking').length;
  const waived = holders.filter((h) => h.state === 'waived' || h.state === 'expired').length;
  const parts = [`${holders.length} holder${holders.length === 1 ? '' : 's'}`];
  if (taking) parts.push(`${taking} taking`);
  if (waived) parts.push(`${waived} waived`);
  return { key, label, value: parts.join(' · '), prov: 'synced', tool: 'Round pro-rata' };
}

/**
 * The pro-rata card's reconciliation sentence, from the Worker's own `rule`.
 * Null when there is nothing to reconcile.
 */
export function proRataRuleCopy(result) {
  if (!result) return null;
  if (result.rule === 'scaled') return 'Rights exceed the reserve, so every entitlement is scaled back in proportion — nobody is cut first.';
  if (result.rule === 'fits') return 'The reserve covers every right in full.';
  if (result.rule === 'raw') return 'No pro-rata reserve is set on the round, so entitlements are the raw right (prior stake × round size).';
  return null;
}
