import { useEffect, useState } from 'react';
import { posthogApi } from '../../lib/api/posthog';
import FromPosthog from './FromPosthog';
import { asOfLine } from './fromPosthogModel';

/**
 * D1606 (#3731, #2409 part 4) — PostHog in Build, on the shared "From
 * PostHog" part (D1609). Built from #2409's PH5 and PH8 brief: no canvas was
 * drawn.
 *
 *   PrototypePosthog — Prototype / MVP: tracked metrics (activation by week),
 *     each linked must-have with its flag chip "Flag 25% · active", "Link
 *     flag new-onboarding to a must-have?" with the must-have chosen by the
 *     founder, and "Mark Onboarding v2 Done?" once its flag has been at 100%
 *     for 14 days. Both wait for Accept.
 *   RoadmapPosthog — Product roadmap: tracked metrics an item's KPI can name;
 *     the item's row shows its value and source (the Worker writes it).
 *   OperatingPosthog — Operating systems: one Tools line (decision D, a): the
 *     project, region and last sync, and each sync's counts.
 */
export function flagChip(f) {
  if (!f) return null;
  const pct = f.rollout == null ? 'rollout not recorded' : `${Math.round(f.rollout)}%`;
  const state = f.active == null ? 'state not recorded' : f.active ? 'active' : 'off';
  return `Flag ${pct} · ${state}`;
}

export const SECTION_WORDS = Object.freeze({ validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow' });

/** "Build · 4 figures, 1 proposal · 2026-10-30", with "partly synced" when it stopped early. */
export function syncLine(s) {
  const facts = `${s.facts} ${s.facts === 1 ? 'figure' : 'figures'}`;
  const props = `${s.proposals} ${s.proposals === 1 ? 'proposal' : 'proposals'}`;
  return `${SECTION_WORDS[s.section] || s.section} · ${facts}, ${props}${s.partial ? ', partly synced' : ''}${s.at ? ` · ${s.at}` : ''}`;
}

export function PrototypePosthog({ projectId, api = posthogApi, phone = false }) {
  return (
    <FromPosthog section="build" projectId={projectId} module="prototype_mvp" api={api} phone={phone}
      onSync={() => api.sync('build', projectId)}
      renderProposal={(p, ctx) => (p.kind === 'flag_link' ? <FlagLink p={p} ctx={ctx} /> : p.kind === 'flag_shipped' ? <FlagShipped p={p} ctx={ctx} /> : null)}>
      {({ facts }) => <LinkedFlags facts={facts} />}
    </FromPosthog>
  );
}

export function RoadmapPosthog({ projectId, api = posthogApi, phone = false }) {
  return <FromPosthog section="build" projectId={projectId} module="product_roadmap" api={api} phone={phone} onSync={() => api.sync('build', projectId)} />;
}

function LinkedFlags({ facts }) {
  const linked = facts.filter((f) => f.kind === 'flag_state' && f.data?.feature_id != null);
  if (!linked.length) return null;
  const latest = new Map();
  for (const f of [...linked].sort((a, b) => String(a.period).localeCompare(String(b.period)))) latest.set(f.fact_key, f);
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="posthog-linked-flags">
      {[...latest.values()].map((f) => (
        <li key={f.fact_key} className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]" data-testid="posthog-linked-flag">
          <span className="font-mono text-axal-ink dark:text-gray-100">{f.data?.key || f.label}</span>
          <span className="rounded-full border border-axal-hairline px-2 py-0.5 font-mono text-[11px] dark:border-gray-700" data-testid="posthog-flag-chip">{flagChip({ rollout: f.value, active: f.data?.active })}</span>
          <span className="text-[11px] text-axal-muted dark:text-gray-400">{asOfLine(f.as_of)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The must-have is the founder's; Accept is off until one is chosen. */
function FlagLink({ p, ctx }) {
  const [feature, setFeature] = useState('');
  const list = Array.isArray(ctx.data?.must_haves) ? ctx.data.must_haves : [];
  return (
    <div className="flex flex-col gap-2" data-testid="posthog-flag-link">
      <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">Link flag <span className="font-mono">{String(p.payload?.key || p.payload?.title || 'flag')}</span> to a must-have?</p>
      <span className="font-mono text-[11px] text-axal-muted dark:text-gray-400">{flagChip({ rollout: p.payload?.rollout, active: p.payload?.active })}</span>
      {ctx.mine && (
        <>
          <select value={feature} onChange={(e) => setFeature(e.target.value)} aria-label="Must-have" data-testid="posthog-feature"
            className="rounded-[7px] border border-axal-hairline bg-white px-2 py-1.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]">
            <option value="">{list.length ? 'Choose a must-have' : 'No must-have yet'}</option>
            {list.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          <div className="flex flex-wrap gap-2 max-sm:flex-col">
            <button type="button" className={PRIMARY} disabled={ctx.busy || !feature} onClick={() => ctx.accept({ feature_id: Number(feature) })} data-testid="posthog-accept">Link</button>
            <button type="button" className={GHOST} disabled={ctx.busy} onClick={ctx.dismiss} data-testid="posthog-dismiss">Dismiss</button>
          </div>
        </>
      )}
    </div>
  );
}

function FlagShipped({ p, ctx }) {
  return (
    <div className="flex flex-col gap-2" data-testid="posthog-flag-shipped">
      <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">Mark “{String(p.payload?.title || 'this must-have')}” Done?</p>
      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">Its flag <span className="font-mono">{String(p.payload?.key || '')}</span> has been active at 100% since {String(p.payload?.since || 'the last syncs')}.</span>
      {ctx.mine && (
        <div className="flex flex-wrap gap-2 max-sm:flex-col">
          <button type="button" className={PRIMARY} disabled={ctx.busy} onClick={() => ctx.accept({})} data-testid="posthog-accept">Mark Done</button>
          <button type="button" className={GHOST} disabled={ctx.busy} onClick={ctx.dismiss} data-testid="posthog-dismiss">Not yet</button>
        </div>
      )}
    </div>
  );
}

/** Decision D (a): one Tools line, never a core system. */
export function OperatingPosthog({ projectId, api = posthogApi }) {
  const [read, setRead] = useState({ status: 'loading', tools: null });
  useEffect(() => {
    let live = true;
    api.fromPosthog('build', projectId, 'operating_systems').then(
      (d) => { if (live) setRead({ status: d?.link?.linked ? 'ready' : 'none', tools: d?.tools || null }); },
      () => { if (live) setRead({ status: 'unreadable', tools: null }); },
    );
    return () => { live = false; };
  }, [api, projectId]);
  if (read.status === 'loading' || read.status === 'none') return null;
  return (
    <section id="from-posthog" className="flex flex-col gap-1.5 rounded-xl border border-axal-hairline bg-white px-[18px] py-3 dark:border-gray-800 dark:bg-gray-900" data-testid="posthog-tools">
      <h2 className="m-0 text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Product analytics · PostHog</h2>
      {read.status === 'unreadable' || !read.tools
        ? <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert">Unreadable: PostHog's line could not be read. The rest of this page is current.</p>
        : (
          <>
            <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-200" data-testid="posthog-tools-line">
              {read.tools.project || 'PostHog project'}{read.tools.region ? ` · ${read.tools.region} Cloud` : ''} · {read.tools.last_synced ? `synced ${read.tools.last_synced}` : 'not synced yet'}
            </p>
            {read.tools.reason && <p className="m-0 text-[12px] text-amber-800 dark:text-amber-200">{read.tools.reason}</p>}
            {read.tools.syncs.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0" data-testid="posthog-sync-lines">
                {read.tools.syncs.map((s, i) => <li key={`${s.at}-${i}`} className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{syncLine(s)}</li>)}
              </ul>
            )}
          </>
        )}
    </section>
  );
}

const PRIMARY = 'inline-flex items-center justify-center rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:hover:bg-violet-500 max-sm:min-h-[44px]';
const GHOST = 'inline-flex items-center justify-center rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:border-axal-violet/40 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-violet-400/40 max-sm:min-h-[44px]';
