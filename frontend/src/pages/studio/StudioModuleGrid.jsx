/**
 * D1419 (#3698) — the placed modules in order and size: 6 columns on a
 * desktop, 2 at tablet width, 1 on a phone (`studioModules.css`).
 *
 * In Customise (SM5) every move has three ways in, and each only changes the
 * local draft:
 *   - drag a module by its handle; a violet "Drop here" slot shows where it lands;
 *   - focus the handle, Space to lift, the arrow keys to move, Space to drop,
 *     Escape to put it back;
 *   - on a touch screen, press and hold a module to lift it, then tap where it
 *     goes (SM13b), or use Move up and Move down in its ⋯ menu.
 */
import { useRef, useState } from 'react';
import StudioModuleTile from './StudioModuleTile';
import { TILE } from './studioLayoutModel';

const HOLD_MS = 500;

export default function StudioModuleGrid({ items, titleOf, hrefOf, tiles, editing = false, edit, withheld = false, extra = [] }) {
  const [dragKey, setDragKey] = useState(null);
  const [over, setOver] = useState(null);
  const [lifted, setLifted] = useState(null);
  const [origin, setOrigin] = useState(null);
  const [said, setSaid] = useState('');
  const hold = useRef(null);
  const count = items.length;
  const indexOf = (key) => items.findIndex((e) => e.key === key);

  const say = (key, at) => setSaid(`${titleOf(key)}, position ${at + 1} of ${count}.`);
  const lift = (key) => { setLifted(key); setOrigin(indexOf(key)); say(key, indexOf(key)); };
  const drop = () => { if (lifted) setSaid(`${titleOf(lifted)} dropped.`); setLifted(null); setOrigin(null); };

  const onHandleKey = (key) => (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (lifted === key) drop(); else lift(key);
      return;
    }
    if (lifted !== key) return;
    const at = indexOf(key);
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); if (at > 0) { edit.move(at, at - 1); say(key, at - 1); } }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); if (at < count - 1) { edit.move(at, at + 1); say(key, at + 1); } }
    if (e.key === 'Escape') { e.preventDefault(); if (origin !== null && origin !== at) edit.move(at, origin); drop(); }
  };

  const cancelHold = () => { clearTimeout(hold.current); hold.current = null; };
  const onPointerDown = (key) => (e) => {
    if (e.pointerType !== 'touch') return;
    cancelHold();
    hold.current = setTimeout(() => lift(key), HOLD_MS);
  };
  // A tap on another module while one is held moves the held one there.
  const onTileClick = (key) => () => {
    if (!lifted || lifted === key) return;
    edit.move(indexOf(lifted), indexOf(key));
    drop();
  };

  const draggedSize = dragKey ? items.find((e) => e.key === dragKey)?.size : null;
  const from = dragKey ? indexOf(dragKey) : -1;
  const slotAt = dragKey && over !== null && over !== from ? over : null;

  return (
    <>
      <div className="sm-grid" data-testid="studio-module-grid" data-editing={editing ? 'true' : undefined}>
        {items.map((entry, i) => {
          const mod = { key: entry.key, title: titleOf(entry.key), href: hrefOf(entry.key) };
          const spec = withheld ? { state: TILE.WITHHELD } : (tiles[entry.key] || { state: TILE.LOADING });
          const tileProps = editing ? {
            onDragOver: (e) => { if (!dragKey) return; e.preventDefault(); setOver(i); },
            onDrop: (e) => { e.preventDefault(); if (from >= 0 && over !== null) edit.move(from, over); setDragKey(null); setOver(null); },
            onPointerDown: onPointerDown(entry.key),
            onPointerUp: cancelHold,
            onPointerCancel: cancelHold,
            onPointerLeave: cancelHold,
            onClick: onTileClick(entry.key),
          } : {};
          const tile = (
            <StudioModuleTile
              key={entry.key}
              mod={mod}
              size={entry.size}
              spec={spec}
              tileProps={tileProps}
              edit={editing ? {
                size: entry.size,
                first: i === 0,
                last: i === count - 1,
                lifted: lifted === entry.key || dragKey === entry.key,
                onSize: (s) => edit.resize(entry.key, s),
                onRemove: () => { if (lifted === entry.key) drop(); edit.remove(entry.key); },
                onUp: () => edit.moveUp(entry.key),
                onDown: () => edit.moveDown(entry.key),
                handle: {
                  draggable: true,
                  onDragStart: (e) => { setDragKey(entry.key); setOver(i); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', entry.key); } catch { /* a browser without dataTransfer */ } },
                  onDragEnd: () => { setDragKey(null); setOver(null); },
                  onKeyDown: onHandleKey(entry.key),
                },
              } : null}
            />
          );
          if (slotAt !== i) return tile;
          const slot = <div key={`slot-${entry.key}`} className="sm-slot" data-size={draggedSize || entry.size} data-testid="studio-drop-slot" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); edit.move(from, i); setDragKey(null); setOver(null); }}>Drop here</div>;
          // Moving down, the module lands after the one it is over; moving up, before it.
          return from < i ? [tile, slot] : [slot, tile];
        })}
        {extra.map((x) => (
          <StudioModuleTile key={x.key} mod={{ key: x.key, title: x.title, href: null }} size={x.size} spec={withheld ? { state: TILE.WITHHELD } : x.spec} fixed={editing} />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">{said}</p>
    </>
  );
}
