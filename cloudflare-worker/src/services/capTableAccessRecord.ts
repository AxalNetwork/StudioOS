/** D1130: venture grants and links read recorded issuances, never scenarios or proposals. */
import type { AccessLevel } from './captableShare';
import type { readRecord } from './capTableRecord';
type RecordRead = Awaited<ReturnType<typeof readRecord>>;
type Holder = { holder_id: number | null; name: string | null };
const key = (h: Holder) => h.holder_id != null ? `holder:${h.holder_id}` : `name:${String(h.name).trim().toLowerCase()}`;

/** Old name grants remain valid only when they resolve to exactly one recorded identity. */
export function recordHolder(record: RecordRead, ref: string | null): Holder | null {
  if (!ref) return null;
  const identities = new Map<string, Holder>();
  for (const row of record.issuances.rows.filter(r => r.status === 'recorded')) {
    if (row.holder?.name) identities.set(key(row.holder), row.holder);
    if (row.from_holder?.name) identities.set(key(row.from_holder), row.from_holder);
  }
  const match = [...identities.values()].filter(h => /^holder:[1-9][0-9]*$/.test(ref)
    ? key(h) === ref : String(h.name).trim().toLowerCase() === ref.trim().toLowerCase());
  return match.length === 1 ? match[0] : null;
}

export function recordAccessView(record: RecordRead, level: Exclude<AccessLevel, 'none'>, holderRef: string | null) {
  const holders = record.by_holder as { available: boolean; sentence?: string; rows?: Array<Holder & { kind: string | null; shares: number; options: number }> };
  const fd = record.fully_diluted as { available: boolean; shares?: number; unallocated_pool?: number | null; sentence?: string };
  const pct = (shares: number) => fd.available && typeof fd.shares === 'number' && fd.shares > 0 ? Math.round(shares / fd.shares * 1_000_000) / 10_000 : null;
  const positions = (holders.available ? holders.rows || [] : []).flatMap(h => [
    ...(h.shares ? [{ identity: key(h), holder: h.name || 'Not recorded', kind: h.kind, type: h.kind === 'founder' ? 'founder' : h.kind === 'investor' ? 'preferred' : 'common', shares: h.shares, pct: pct(h.shares) }] : []),
    ...(h.options ? [{ identity: key(h), holder: h.name || 'Not recorded', kind: h.kind, type: 'option_pool', shares: h.options, pct: pct(h.options) }] : []),
  ]);
  const groupOf = (h: typeof positions[number]) => h.type === 'option_pool' ? 'Option pool' : h.kind === 'founder' ? 'Founders' : h.kind === 'investor' ? 'Investors' : 'Other';
  const groups = new Map<string, number>();
  for (const h of positions) groups.set(groupOf(h), (groups.get(groupOf(h)) ?? 0) + h.shares);
  if (fd.available && fd.unallocated_pool != null) groups.set('Option pool', (groups.get('Option pool') ?? 0) + fd.unallocated_pool);
  const summary = fd.available ? [...groups].map(([group, shares]) => ({ group, pct: pct(shares) })) : [];
  const splitReason = fd.available ? null : fd.sentence || 'Fully diluted ownership is not recorded.';
  const copyPosition = (h: typeof positions[number]) => ({ holder: h.holder, type: h.type, shares: h.shares, pct: h.pct });
  const selected = recordHolder(record, holderRef);
  const mine = (h: Holder | null | undefined) => h != null && selected != null && key(h) === key(selected);
  const instrument = (i: RecordRead['instruments']['rows'][number]) => ({
    instrument: i.kind, amount: i.amount_cents == null ? null : i.amount_cents / 100,
    currency: i.currency, cap: i.terms.cap_cents == null ? null : i.terms.cap_cents / 100,
    discount: i.terms.discount_bps == null ? null : i.terms.discount_bps / 10000,
    basis: i.terms.basis, issue_date: i.issued_on,
  });
  if (level === 'own_position') return {
    level, holder: selected?.name || 'Not recorded',
    position: selected ? positions.filter(h => h.identity === key(selected)).map(copyPosition) : [],
    instruments: record.instruments.rows.filter(i => mine(i.holder)).map(instrument),
    documents: record.issuances.rows.filter(i => i.status === 'recorded' && mine(i.holder) && i.document_ref).map(() => ({ title: 'Recorded document', status: 'recorded' })),
    summary, split_reason: splitReason,
    disclosure: selected ? 'Your recorded position and the group split. Saved scenarios and proposals are excluded.' : 'No unique recorded holder matches this grant. Ask the founder to update it.',
  };
  if (!holders.available && record.instruments.rows.length === 0) return { recorded: false, reason: holders.sentence || 'No ownership has been recorded for this venture yet.' };
  if (level === 'summary') return { audience: level, scenario_name: 'Cap table · on record', rounds_completed: null, summary, split_reason: splitReason, disclosure: 'Recorded ownership by group. Financing-round count is not recorded.' };
  const visible = level === 'full' ? positions.map(copyPosition) : positions.filter(h => h.type !== 'option_pool' && ['founder', 'investor'].includes(h.kind || '')).map(copyPosition);
  if (level === 'investor') {
    for (const group of ['Option pool', 'Other']) {
      const shares = groups.get(group);
      if (shares != null) visible.push({ holder: group, type: group === 'Option pool' ? 'option_pool' : 'common', shares, pct: pct(shares) });
    }
  } else if (fd.available && fd.unallocated_pool != null) visible.push({ holder: 'Unallocated option pool', type: 'option_pool', shares: fd.unallocated_pool, pct: pct(fd.unallocated_pool) });
  return { audience: level, scenario_name: 'Cap table · on record', rounds_completed: null, founding: visible, rounds: [], split_reason: splitReason,
    instruments: record.instruments.rows.filter(i => level === 'full' || (i.holder != null && ['founder', 'investor'].includes(i.holder_kind || ''))).map(i => ({ holder: i.holder?.name || 'Not recorded', ...instrument(i) })),
    disclosure: 'Recorded positions. Saved scenarios, proposals and private notes are excluded. Financing-round history is not recorded. Instruments with no recorded holder kind are omitted at Investor level.',
  };
}
