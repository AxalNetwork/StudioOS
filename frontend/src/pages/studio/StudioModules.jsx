/**
 * D1419 (#3698) — the module half of every Studio home, below its fixed
 * blocks (Eadwyn's chat, the founder strip, the profile card): the notices,
 * "Your modules", the grid or SM8d's empty box, and in Customise the edit
 * bar, the module map, the locked sheet and the reset confirm.
 *
 * The home owns the reads and hands in one spec per module (`tiles/*`); this
 * file owns the layout. `extra` are tiles drawn after the placed ones that
 * the Worker's catalogue does not offer yet (the founder's two no-store
 * blocks): never placed, never counted, never edited.
 */
import { Plus } from 'lucide-react';
import ModuleMapLightbox from './ModuleMapLightbox';
import StudioModuleGrid from './StudioModuleGrid';
import { ModuleLockedSheet, ResetDialog, SavedLine, StudioEditBar, StudioLayoutNotice, StudioNoProfile } from './StudioParts';
import { placedLine } from './studioLayoutModel';
import { fallbackTitle } from './studioFallback';
import './studioModules.css';

export const EDIT_HINT = 'Drag a module by its handle, choose a size, or remove it. Move up and Move down are in each module’s ⋯ menu.';
export const EDIT_HINT_PHONE = 'Press and hold a module to move it, or use Move up and Move down in its ⋯ menu. On the phone every module is full width.';
export const EMPTY_LINE = 'Your Studio has no modules. Add modules from the Module map.';

export default function StudioModules({ studio, tiles, extra = [], withheld = false }) {
  const byKey = new Map((studio.catalogue || []).map((m) => [m.key, m]));
  const titleOf = (key) => byKey.get(key)?.title || fallbackTitle(key);
  const hrefOf = (key) => byKey.get(key)?.href || null;
  const openMap = () => { if (!studio.editing) studio.customise(); studio.setMapOpen(true); };

  if (studio.noProfile) return <section className="sm-root" data-testid="studio-modules"><StudioNoProfile /></section>;

  const items = studio.shown;
  const head = studio.editing
    ? ['Customise your Studio', null]
    : studio.readOnly ? ['Default layout', `${items.length} modules`] : ['Your modules', placedLine(items)];

  return (
    <section className="sm-root" data-testid="studio-modules" data-editing={studio.editing ? 'true' : undefined}>
      <StudioLayoutNotice studio={studio} titleOf={titleOf} />
      <div className="sm-head">
        <h2>{head[0]}</h2>
        {head[1] && <span className="sm-count" data-testid="studio-placed">{head[1]}</span>}
        {studio.editing && (
          <span className="sm-hint">
            <span className="hidden sm:inline">{EDIT_HINT}</span>
            <span className="sm:hidden">{EDIT_HINT_PHONE}</span>
          </span>
        )}
        <SavedLine studio={studio} />
      </div>
      {studio.layoutRead === 'loading' ? (
        <div className="sm-grid" aria-busy="true" data-testid="studio-grid-loading">
          {[0, 1].map((i) => <div key={i} className="sm-tile" data-size="1/2"><div className="sm-skel"><i style={{ width: '60%' }} /><i style={{ width: '85%' }} /></div></div>)}
        </div>
      ) : (
        <>
          {items.length === 0 && (
            <div className="sm-empty" data-testid="studio-empty">
              <span>{EMPTY_LINE}</span>
              {studio.canCustomise || studio.editing
                ? <button type="button" className="sm-btn sm-btn-s" onClick={openMap}><Plus size={14} aria-hidden="true" /> Add modules</button>
                : null}
            </div>
          )}
          {(items.length > 0 || extra.length > 0) && (
            <StudioModuleGrid
              items={items}
              titleOf={titleOf}
              hrefOf={hrefOf}
              tiles={tiles}
              editing={studio.editing}
              edit={studio.edit}
              withheld={withheld}
              extra={extra}
            />
          )}
        </>
      )}
      {studio.editing && <StudioEditBar studio={studio} />}
      {studio.editing && <ModuleMapLightbox studio={studio} />}
      <ModuleLockedSheet studio={studio} />
      <ResetDialog studio={studio} />
    </section>
  );
}
