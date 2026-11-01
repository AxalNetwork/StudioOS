/**
 * D1419 (#3698) — one module's frame (SM7): its title, an optional note, its
 * body in one of five states, and an Open link. Withheld is the
 * administrator's preview (SM11). In edit mode (SM5) it carries the handle,
 * the size radiogroup, a ⋯ menu with Move up and Move down, and ×.
 *
 * - "Not recorded" is said with its reason, muted, never a 0 and never red.
 * - A failed read is "<Title> could not be read · Try again", alone: the
 *   only red is the small icon.
 * - The body is the block the home already drew, handed in by the home's
 *   `tiles/*` builder: tiles share their page's reads.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, GripVertical, MoreHorizontal, X } from 'lucide-react';
import { SIZES, SIZE_NAME, SIZE_SHORT, TILE } from './studioLayoutModel';

export function TileBody({ title, spec }) {
  const state = spec?.state || TILE.LOADING;
  if (state === TILE.LOADING) {
    return (
      <div className="sm-skel" aria-busy="true" data-testid="studio-tile-loading">
        <i style={{ width: '72%' }} /><i style={{ width: '90%' }} /><i style={{ width: '54%' }} />
        <span className="sm-muted">Reading…</span>
      </div>
    );
  }
  if (state === TILE.UNREADABLE) {
    return (
      <p className="sm-err" role="alert" data-testid="studio-tile-unreadable">
        <CircleAlert size={14} aria-hidden="true" />
        <span>{title} could not be read</span>
        {spec.onRetry && <>{' · '}<button type="button" className="sm-btn sm-btn-s sm-btn-sm" onClick={spec.onRetry}>Try again</button></>}
      </p>
    );
  }
  if (state === TILE.NOT_RECORDED) {
    return (
      <div className="sm-nr" data-testid="studio-tile-not-recorded">
        <b>Not recorded</b>
        {spec.reason && <span className="sm-muted">{spec.reason}</span>}
      </div>
    );
  }
  if (state === TILE.EMPTY) return <p className="sm-muted" data-testid="studio-tile-empty">{spec.empty}</p>;
  if (state === TILE.WITHHELD) return <p className="sm-muted" data-testid="studio-tile-withheld">Withheld in administrator preview</p>;
  return <div className="min-w-0">{spec.body}</div>;
}

function SizeControl({ title, size, onSize }) {
  return (
    <div className="sm-size" role="radiogroup" aria-label={`Size of ${title}`}>
      {SIZES.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={size === s ? 'true' : 'false'} aria-label={SIZE_NAME[s]} onClick={() => onSize(s)}>{SIZE_SHORT[s]}</button>
      ))}
    </div>
  );
}

function MoreMenu({ title, onUp, onDown, first, last }) {
  const [open, setOpen] = useState(false);
  const pick = (fn) => () => { setOpen(false); fn(); };
  return (
    <div className="sm-menu-wrap">
      <button type="button" className="sm-icon" aria-label={`More for ${title}`} aria-haspopup="menu" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="sm-menu" role="menu" aria-label="Module actions" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
          <button type="button" role="menuitem" disabled={first} onClick={pick(onUp)}>Move up</button>
          <button type="button" role="menuitem" disabled={last} onClick={pick(onDown)}>Move down</button>
        </div>
      )}
    </div>
  );
}

/**
 * `edit` is null outside Customise. Inside it: `{ size, first, last, lifted,
 * onSize, onRemove, onUp, onDown, handle }`, where `handle` holds the drag
 * handle's own props (pointer, keyboard and touch), set by the grid.
 */
export default function StudioModuleTile({ mod, size, spec, edit = null, fixed = false, tileProps = {} }) {
  const title = mod.title;
  const href = mod.href || spec?.href || null;
  const state = spec?.state || TILE.LOADING;
  const linked = href && state !== TILE.LOADING && state !== TILE.WITHHELD;
  return (
    <article
      className="sm-tile"
      aria-label={title}
      data-size={size}
      data-state={state}
      data-editing={edit ? 'true' : undefined}
      data-lifted={edit?.lifted ? 'true' : undefined}
      data-fixed={fixed ? 'true' : undefined}
      data-testid={`studio-tile-${mod.key}`}
      {...tileProps}
    >
      <div className="sm-tile-head">
        {edit && (
          <span role="button" tabIndex={0} className="sm-icon sm-handle" aria-label={`Move ${title}. Press Space to lift, then the arrow keys.`} aria-pressed={edit.lifted ? 'true' : 'false'} title="Drag to move" {...edit.handle}>
            <GripVertical size={16} aria-hidden="true" />
          </span>
        )}
        <h3>{title}</h3>
        {!edit && spec?.note && state === TILE.READY && <span className="sm-note">{spec.note}</span>}
        {edit && <SizeControl title={title} size={size} onSize={edit.onSize} />}
        {edit && <MoreMenu title={title} onUp={edit.onUp} onDown={edit.onDown} first={edit.first} last={edit.last} />}
        {edit && (
          <button type="button" className="sm-icon" aria-label={`Remove ${title}`} onClick={edit.onRemove}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <TileBody title={title} spec={spec} />
      {linked && (
        <div className="sm-foot">
          <Link to={href} className="sm-link" data-testid={`studio-tile-open-${mod.key}`}>{spec?.openLabel || 'Open'} ›</Link>
        </div>
      )}
    </article>
  );
}
