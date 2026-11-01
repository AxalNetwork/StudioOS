import { useCallback, useEffect, useState } from 'react';
import { railPrefsApi } from '../lib/api/railPrefs.js';
import { railView } from './railModels';
import { railModelPrice } from './railPrices';
import { Unreadable } from './Honesty';

/**
 * D1604 (#3716, aird1, aird3, aird5) — the AIRail's "Suggested for this
 * page" as one block per element group, for a host that passes `groups` to
 * `WorkerRail` (the pitch pages, `pages/raise/pitch/deckRailGroups.js`).
 * Every other page renders as before.
 *
 * MODELS AND CONSUMPTION ONLY. Each block is a model choice: its name, "Used
 * by: …", and, once opened, its lead option's suggestions from the Worker's
 * matrix (`GET /api/ai/rail?page&option`, at most three, `railView`), each a
 * radio. A pick is stored for every option of the group that offers the
 * model (`PUT /api/ai/rail/pick`); an option that does not keeps its own and
 * the block says which. Nothing here runs a model, takes words or acts on
 * the page. A group whose models are not routed yet reads "Not set up yet"
 * (its title the adapter's reason); Safety is always on and not pickable.
 * Reads are lazy: a group's models load when it is opened.
 *
 * D1503 (#3754): a host group may carry its own `read()` (an answer in
 * `GET /api/ai/rail`'s shape, plus `free` for a group that runs no model)
 * and `pick(model)`; the pitch pages' element groups do, from the Worker's
 * per-element routes. A pick the Worker refuses (HQ's lock, the plan) is
 * undone and its message shown. No other block or layout changes.
 *
 *   RailPresets      Fast · Balanced · Best · Custom, greyed "Coming later"
 *                    while the presets read answers unavailable
 *   RailGroups       the blocks
 *   RailUsageExtra   usage rows the host adds ("Held now"; the deck's
 *                    estimate and spend), each drawn only when its read
 *                    answers, or "Could not be read", never $0.00
 */

export function RailPresets({ presets }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => presets?.read?.()).then((a) => { if (live) setState(a || null); }, () => { if (live) setState(null); });
    return () => { live = false; };
  }, [presets]);
  if (!presets) return null;
  const on = state?.available === true;
  return (
    <div className="fwr-presets" data-testid="worker-rail-presets">
      <span className="fwr-eyebrow">Models</span>
      <div className="fwr-preset-row" role="group" aria-label="Preset">
        {presets.options.map((p) => (
          <span key={p} className="fwr-preset" aria-disabled={on ? undefined : 'true'} title={on ? undefined : state?.reason || presets.later}
            data-testid={`text-worker-rail-preset-${p.toLowerCase()}`}>{p}</span>
        ))}
      </div>
      {!on ? <p className="fwr-models-note" data-testid="text-worker-rail-presets-later">{presets.later}</p> : null}
    </div>
  );
}

function useGroupRow(page, option, open, read) {
  const [reading, setReading] = useState({ loading: false, data: null, error: false, status: null });
  const load = useCallback(() => {
    if (!page || !(option || read) || !open) return undefined;
    let live = true;
    setReading((r) => ({ ...r, loading: true }));
    Promise.resolve()
      .then(() => (read ? read() : railPrefsApi.page(page, option)))
      .then((data) => { if (live) setReading({ loading: false, data, error: false, status: 200 }); },
        (e) => { if (live) setReading({ loading: false, data: null, error: true, status: e?.status ?? null }); });
    return () => { live = false; };
  }, [page, option, open, read]);
  useEffect(() => load(), [load]);
  return { ...reading, reload: load };
}

function RailGroup({ group, page, live, guardLine }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null);
  const [kept, setKept] = useState([]);
  const [refused, setRefused] = useState(null);
  const lead = group.read ? `group:${group.id}` : group.options[0] || null;
  const row = useGroupRow(page, group.read ? null : lead, open, group.read);
  const rail = lead && open && !row.data?.free
    ? railView({ reading: (row.loading || row.status == null) && !row.error && !row.data ? { loading: true } : row, page, option: lead, pick: picked, price: (m) => railModelPrice(m, row.data?.billing, true) })
    : null;
  const pick = useCallback((id) => {
    if (!page || !live) return;
    setPicked(id); setKept([]); setRefused(null);
    if (group.pick) {
      Promise.resolve().then(() => group.pick(id)).then(() => row.reload(), (e) => {
        setPicked(null);
        setRefused(typeof e?.message === 'string' && e.message ? e.message : 'The pick was not saved.');
      });
      return;
    }
    Promise.allSettled(group.options.map((o) => railPrefsApi.setPagePick(page, id, o)))
      .then((out) => {
        const refused = group.options.filter((_, i) => out[i].status === 'rejected');
        if (refused.includes(lead)) setPicked(null);
        setKept(refused.filter((o) => o !== lead));
        row.reload();
      });
  }, [page, live, group, lead, row.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const bodyId = `fwr-group-${group.id}`;

  if (group.safety) {
    return (
      <div className="fwr-rgroup" data-testid={`worker-rail-group-${group.id}`}>
        <div className="fwr-rgroup-head"><span className="fwr-rgroup-name">{group.label}</span><i className="fwr-role">Required</i></div>
        <p className="fwr-models-note">Always on. Not pickable. {guardLine}</p>
      </div>
    );
  }
  if (group.unavailable || !lead) {
    return (
      <div className="fwr-rgroup" data-off="true" data-testid={`worker-rail-group-${group.id}`}>
        <div className="fwr-rgroup-head" title={group.unavailable?.reason || undefined}>
          <span className="fwr-rgroup-name">{group.label}</span>
          <span className="fwr-rgroup-off" data-testid={`text-worker-rail-group-off-${group.id}`}>{group.unavailable?.label || 'Not set up yet'}</span>
        </div>
        {group.usedBy ? <p className="fwr-models-note">Used by: {group.usedBy}</p> : null}
      </div>
    );
  }
  return (
    <div className="fwr-rgroup" data-testid={`worker-rail-group-${group.id}`}>
      <button type="button" className="fwr-rgroup-head fwr-rgroup-toggle" aria-expanded={open} aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((o) => !o)} data-testid={`button-worker-rail-group-${group.id}`}>
        <span className="fwr-rgroup-name">{group.label}</span>
        <span className="fwr-rgroup-chev" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {group.usedBy ? <p className="fwr-models-note">Used by: {group.usedBy}</p> : null}
      {open ? (
        <div id={bodyId}>
          {rail?.state === 'loading' ? <p className="fwr-absent">Loading…</p> : null}
          {row.data?.free ? <p className="fwr-models-note" data-testid={`text-worker-rail-group-free-${group.id}`}>{row.data.free}</p> : null}
          {rail?.state === 'none' ? <p className="fwr-absent">{`Not recorded. ${rail.reason}`}</p> : null}
          {rail?.state === 'unreadable' ? (
            <Unreadable what={`The ${group.label} models`} claim="Which model runs here is unknown, not none." onRetry={row.reload} />
          ) : null}
          {rail?.state === 'ready' ? (
            <div className="fwr-cards" {...(rail.pickable ? { role: 'radiogroup', 'aria-label': `Model for ${group.label}` } : {})}>
              {rail.cards.map((card) => {
                const radio = rail.pickable;
                const Tag = radio && live ? 'button' : 'div';
                return (
                  <Tag key={card.id}
                    {...(Tag === 'button' ? { type: 'button', onClick: () => pick(card.id) } : {})}
                    {...(radio ? { role: 'radio', 'aria-checked': card.checked, ...(live ? {} : { 'aria-disabled': 'true' }) } : {})}
                    className="fwr-card" data-radio={radio ? 'true' : 'false'} data-selected={radio && card.checked ? 'true' : 'false'}
                    data-testid={`card-worker-rail-group-${group.id}-${card.id.split('/').pop()}`}>
                    {radio && <span className="fwr-dot" aria-hidden="true"><span /></span>}
                    <span className="fwr-card-text">
                      <span className="fwr-card-head"><b>{card.name}</b>{card.role && <i className="fwr-role" data-default={card.role === 'Default' ? 'true' : 'false'}>{card.role}</i>}</span>
                      {card.price && <span className="fwr-card-price">{card.price}</span>}
                    </span>
                  </Tag>
                );
              })}
            </div>
          ) : null}
          {refused ? <p className="fwr-models-note" role="status" data-testid={`text-worker-rail-group-refused-${group.id}`}>{refused}</p> : null}
          {kept.length ? <p className="fwr-models-note" role="status" data-testid={`text-worker-rail-group-kept-${group.id}`}>{`Kept its own model: ${kept.join(', ')}.`}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function RailGroups({ groups, page, live, guardLine }) {
  return (
    <div className="fwr-rgroups" data-testid="worker-rail-groups">
      <RailPresets presets={groups.presets} />
      <span className="fwr-eyebrow">Suggested for this page</span>
      {(groups.items || []).map((g) => <RailGroup key={g.id} group={g} page={groups.page || page} live={live} guardLine={guardLine} />)}
    </div>
  );
}

function UsageRow({ row }) {
  const [state, setState] = useState(null);
  const load = useCallback(() => {
    let live = true;
    setState(null);
    Promise.resolve().then(() => row.read()).then((a) => { if (live) setState(a || { available: false }); },
      () => { if (live) setState({ available: false, unreadable: true }); });
    return () => { live = false; };
  }, [row]);
  useEffect(() => load(), [load]);
  if (state == null) return row.hideUnavailable ? null : <div className="fwr-usage-line"><span>{row.label}</span><b>…</b></div>;
  if (state.available === true && state.value != null) {
    return <div className="fwr-usage-line" data-testid={`text-worker-rail-usage-${row.id}`}><span>{row.label}</span><b>{String(state.value)}</b></div>;
  }
  if (row.hideUnavailable) return null;
  return (
    <div className="fwr-usage-line" data-testid={`text-worker-rail-usage-${row.id}`}>
      <span>{row.label}</span><b>Could not be read</b>
    </div>
  );
}

export function RailUsageExtra({ rows }) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return <>{rows.map((r) => <UsageRow key={r.id} row={r} />)}</>;
}
