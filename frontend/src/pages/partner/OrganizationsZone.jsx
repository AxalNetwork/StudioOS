import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../workspaces/canvasKit';

/**
 * Network · Organizations — the empty state IS the page, and the artboard says so.
 *
 * WHAT WAS HERE. Nothing. `NetworkPage` catches a slug it has no tab for
 * (`unservedZone`), suppresses every body (`unservedAlone`), and renders a
 * dashed card whose whole content is one paragraph: "Grouping your network by
 * company, fund or firm needs a link from a person you know to the organisation
 * they are in, and nothing on this licence records one." That was true and it
 * was the honest answer at the time. Migration 224 put a company name on every
 * book contact, so the sentence stopped being true for this licence while
 * staying true for founder and investor — whose `contacts` table still has no
 * organisation column at all (task #94), which is a different finding and stays
 * where it is.
 *
 * THE ARTBOARD IS NOT A TABLE WITH AN EMPTY STATE. It is an empty state with a
 * table under it, and its blurb is explicit about why: "no aggregation over the
 * relationship book exists in the product today, so the empty state is the
 * primary composition here and the populated table below it is what the roll-up
 * would look like once built." So the dashed card comes first, at full weight,
 * with its own heading, body, two controls and an honest line — and the
 * instrument below it is titled `Intended shape` and says on its own meta line
 * that it is rendered from contacts rather than from a roll-up.
 *
 * WHAT IS REAL AND WHAT IS NOT, PER COLUMN:
 *
 *   `Organization`        — real: the distinct company names on the contacts.
 *   `Relationship`        — real: migration 226, set per contact. `Mixed` when
 *                           two contacts at one company disagree, because the
 *                           firm never stated one answer and picking the newest
 *                           would be this page inventing it.
 *   `People known`        — real: how many contacts carry that company name,
 *                           and the artboard's own finding is that it is
 *                           almost always one.
 *   `Engagement sourced`  — NOT RECORDED. Nothing links a book contact to an
 *                           engagement: `engagements` joins a partner to a
 *                           `projects` row, and matching a free-text company
 *                           name against a project name would be a guess
 *                           printed as a fact about a client's work.
 *   `Headcount`           — NOT RECORDED, and the artboard is emphatic: "an
 *                           estimate here would be the first invented number in
 *                           the firm's own record of who it knows."
 *
 * D68 IS WHY TWO COLUMNS OF `Not recorded` ARE DRAWN RATHER THAN DROPPED. They
 * are not a tile with no store behind it — that is D56 and stays undrawn. They
 * are the page's finding about the reader's own book, which is exactly what
 * this artboard exists to state.
 */

const KIND_LABEL = { client: 'Client', prospect: 'Prospect', referral_source: 'Referral source' };
const KIND_TONE = { Client: 'ok', Prospect: 'warn', 'Referral source': 'cite', Mixed: 'neutral' };

/** The four chips, over the grouped rows. */
const NARROW = {
  clients: (o) => o.kind === 'Client',
  prospects: (o) => o.kind === 'Prospect',
  referrals: (o) => o.kind === 'Referral source',
};

/**
 * Group the book by the company text on each contact.
 *
 * THE GROUPING KEY IS TRIMMED AND CASE-FOLDED AND THE LABEL IS NOT. "Verwood"
 * and "verwood " are one company to a reader and would be two rows to a naive
 * group-by, which would then report "every row knows exactly one person" as a
 * finding about the firm's relationships when it was a finding about
 * whitespace. The label shown is the first spelling entered, because the page
 * has no basis for preferring another.
 */
export function rollUp(contacts) {
  const by = new Map();
  for (const c of contacts) {
    const name = (c.organization || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!by.has(key)) by.set(key, { key, name, people: 0, kinds: new Set() });
    const row = by.get(key);
    row.people += 1;
    if (c.relationship) row.kinds.add(KIND_LABEL[c.relationship] || c.relationship);
  }
  return [...by.values()]
    .map((row) => ({
      ...row,
      // NULL, ONE, OR MIXED — three outcomes and no tie-break. `Mixed` names
      // both values rather than choosing, which is the same refusal the
      // Headcount column makes by staying absent.
      kind: row.kinds.size === 1 ? [...row.kinds][0] : (row.kinds.size > 1 ? 'Mixed' : null),
      kindList: [...row.kinds].sort(),
    }))
    .sort((a, b) => b.people - a.people || a.name.localeCompare(b.name));
}

/**
 * `zoneActions` and `zoneFilters` come down bound from `NetworkWorkspace`, the
 * same shape the other two Network zones take.
 */
export default function OrganizationsZone({ zoneActions, zoneFilters = null, role = 'partner' }) {
  const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      const r = await api.partnerBook();
      setState({ loading: false, error: '', items: r?.items || [] });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Your book could not be read.', items: [] });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => rollUp(state.items), [state.items]);
  const visible = NARROW[filter] ? rows.filter(NARROW[filter]) : rows;
  const choose = (key) => setFilter((current) => (current === key ? 'all' : key));

  // COUNTED OVER THE WHOLE ROLL-UP, NEVER OVER THE CHIP-NARROWED LIST.
  const clients = rows.filter((o) => o.kind === 'Client');
  const unplaced = state.items.filter((c) => !(c.organization || '').trim()).length;

  /**
   * `Build records` — and it is a real act, performed in the only place the
   * product has for it.
   *
   * There is no organization table, so nothing here creates one. What the firm
   * CAN record is what each company is to it, and migration 226 put that on the
   * contact. So the board lists every company in the roll-up and writes one
   * relationship across every contact at it — which is how a `Mixed` row is
   * resolved, and the closest honest thing to "building a record" that this
   * store supports. Drawing the artboard's accent control and wiring it to
   * nothing was the alternative, and a dead accent button is the one failure
   * this whole header-row vocabulary exists to refuse.
   */
  const setRelationship = async (org, value) => {
    setBusy(true);
    try {
      const at = state.items.filter((c) => (c.organization || '').trim().toLowerCase() === org.key);
      for (const c of at) await api.partnerBookSetRelationship(c.uid, value);
      await load();
    } catch {
      setState((c) => ({ ...c, error: 'That could not be changed.' }));
    } finally { setBusy(false); }
  };

  const handlers = {
    buildRecords: {
      onClick: () => setBuilding(true),
      disabled: rows.length === 0,
      title: rows.length === 0
        ? 'no contact in the book carries a company name yet'
        : 'record what each company is to the firm — the only organization fact this store holds',
    },
  };

  if (state.loading) return <Loading />;

  return (
    <div className="space-y-4">
      {(zoneActions || zoneFilters) && (
        <ZoneToolbar
          className="mb-3"
          role={role}
          filters={zoneFilters ? zoneFilters({ value: filter, onChange: choose }) : []}
          actions={zoneActions ? zoneActions(visible, handlers) : []}
        />
      )}

      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Organizations</h2>
        <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">
          Organizations, the people known inside them, and engagements sourced.
        </p>
      </div>

      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{state.error}</div>
      )}

      {/* ══ THE PRIMARY COMPOSITION. Dashed, full weight, first on the page. ══ */}
      <div className="rounded-[10px] border border-dashed border-gray-300 bg-gray-50/60 p-6 dark:border-gray-700 dark:bg-gray-900/40">
        <div className="max-w-2xl">
          <Eyebrow className="!text-axal-amber-deep dark:!text-amber-300">Nothing to roll up yet</Eyebrow>
          <h3 className="mt-2 text-[17px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">
            The roll-up is not built yet.
          </h3>
          <p className="mt-2 text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">
            Organizations would aggregate from the {state.items.length} contact{state.items.length === 1 ? '' : 's'} in
            the relationship book — grouping people by employer, attaching the engagements each company produced, and
            marking which arrived through the platform. None of that aggregation runs today: the book stores a company
            name per contact as text, with no organization record behind it.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
    
            <button
              type="button"
              disabled={rows.length === 0}
              onClick={() => setBuilding(true)}
              title="record what each company is to the firm — the only organization fact this store holds"
              className="rounded-[7px] border border-amber-600 bg-amber-600 px-[11px] py-1.5 text-[11px] font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Build organization records
            </button>
            <Link
              to="/network/relationships"
              className="inline-flex items-center rounded-[7px] border border-gray-200 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              View the book instead
            </Link>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
            What follows is the shape the roll-up would take, rendered from the same {state.items.length} contact
            {state.items.length === 1 ? '' : 's'}. Headcount, sector and revenue columns are absent rather than
            estimated — the book holds none of them.
            {unplaced > 0 && ` ${unplaced} contact${unplaced === 1 ? ' has' : 's have'} no company name at all and
            ${unplaced === 1 ? 'is' : 'are'} in no row below.`}
          </p>
        </div>
      </div>

      {/* THE ARTBOARD'S FOUR TILES. The third is a literal zero and the fourth
          is undrawn — both are the page's own subject rather than decoration. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Companies in the book" value={rows.length} note="as text on contacts, not records" />
        {/* THE CANVAS'S NOTE ON THIS TILE IS THE ONE PIECE OF ITS COPY THIS
            PAGE DOES NOT USE. It reads "each with a live engagement", which is a
            claim about engagements — and nothing links a book contact to one,
            which is exactly what the Engagement sourced column says by staying
            absent. Printing it would make the tile assert on screen the fact the
            table two rows below refuses to assert. */}
        <Tile label="Clients" value={clients.length} note="marked as a client on a contact" />
        <Tile label="Organization records" value={0} note="nothing to aggregate over yet" />
        <Tile label="Headcount, sector" nr note="the book holds neither — never estimated" />
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          No contact in your book carries a company name, so there is nothing to group. Nothing is inferred from an
          email domain.
        </p>
      ) : (
        <Instrument
          testid="organizations-intended-shape"
          title="Intended shape"
          meta="Rendered from contacts · not a live roll-up"
          cols="1.6fr 1.1fr .9fr 1.6fr 1fr"
          head={['Organization', 'Relationship', 'People known', 'Engagement sourced', 'Headcount']}
          rows={visible.map((o) => ({
            key: o.key,
            cells: [
              { text: o.name },
              o.kind
                ? {
                  pill: o.kind,
                  pillTone: KIND_TONE[o.kind] || 'neutral',
                  sub: o.kind === 'Mixed' ? o.kindList.join(' · ') : null,
                }
                : { nr: true },
              { text: String(o.people), sub: o.people === 1 ? 'one contact carries this account' : null },
              // Two columns the book cannot fill, drawn rather than dropped:
              // this is the reader's own record having no such fact (D68), not
              // the product having no store for one (D56).
              { nr: true },
              { nr: true },
            ],
          }))}
          note={`Every row here knows ${rows.every((o) => o.people === 1) ? 'exactly one person' : 'only the people entered against it'}, which is the roll-up's real finding rather than a display artefact: where the firm's relationship with a company rests on a single contact, losing that person loses the account. Headcount reads "Not recorded" on all ${rows.length} row${rows.length === 1 ? '' : 's'} because the book stores no such field, and an estimate here would be the first invented number in the firm's own record of who it knows. Engagement sourced reads the same way for a different reason: an engagement is recorded against a project, and matching it to a company name typed on a contact would be a guess printed as a fact about a client's work.`}
        />
      )}

      {!visible.length && rows.length > 0 && (
        <p className="text-[12px] text-gray-600 dark:text-gray-300">
          No company in the book is marked as this. A relationship is set on a contact, from the book.
        </p>
      )}

      {building && (
        <BuildModal
          rows={rows}
          busy={busy}
          onClose={() => setBuilding(false)}
          onSet={setRelationship}
        />
      )}

      <ZoneDraft
        surface="network/organizations"
        label="Draft · single-contact exposure"
        accept="Accept draft"
        run="Draft the exposure"
        foot="Counted from book contacts."
        empty="Points to every company the firm knows through exactly one person, and to what that relationship carries. Names the exposure; the second contact is a person's job to make."
        nothingToDraft="No company in your book carries a name yet, so there is no exposure to count."
      />
    </div>
  );
}

/**
 * The board behind `Build records`.
 *
 * ONE SELECT PER COMPANY, WRITTEN TO EVERY CONTACT AT IT. The store holds the
 * relationship on the contact because there is nowhere else to put it, and a
 * reader thinking about Thornbury Capital is not thinking about which of their
 * people they happened to enter first. Setting it here writes the same value
 * across the group, which is also how a `Mixed` row is resolved.
 *
 * `— Not recorded —` STAYS A CHOICE. A company wrongly marked a client is worse
 * than one unmarked, and a value that can only ever be set is one nobody can
 * correct.
 */
function BuildModal({ rows, busy, onClose, onSet }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-extrabold tracking-tight">What each company is to the firm</h3>
        <p className="mt-1 text-[11.5px] text-gray-600 dark:text-gray-400">
          Recorded on the contacts at that company, because there is no organization record to hold it.
        </p>
        <div className="mt-3 space-y-1.5">
          {rows.map((o) => (
            <div key={o.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-axal-hairline p-2 dark:border-gray-800">
              <span className="min-w-0 text-[11.5px]">
                <span className="font-semibold">{o.name}</span>
                <span className="text-gray-500"> · {o.people} contact{o.people === 1 ? '' : 's'}</span>
                {o.kind === 'Mixed' ? <span className="text-amber-700 dark:text-amber-300"> · disagrees today</span> : null}
              </span>
              <select
                value={o.kind && o.kind !== 'Mixed'
                  ? Object.keys(KIND_LABEL).find((k) => KIND_LABEL[k] === o.kind) || ''
                  : ''}
                disabled={busy}
                aria-label={`Relationship with ${o.name}`}
                onChange={(e) => onSet(o, e.target.value || null)}
                className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-[11.5px] dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="">— Not recorded —</option>
                {Object.entries(KIND_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm text-gray-700 dark:text-gray-300">Done</button>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, note, nr = false }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5">
        {nr ? <NotRecorded /> : (
          <span className="font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{value}</span>
        )}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-20 text-sm text-gray-500">
      <Loader2 className="animate-spin" size={16} /> Loading…
    </div>
  );
}
