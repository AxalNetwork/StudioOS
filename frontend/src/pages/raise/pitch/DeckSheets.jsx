import React from 'react';
import Sheet from '../../../ui/Sheet.jsx';
import { BrandingCard } from './StudioActions';
import CheckPanel from './CheckPanel';
import VersionCompare from './VersionCompare';
import { Versions, useDeckChecks } from './DeckVersions';
import { comparePair } from './compareModel';
import { APPLY } from './deckV2Model';
import { AUDIENCE_LABELS, KIT_FAILED, NOT_RECORDED, NO_KIT, THEME_LABELS } from './editorModel';
import { SLIDE_SIZES, aspectOf, withAspect } from './gridModel';
import { movedNotice } from './deckReflow';

/**
 * D1604 (#3716, pd13) — the sheets the editor's ⋯ opens, each one v1 surface
 * kept and moved behind ⋯ (plan §0, "v1 features with no v2 board are kept"):
 *
 *   ThemeSheet       Theme (from your brand kit, Neutral light, Neutral dark),
 *                    Apply to all cards, and the audience (D898's Design tab)
 *   SizeSheet        This deck › Slide size: 16:9 (1920 × 1080) or 4:3
 *                    (1440 × 1080), the theme's `aspect` (D1499). The 12 × 6
 *                    grid and its margins stay, so every block keeps its
 *                    cells and none moves to the notes.
 *   StructureSheet   This card › Structure: the layouts on main (`LAYOUTS`
 *                    via `GET /api/decks/model`), each behind the dialog that
 *                    says what leaves the card. The 17 structures are #3749.
 *   BackgroundSheet  This card › Background: a colour, or an image through
 *                    the image lightbox (D903)
 *   BrandKitSheet    the kit the card draws on, and the studio's Branding
 *                    card (plan, footer, watermark)
 *   VersionsSheet    PD15: every version, Compare, and Restore behind its
 *                    dialog (`POST /api/decks/:id/restore`)
 *   SourcesSheet     D896's Sources panel, with the slide's own evidence
 *   CheckSheet       D900's Check panel ("Check claims · Free checks")
 *
 * A theme or a layout runs no model: it is applied at once, one edit like any
 * other, and nothing is saved until a version is.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const HELD = 'Nothing is saved until you save a version.';

function Frame({ title, testId, onClose, children, width = 520 }) {
  return (
    <Sheet label={title} title={title} eyebrow="More deck actions" width={width} onClose={onClose} testId={testId}>
      <div className="flex flex-col gap-3">{children}</div>
    </Sheet>
  );
}

export function ThemeSheet({ model, theme, audience, kit, readOnly, onTheme, onAudience, onApplyAll, onClose }) {
  const kitData = kit.status === 'ok' ? kit.data?.kit : null;
  return (
    <Frame title="Theme" testId="pitch-sheet-theme" onClose={onClose}>
      {kit.status === 'error' ? <span className={MUTED} role="status">{KIT_FAILED}</span> : null}
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Theme" data-testid="pitch-editor-design">
        {model.themes.map((k) => (
          <label key={k} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[9px] border px-3 text-[12.5px] ${(theme?.kind || 'brand') === k ? 'border-axal-violet dark:border-violet-500' : 'border-axal-hairline dark:border-gray-700'} ${INK}`}>
            <input type="radio" name="theme" checked={(theme?.kind || 'brand') === k} disabled={readOnly}
              onChange={() => onTheme(withAspect(k === 'brand' && !theme?.background ? null : { kind: k, background: theme?.background ?? null }, theme?.aspect))} data-testid={`pitch-theme-${k}`} />
            <span className="flex flex-col">
              <span className="font-bold">{THEME_LABELS[k]}{k === 'brand' && kitData?.name ? ` · ${kitData.name}` : ''}</span>
              {k === 'brand' && kit.status === 'ok' && !kitData ? <span className={MUTED}>{NO_KIT}</span> : null}
            </span>
          </label>
        ))}
      </div>
      {!readOnly ? <button type="button" className={GHOST} onClick={onApplyAll} data-testid="pitch-editor-apply-all">{APPLY} to all cards</button> : null}
      <span className={EYE}>Audience</span>
      <select className={FIELD} value={audience || ''} disabled={readOnly} onChange={(e) => onAudience(e.target.value || null)} data-testid="pitch-editor-audience-select">
        <option value="">{NOT_RECORDED}</option>
        {model.audiences.map((a) => <option key={a} value={a}>{AUDIENCE_LABELS[a] || a}</option>)}
      </select>
      <span className={MUTED}>{HELD}</span>
    </Frame>
  );
}

/** The two slide sizes, in the words the sheet shows. */
export const SIZE_LABELS = Object.freeze({ '16:9': 'Widescreen 16:9', '4:3': 'Standard 4:3' });

/**
 * D1554 (#3801): choosing a size runs the reflow on the draft (`onSize`); what
 * no longer fits moves to the speaker notes, and pd3c's amber notice says how
 * many blocks moved, with one Undo back to the cards and size before.
 */
export function SizeSheet({ theme, readOnly, onSize, moved, onUndo, onClose }) {
  const now = aspectOf(theme?.aspect);
  return (
    <Frame title="Slide size" testId="pitch-sheet-size" onClose={onClose}>
      <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Slide size">
        {Object.keys(SLIDE_SIZES).map((k) => (
          <label key={k} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[9px] border px-3 text-[12.5px] ${now === k ? 'border-axal-violet dark:border-violet-500' : 'border-axal-hairline dark:border-gray-700'} ${INK}`}>
            <input type="radio" name="slide-size" checked={now === k} disabled={readOnly}
              onChange={() => onSize(k)} data-testid={`pitch-size-${k.replace(':', 'x')}`} />
            <span className="flex flex-col">
              <span className="font-bold">{SIZE_LABELS[k]}</span>
              <span className={MUTED}>{SLIDE_SIZES[k].width} × {SLIDE_SIZES[k].height}</span>
            </span>
          </label>
        ))}
      </div>
      {moved ? (
        <div role="status" className="flex items-center gap-2 rounded-[9px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" data-testid="pitch-size-moved">
          <span className="flex-1">{movedNotice(moved)}</span>
          <button type="button" className="min-h-[44px] font-bold underline" onClick={onUndo} data-testid="pitch-size-undo">Undo</button>
        </div>
      ) : null}
      <span className={MUTED}>Every card keeps its 12 × 6 grid and its margins, so each block keeps its cells; only the columns narrow. Words that no longer fit move to the card&apos;s speaker notes.</span>
      <span className={MUTED}>{HELD}</span>
    </Frame>
  );
}

export function StructureSheet({ model, card, index, readOnly, onLayout, onClose }) {
  return (
    <Frame title={`Structure · card ${index + 1}`} testId="pitch-sheet-structure" onClose={onClose}>
      <span className={MUTED}>The layouts on The Grid. The card&apos;s words move with them, kind by kind; a dialog names anything that has no place.</span>
      <div className="grid grid-cols-3 gap-1.5">
        {model.layouts.map((l) => (
          <button key={l.id} type="button" disabled={readOnly || !card}
            className={`flex aspect-[16/10] items-center justify-center rounded-[7px] border p-1 text-center text-[11px] font-semibold leading-tight ${card?.layout === l.id ? 'border-axal-violet bg-axal-lavender text-axal-violet dark:border-violet-500 dark:bg-violet-950/40 dark:text-violet-300' : `border-axal-hairline dark:border-gray-700 ${INK}`}`}
            onClick={() => onLayout(l)} data-testid={`pitch-editor-layout-${l.id}`}>{l.label}</button>
        ))}
      </div>
    </Frame>
  );
}

export function BackgroundSheet({ card, index, readOnly, onBackground, onImage, onClose }) {
  return (
    <Frame title={`Background · card ${index + 1}`} testId="pitch-sheet-background" onClose={onClose}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label="Card background colour" disabled={readOnly || !card}
          value={card?.background?.color || '#ffffff'} onChange={(e) => onBackground({ color: e.target.value, image_url: null })} />
        <span className={MUTED}>{card?.background?.color || card?.background?.image_url ? 'Its own background' : 'None: the theme shows'}</span>
        {card?.background && !readOnly ? <button type="button" className="text-[12px] font-bold text-axal-violet underline dark:text-violet-300" onClick={() => onBackground(null)}>Clear</button> : null}
      </div>
      {!readOnly ? <button type="button" className={GHOST} onClick={onImage} data-testid="pitch-sheet-background-image">Choose an image…</button> : null}
      <span className={MUTED}>{HELD}</span>
    </Frame>
  );
}

export function BrandKitSheet({ projectId, kit, readOnly, onClose }) {
  const kitData = kit.status === 'ok' ? kit.data?.kit : null;
  return (
    <Frame title="Brand kit" testId="pitch-sheet-brand" onClose={onClose}>
      {kit.status === 'error' ? <span className={MUTED} role="status">{KIT_FAILED} <button type="button" className="font-bold underline" onClick={kit.retry}>Try again</button></span> : null}
      {kit.status === 'ok' && !kitData ? <span className={MUTED}>{NO_KIT}</span> : null}
      {kitData ? (
        <span className={`text-[12.5px] ${INK}`} data-testid="pitch-sheet-brand-kit">
          <b>{kitData.name || 'Your brand kit'}</b>
          {' · '}{[kitData.palette?.ink, kitData.palette?.accent, kitData.palette?.bg].filter(Boolean).join(' · ') || 'No palette recorded'}
          {kitData.fonts ? ` · ${kitData.fonts}` : ''}
          {kitData.voice?.length ? ` · ${kitData.voice.join(', ')}` : ''}
        </span>
      ) : null}
      {projectId != null ? <BrandingCard projectId={projectId} readOnly={readOnly} /> : null}
    </Frame>
  );
}

export function VersionsSheet({ projectId, versions, readOnly, dirty, phone, compare, onCompare, onRestored, onClose }) {
  const checks = useDeckChecks(projectId, versions.length);
  const pair = compare ? comparePair(versions, compare) : null;
  return (
    <Frame title="Versions" testId="pitch-sheet-versions" onClose={onClose} width={760}>
      <Versions versions={versions} phone={phone} onCompare={onCompare} checks={checks} />
      {dirty && !readOnly ? <span className={MUTED} role="status" data-testid="pitch-sheet-versions-dirty">Save your changes first, then restore a version.</span> : null}
      {pair ? (
        <VersionCompare key={`${pair.older.id}-${pair.newer.id}`} older={pair.older} newer={pair.newer} versions={versions} readOnly={readOnly || dirty}
          onClose={() => onCompare(null)} onRestored={onRestored} />
      ) : null}
    </Frame>
  );
}

export function SourcesSheet({ onClose, children }) {
  return <Frame title="Sources and coverage" testId="pitch-sheet-sources" onClose={onClose} width={560}>{children}</Frame>;
}

export function CheckSheet({ deck, projectId, readOnly, dirty, onReplaced, onClose }) {
  return (
    <Frame title="Check claims" testId="pitch-sheet-check" onClose={onClose} width={560}>
      <CheckPanel key={deck.id} deck={deck} projectId={projectId} readOnly={readOnly} dirty={dirty} onReplaced={onReplaced} />
    </Frame>
  );
}
