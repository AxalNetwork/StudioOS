import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import ZoneToolbar from '../workspaces/ZoneToolbar';
import ZoneDraft from '../workspaces/ZoneDraft';
import { Instrument, NotRecorded, SourceLegend } from '../workspaces/canvasKit';

/**
 * Network · Relationships — the firm's book, and who at the firm owns each row.
 *
 * WHAT THIS REPLACED. A card grid over `partner_relationships`, with a violet
 * gradient hero, a 0–100 STRENGTH SLIDER a person dragged, and a "New
 * Relationship" modal asking for a raw "Partner User ID (e.g. 42)". That table
 * is a partner-to-partner edge — `partner_a_id`, `partner_b_id`,
 * `CHECK (partner_a_id < partner_b_id)`, `strength_score REAL DEFAULT 50` — and
 * models "these two partners know each other". The `pn1` artboard is a firm's
 * book of the PEOPLE it knows at client companies. Different objects; migration
 * 224 gives the book its own table and the partner graph keeps its own.
 *
 * THE SLIDER IS THE THING THE ARTBOARD REFUSES, in as many words: its fourth
 * tile reads `Firm-wide warmth score · Not recorded · no such score exists —
 * strength is per-row and shows its derivation`, and its instNote says
 * "strength is never a warmth number presented as fact". A number that defaults
 * to 50, is dragged by hand, and renders as a gradient bar labelled "62/100" is
 * precisely that. Strength here is DERIVED from logged interactions — how many,
 * how recently — and every row prints the two numbers it came from.
 *
 * AN UNOWNED ROW IS THE FINDING, NOT A BLANK. "The failure mode this page
 * exists to surface is an owned relationship with no owner", so unassigned rows
 * sort to the top and read in red rather than sitting quietly in alphabetical
 * order. Nothing defaults an owner — not even the person who added the contact —
 * because a default would hide every instance of the thing being looked for.
 *
 * TWO TOUCHES AND NO DATES IS NOT ENOUGH TO CALL ANYTHING. A contact with
 * interactions but no dated one reads `Not recorded` for strength rather than
 * `Thin`, which is the artboard's own Yusuf Demir row and the distinction the
 * old slider could not express at all.
 */

// The artboard's own window: past sixty days is going cold. Not ninety — that
// is `MarketZone`'s attachment gate, a different question about a different
// object, and transcribing one onto the other is how two numbers become one.
export const COLD_AT = 60;

const daysSince = (iso) => {
  const at = Date.parse(iso || '');
  return Number.isFinite(at) ? Math.floor((Date.now() - at) / 86400000) : null;
};

/**
 * Strength, and the derivation it has to show.
 *
 * Returns `null` when there is nothing to judge on — no dated interaction —
 * because a count alone cannot distinguish twenty touches last week from twenty
 * touches three years ago, and calling either "Thin" would be inventing the
 * half that is missing.
 */
export function strengthOf(count, days) {
  if (days === null) return null;
  if (count >= 20 && days <= 30) return 'Strong';
  if (count >= 8 && days <= COLD_AT) return 'Working';
  return 'Thin';
}

/** The four chips, as predicates over the assembled rows. */
const NARROW = {
  unassigned: (r) => !r.firm_owner,
  owned: (r) => !!r.firm_owner,
  cold: (r) => r.days !== null && r.days > COLD_AT,
};

/**
 * `zoneActions` and `zoneFilters` are handed down bound.
 * `/network/relationships` is one route for four licences whose zone actions
 * differ; `/relationships` passes nothing and gets nothing. See
 * `workspaces/zoneActionsByRole.js`.
 */
export function RelationshipsPanel({ zoneActions, zoneFilters = null, role = 'partner' }) {
  const [state, setState] = useState({ loading: true, error: '', items: [], owners: [] });
  const [filter, setFilter] = useState('unassigned');
  const [busy, setBusy] = useState(false);
  const [logging, setLogging] = useState(null);
  const [assigning, setAssigning] = useState(false);

  // THE ROSTER LOADS WITH THE BOOK, not when the picker opens. A row's `Take
  // it` needs the caller's own user id — the write takes an id, never a "me"
  // token, because the server is the one place that knows who may own a row and
  // it validates against the same list this returns.
  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    const [book, owners] = await Promise.allSettled([api.partnerBook(), api.partnerBookOwners()]);
    if (book.status !== 'fulfilled') {
      setState({
        loading: false, items: [], owners: [],
        error: book.reason?.message || 'Your book could not be read.',
      });
      return;
    }
    setState({
      loading: false,
      error: owners.status === 'fulfilled' ? '' : 'The firm roster could not be read, so ownership cannot be changed here.',
      items: book.value?.items || [],
      owners: owners.status === 'fulfilled' ? (owners.value?.items || []) : [],
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const me = state.owners.find((o) => o.is_me) || null;

  const rows = useMemo(() => {
    const withAge = state.items.map((c) => {
      const days = daysSince(c.last_interaction_at);
      return { ...c, days, strength: strengthOf(c.interaction_count, days) };
    });
    // UNASSIGNED FIRST, THEN COLDEST — the artboard's own order, and the reason
    // this page is a table rather than an alphabetical grid. An undated contact
    // sorts as maximally cold within its group: nobody knows when it was last
    // touched, which is not better than knowing it was long ago.
    return withAge.sort((a, b) =>
      (a.firm_owner ? 1 : 0) - (b.firm_owner ? 1 : 0)
      || (b.days ?? Number.MAX_SAFE_INTEGER) - (a.days ?? Number.MAX_SAFE_INTEGER));
  }, [state.items]);

  const visible = NARROW[filter] ? rows.filter(NARROW[filter]) : rows;
  const choose = (key) => setFilter((current) => (current === key ? 'all' : key));

  // COUNTED OVER THE WHOLE BOOK, NEVER OVER THE CHIP-NARROWED LIST.
  const orphans = rows.filter((r) => !r.firm_owner);
  const platform = rows.filter((r) => r.source === 'platform');
  const orgs = new Set(rows.map((r) => r.organization).filter(Boolean));

  const setOwner = async (uid, firmOwnerId) => {
    setBusy(true);
    try {
      await api.partnerBookSetOwner(uid, firmOwnerId);
      await load();
    } catch {
      setState((c) => ({ ...c, error: 'That could not be changed.' }));
    } finally { setBusy(false); }
  };

  const addContact = async (fields) => {
    setBusy(true);
    try {
      await api.partnerBookAdd(fields);
      await load();
      return true;
    } catch (e) {
      setState((c) => ({ ...c, error: e?.message || 'That contact could not be added.' }));
      return false;
    } finally { setBusy(false); }
  };

  const logInteraction = async (uid, happenedAt) => {
    setBusy(true);
    try {
      await api.partnerBookLogInteraction(uid, { happened_at: happenedAt });
      setLogging(null);
      await load();
    } catch {
      setState((c) => ({ ...c, error: 'That interaction could not be logged.' }));
    } finally { setBusy(false); }
  };

  // THE TWO OPS THE ARTBOARD DRAWS, AND NEITHER IS A SHORTCUT TO A CHIP.
  // `Assign owner` opened as `setFilter('unassigned')` in a first draft, which
  // is what the `Unassigned first` chip beside it already does — two controls
  // performing one act, one of them named after an act it does not perform. It
  // opens the board where ownership is actually changed.
  const handlers = {
    assignOwner: {
      onClick: () => setAssigning(true),
      disabled: rows.length === 0 || state.owners.length === 0,
      title: state.owners.length === 0
        ? 'the firm roster could not be read, so there is nobody to assign to'
        : (orphans.length === 0
          ? 'every contact has an owner — this reassigns them'
          : `${orphans.length} contact${orphans.length === 1 ? '' : 's'} nobody at the firm owns`),
    },
    logInteraction: {
      onClick: () => setLogging(visible[0]?.uid || rows[0]?.uid || null),
      disabled: rows.length === 0,
      title: 'record a touch against a contact, dated when it happened',
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
        <h2 className="text-lg font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Firm relationship book</h2>
        <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">
          Contacts, their firm owner, and recorded last interaction. A contact nobody owns sorts
          to the top.
        </p>
      </div>

      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{state.error}</div>
      )}

      {/* THE ARTBOARD'S FOUR TILES. Three count rows; the fourth is the one it
          refuses to compute, and says why. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Contacts" value={rows.length} note={`across ${orgs.size} organization${orgs.size === 1 ? '' : 's'}`} />
        <Tile label="Unassigned" value={orphans.length} note="no one at the firm owns these" />
        <Tile label="Platform-sourced" value={platform.length} note="read-only to the firm" />
        <Tile
          label="Firm-wide warmth score"
          nr
          note="no such score exists — strength is per-row and shows its derivation"
        />
      </div>

      {/* Both marks or neither. The canvas draws this legend unconditionally,
          because its seven sample rows always carry both; a real book with no
          platform row would get a legend explaining a cyan mark that is
          nowhere on the page. Wording is the canvas's own. */}
      {platform.length > 0 && platform.length < rows.length && (
        <SourceLegend
          theirs="Platform"
          theirsNote="came in through the platform — read-only to the firm"
          ours="Ours"
          oursNote="the firm’s own outreach, editable"
        />
      )}

      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">
          Your book is empty. Nothing is inferred from your other records — a contact is here
          because someone put it here, or because it arrived through the platform.
        </p>
      ) : (
        <Instrument
          testid="relationship-book"
          title="Contacts"
          meta="Unassigned first, then coldest"
          cols="1.3fr 1.5fr 1.1fr 1.1fr 1.2fr"
          head={['Contact', 'Organization', 'Firm owner', 'Last interaction', 'Strength']}
          rows={visible.map((r) => ({
            key: r.uid,
            // The row that needs acting on, tinted so the eye finds it before
            // the column does.
            rowClass: r.firm_owner ? '' : 'bg-red-50/40 dark:bg-red-950/20',
            cells: [
              { text: r.name, sub: r.role_title },
              {
                text: r.organization,
                nr: !r.organization,
                seam: r.source === 'platform' ? (r.source_label || 'From the platform') : null,
                ours: r.source === 'platform' ? null : 'Ours',
              },
              r.firm_owner
                ? { text: r.firm_owner.name }
                : {
                  text: 'Unassigned',
                  orph: 'Orphaned',
                  node: me ? (
                    <button type="button" disabled={busy} onClick={() => setOwner(r.uid, me.user_id)}
                      className="text-[11px] text-gray-500 underline hover:text-gray-700 dark:text-gray-400">
                      Take it
                    </button>
                  ) : null,
                },
              r.last_interaction_at
                ? {
                  text: r.last_interaction_at,
                  ...(r.days > COLD_AT ? { pill: 'Going cold', pillTone: 'warn' } : {}),
                  node: (
                    <button type="button" disabled={busy} onClick={() => setLogging(r.uid)}
                      className="text-[11px] text-gray-500 underline hover:text-gray-700 dark:text-gray-400">
                      Log a touch
                    </button>
                  ),
                }
                : {
                  nr: true,
                  node: (
                    <button type="button" disabled={busy} onClick={() => setLogging(r.uid)}
                      className="text-[11px] text-gray-500 underline hover:text-gray-700 dark:text-gray-400">
                      Log a touch
                    </button>
                  ),
                },
              // STRENGTH, WITH ITS DERIVATION UNDER IT — and deliberately NOT a
              // pill. The artboard writes `cell(s.t, { sub: s.sub })`: plain
              // text over a small grey line reading "14 recorded interactions ·
              // last 6 d ago". A coloured chip would make the label the thing
              // the eye lands on and the derivation the footnote, which is the
              // reading order the 0–100 gradient bar had and the reason it was
              // wrong. `null` means there is nothing to judge on, and says so.
              r.strength
                ? {
                  text: r.strength,
                  sub: `${r.interaction_count} recorded interaction${r.interaction_count === 1 ? '' : 's'} · last ${r.days} d ago`,
                }
                : { nr: true },
            ],
          }))}
          note={`Strength is derived from what is logged and shows its working on every row: a contact with interactions but no dated one reads "Not recorded" rather than "Thin", because two touches and no dates is not enough to call anything. ${orphans.length ? `${orphans.length} contact${orphans.length === 1 ? '' : 's'} here ${orphans.length === 1 ? 'has' : 'have'} nobody at the firm responsible for ${orphans.length === 1 ? 'it' : 'them'}` : 'Every contact has an owner'} — which is the failure this page sorts for, not a display artefact.`}
        />
      )}

      {/* WHERE A CONTACT COMES FROM, AND WHY THIS IS NOT IN THE OPS ROW. The
          artboard's ops are `Assign owner · Log interaction · Export` and it
          draws no `Add contact`, because its book already has seven rows. A
          real firm's book starts at zero, and a page whose every element is
          correct over a table nothing can ever put a row into is the same empty
          surface this zone was reported for. So the form is the page's own, the
          way Library's upload is, and the header row stays the artboard's. */}
      <AddContact busy={busy} onAdd={addContact} />

      {!visible.length && rows.length > 0 && (
        <p className="text-[12px] text-gray-600 dark:text-gray-300">
          {filter === 'cold'
            ? `Nothing in the book is past ${COLD_AT} days.`
            : (filter === 'unassigned'
              ? 'Every contact has an owner.'
              : 'No contact matches this view.')}
        </p>
      )}

      {logging && <LogModal uid={logging} busy={busy} onClose={() => setLogging(null)} onSave={logInteraction} />}

      {assigning && (
        <AssignModal
          rows={rows}
          owners={state.owners}
          busy={busy}
          onClose={() => setAssigning(false)}
          onSet={setOwner}
        />
      )}

      <ZoneDraft
        surface="network/relationships"
        label="Draft · orphan reassignment"
        accept="Accept draft"
        run="Draft the reassignment"
        foot="Derived from logged interactions only."
        empty="Points to the contacts nobody owns and, for each, who at the firm has the most recorded interactions with that organization — including the ones where nobody does, which is itself the finding."
        nothingToDraft="Every contact has an owner, so there is nothing to reassign."
      />
    </div>
  );
}

/**
 * The add form. `Organization` is a first-class field and not an afterthought:
 * it is the column `contacts` never had — the absence that makes the founder
 * and investor Organizations roll-up permanently empty (task #94) — and the one
 * `pn3`'s intended-shape table would group by.
 *
 * NO OWNER FIELD HERE, DELIBERATELY. A new contact arrives unowned, sorts to the
 * top in red, and stays there until someone takes it. Offering to pre-fill the
 * adder as owner would make the page's own finding almost unreachable, since the
 * person entering a contact is rarely the person who will carry it.
 */
function AddContact({ busy, onAdd }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', organization: '', role_title: '', email: '' });
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-[12px] text-gray-600 hover:border-gray-400 dark:border-gray-700 dark:text-gray-300">
        + Add a contact to the book
      </button>
    );
  }
  return (
    <form
      className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!f.name.trim()) return;
        if (await onAdd(f)) { setF({ name: '', organization: '', role_title: '', email: '' }); setOpen(false); }
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <input required value={f.name} onChange={set('name')} placeholder="Name" aria-label="Contact name"
          className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
        <input value={f.organization} onChange={set('organization')} placeholder="Organization" aria-label="Organization"
          className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
        <input value={f.role_title} onChange={set('role_title')} placeholder="Role at that organization" aria-label="Role title"
          className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
        <input type="email" value={f.email} onChange={set('email')} placeholder="Email (optional)" aria-label="Email"
          className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="submit" disabled={busy || !f.name.trim()}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-50">
          {busy ? 'Adding…' : 'Add to book'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-gray-500 underline">Cancel</button>
        <span className="text-[11px] text-gray-500">Arrives unowned, at the top of the book.</span>
      </div>
    </form>
  );
}

/**
 * `Assign owner` — the whole book, unassigned first, one select per row.
 *
 * IT LISTS OWNED ROWS TOO, and that is not scope creep. An owner who leaves the
 * firm is the case that produces orphans in the first place, and a board that
 * could only ever add an owner would have no way to say "this is no longer
 * mine". `— Unassigned —` is a real choice here for the same reason the PATCH
 * accepts `null`.
 *
 * The roster is the server's, not a free-text field: a name typed here would be
 * a claim about a person the product cannot check, and the write refuses any id
 * outside the caller's own firm.
 */
function AssignModal({ rows, owners, busy, onClose, onSet }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-extrabold tracking-tight">Assign owner</h3>
        <p className="mt-1 text-[11.5px] text-gray-600 dark:text-gray-400">
          Someone at the firm is responsible for each contact. Unassigned first.
        </p>
        <div className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <div key={r.uid} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 ${
              r.firm_owner ? 'border-axal-hairline dark:border-gray-800' : 'border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20'}`}>
              <span className="min-w-0 text-[11.5px]">
                <span className="font-semibold">{r.name}</span>
                {r.organization ? <span className="text-gray-500"> · {r.organization}</span> : null}
              </span>
              <select
                value={r.firm_owner?.id ?? ''}
                disabled={busy}
                aria-label={`Firm owner for ${r.name}`}
                onChange={(e) => onSet(r.uid, e.target.value === '' ? null : Number(e.target.value))}
                className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-[11.5px] dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="">— Unassigned —</option>
                {owners.map((o) => (
                  <option key={o.user_id} value={o.user_id}>{o.name}{o.is_me ? ' (you)' : ''}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Logging a touch asks WHEN IT HAPPENED and defaults to today rather than
 * stamping the server clock. A call last month recorded now is a month-old
 * touch, and treating it as fresh would make `Going cold` report on data entry
 * instead of on the relationship.
 */
function LogModal({ uid, busy, onClose, onSave }) {
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 10));
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-extrabold tracking-tight">Log an interaction</h3>
        <p className="mt-1 text-[11.5px] text-gray-600 dark:text-gray-400">
          The date it happened, not the date you are recording it.
        </p>
        <input
          type="date"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          aria-label="When the interaction happened"
          className="mt-3 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
            Cancel
          </button>
          <button
            type="button" disabled={busy} onClick={() => onSave(uid, when)}
            className="rounded bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Log it'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, note, nr = false }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-gray-600 dark:text-gray-300">{label}</div>
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
