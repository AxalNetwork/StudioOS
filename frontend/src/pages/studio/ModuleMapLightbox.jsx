/**
 * D1419 (#3698) — the module map (SM6): this Studio's catalogue
 * (`GET /api/studio/modules`, D1418) in its groups, with search,
 * "Recommended for you" (unplaced defaults, `in_default`), and Add, ✓ Added
 * or a lock with "Included in <plan>".
 *
 * Add appends to the draft at the module's default size; nothing is saved
 * until Done on the page. At 12 every Add is off and the cap line says why
 * (SM6c). A locked entry opens the locked sheet (SM12b).
 */
import { useState } from 'react';
import { Check, Info, Lock } from 'lucide-react';
import { Lightbox } from '../../ui';
import { CAP_LINE, STUDIO_MAX, canAdd, grouped, includedIn, recommended, search } from './studioLayoutModel';

const PROFILE_NAME = { founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating partner' };

function Entry({ mod, placed, full, onAdd, onLocked }) {
  const added = placed.has(mod.key);
  return (
    <div className="sm-entry" data-locked={mod.locked_by_plan ? 'true' : undefined} data-testid={`studio-map-${mod.key}`}>
      <span className="sm-preview" aria-hidden="true" />
      <b>{mod.title}</b>
      {mod.purpose && <p>{mod.purpose}</p>}
      <div>
        {mod.locked_by_plan ? (
          <button type="button" className="sm-locked sm-btn-t" onClick={() => onLocked(mod.key)}>
            <Lock size={12} aria-hidden="true" /> {includedIn(mod.plan)}
          </button>
        ) : added ? (
          <span className="sm-added" aria-disabled="true"><Check size={13} aria-hidden="true" /> Added</span>
        ) : (
          <button
            type="button"
            className="sm-add"
            aria-label={`Add ${mod.title}`}
            aria-disabled={full ? 'true' : undefined}
            onClick={() => { if (!full) onAdd(mod); }}
          >+ Add</button>
        )}
      </div>
    </div>
  );
}

function Group({ label, modules, tone, placed, full, onAdd, onLocked }) {
  return (
    <section className="sm-group" data-tone={tone} aria-label={label}>
      <h3>{label}<span>{modules.length}</span></h3>
      <div className="sm-cards">
        {modules.map((m) => <Entry key={m.key} mod={m} placed={placed} full={full} onAdd={onAdd} onLocked={onLocked} />)}
      </div>
    </section>
  );
}

export function ModuleMapBody({ profile, catalogue, groups, draft, onAdd, onLocked, query = '', onQuery = () => {} }) {
  const placed = new Set(draft.map((e) => e.key));
  const full = !canAdd(draft);
  const found = search(catalogue, query);
  const rec = query ? [] : recommended(catalogue, draft);
  const sections = grouped(groups, found);
  return (
    <div className="sm-root sm-map" data-testid="studio-module-map">
      <p className="sm-muted">{PROFILE_NAME[profile] || 'Studio'} modules · {draft.length} of {STUDIO_MAX} placed</p>
      <input type="search" role="searchbox" aria-label="Search modules" placeholder="Search modules" className="sm-search" value={query} onChange={(e) => onQuery(e.target.value)} />
      {full && <p className="sm-notice" role="status" data-testid="studio-map-cap"><Info size={14} aria-hidden="true" />{CAP_LINE}</p>}
      {!full && rec.length > 0 && <Group label="Recommended for you" tone="lav" modules={rec} placed={placed} full={full} onAdd={onAdd} onLocked={onLocked} />}
      {sections.map((g) => <Group key={g.key} label={g.label} modules={g.modules} placed={placed} full={full} onAdd={onAdd} onLocked={onLocked} />)}
      {query && !sections.length && (
        <p className="sm-muted" data-testid="studio-map-none">
          No module matches “{query}”.{' '}
          <button type="button" className="sm-link" onClick={() => onQuery('')}>Clear the search</button>
        </p>
      )}
    </div>
  );
}

export default function ModuleMapLightbox({ studio }) {
  const [query, setQuery] = useState('');
  if (!studio.mapOpen) return null;
  const close = () => studio.setMapOpen(false);
  return (
    <Lightbox
      label="Module map"
      title="Module map"
      width={960}
      onClose={close}
      testId="studio-module-map-lightbox"
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <span className="text-[12.5px] text-axal-muted dark:text-gray-400">Added modules go to the end of your Studio. Drag them where you want them.</span>
          <button type="button" className="sm-btn sm-btn-p" onClick={close}>Done</button>
        </div>
      )}
    >
      <ModuleMapBody
        profile={studio.profile}
        catalogue={studio.catalogue || []}
        groups={studio.groups}
        draft={studio.shown}
        onAdd={studio.edit.add}
        onLocked={studio.setLockedKey}
        query={query}
        onQuery={setQuery}
      />
    </Lightbox>
  );
}
