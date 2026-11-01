/**
 * D1419 (#3698) — the Studio's smaller parts:
 *   - `StudioFixedLock` (the strip and the profile card: "Fixed: always on your Studio");
 *   - `StudioLayoutNotice` (SM8a–c, and why a save failed);
 *   - `StudioNoProfile` (SM12a: the client's answer to 403 `no_studio_profile`);
 *   - `ModuleLockedSheet` (SM12b, on the shared right Sheet);
 *   - `StudioEditBar` with the reset confirm (SM5, SM5s, SM5r);
 *   - `CustomiseButton`, hidden for an administrator and whenever a read failed.
 */
import { Link } from 'react-router-dom';
import { Check, Info, Loader2, Lock, SlidersHorizontal, X } from 'lucide-react';
import { Lightbox, Sheet } from '../../ui';
import { droppedLines, includedIn, placedLine } from './studioLayoutModel';

const PROFILE_NAME = { founder: 'founder', investor: 'investor', advisor: 'advisor', partner: 'operating partner' };

export const FIXED_LINE = 'Fixed: always on your Studio';

export function StudioFixedLock() {
  return (
    <span className="sm-lock" role="img" aria-label={FIXED_LINE} title={FIXED_LINE} data-testid="studio-fixed-lock">
      <Lock size={11} aria-hidden="true" />
    </span>
  );
}

export function CustomiseButton({ studio, primary = false }) {
  if (!studio?.canCustomise || studio.editing) return null;
  return (
    <button type="button" className={`sm-btn ${primary ? 'sm-btn-p' : 'sm-btn-s'}`} onClick={studio.customise} data-testid="button-studio-customise">
      <SlidersHorizontal size={14} aria-hidden="true" /> Customise
    </button>
  );
}

const SAVE_LINE = {
  stale: 'Your layout changed in another tab.',
  failed: 'Your layout could not be saved.',
  reset_failed: 'Your layout could not be reset.',
};

/** Every notice above the grid, in order: the read (SM8a), what was removed (SM8b), and a failed save (SM8c, locked, failed). */
export function StudioLayoutNotice({ studio, titleOf }) {
  const out = [];
  if (studio.layoutRead === 'failed' && !studio.noProfile) {
    const unreadable = studio.layout?.kind === 'layout_unreadable';
    out.push(
      <p key="read" className="sm-notice" role="status" data-testid="studio-notice-read">
        <Info size={14} aria-hidden="true" />
        <span>{unreadable ? 'Your saved layout could not be read; showing the default.' : 'Your layout could not be read; showing the default.'}</span>
        <span className="sm-spacer" />
        {unreadable && !studio.readOnly
          ? <button type="button" className="sm-btn sm-btn-s sm-btn-sm" onClick={() => studio.setAskReset(true)}>Reset to default</button>
          : <button type="button" className="sm-btn sm-btn-s sm-btn-sm" onClick={studio.reload}>Try again</button>}
      </p>,
    );
  }
  const lines = droppedLines(studio.dropped);
  if (lines.length) {
    out.push(
      <div key="dropped" className="sm-notice" data-tone="lav" role="status" data-testid="studio-notice-dropped">
        <div className="grid gap-1">{lines.map((l) => <span key={l}>{l}</span>)}</div>
        <span className="sm-spacer" />
        <button type="button" className="sm-icon" aria-label="Dismiss" onClick={studio.dismissDropped}><X size={14} aria-hidden="true" /></button>
      </div>,
    );
  }
  const err = studio.saveError;
  if (err) {
    const line = err.kind === 'locked'
      ? `${err.key ? titleOf(err.key) : 'A module'} is not on your plan. ${includedIn(err.plan)}.`
      : SAVE_LINE[err.kind] || SAVE_LINE.failed;
    out.push(
      <p key="save" className="sm-notice" role="alert" data-testid={`studio-notice-${err.kind}`}>
        <span>{line}</span>
        <span className="sm-spacer" />
        {err.kind === 'stale' && <button type="button" className="sm-btn sm-btn-s sm-btn-sm" onClick={studio.reload}>Reload layout</button>}
        {err.kind === 'locked' && <Link to="/pricing" className="sm-btn sm-btn-s sm-btn-sm">See plans</Link>}
        {(err.kind === 'failed' || err.kind === 'reset_failed') && (
          <button type="button" className="sm-btn sm-btn-s sm-btn-sm" onClick={err.kind === 'failed' ? studio.done : studio.reset}>Try again</button>
        )}
      </p>,
    );
  }
  return out.length ? <>{out}</> : null;
}

export function StudioNoProfile() {
  return (
    <section className="sm-notice" role="status" data-testid="studio-no-profile">
      <span>Studio layouts are for founder, investor, advisor and operating partner profiles.</span>
      <span className="sm-spacer" />
      <Link to="/onboarding" className="sm-btn sm-btn-s sm-btn-sm">Choose a profile</Link>
    </section>
  );
}

export function ModuleLockedSheet({ studio }) {
  const mod = (studio.catalogue || []).find((m) => m.key === studio.lockedKey);
  if (!mod) return null;
  const close = () => studio.setLockedKey(null);
  const group = (studio.groups || []).find((g) => g.key === mod.group)?.label || null;
  return (
    <Sheet
      label={mod.title}
      title={mod.title}
      eyebrow={group}
      sub={mod.purpose || null}
      width={520}
      onClose={close}
      testId="studio-locked-sheet"
      footer={(
        <div className="flex w-full justify-end gap-2">
          <button type="button" className="sm-btn sm-btn-s" onClick={close}>Not now</button>
          <Link to="/pricing" className="sm-btn sm-btn-p">See plans</Link>
        </div>
      )}
    >
      <div className="sm-root">
        <span className="sm-preview" style={{ height: 140 }} aria-hidden="true" />
        <p className="sm-locked"><Lock size={13} aria-hidden="true" /> {includedIn(mod.plan)}</p>
      </div>
    </Sheet>
  );
}

export function ResetDialog({ studio }) {
  const count = studio.editing ? studio.shown.length : studio.placed.length;
  const profileName = PROFILE_NAME[studio.profile] || 'Studio';
  if (!studio.askReset) return null;
  const close = () => studio.setAskReset(false);
  return (
    <Lightbox
      label="Replace your layout with the default?"
      title="Replace your layout with the default?"
      width={520}
      onClose={close}
      testId="studio-reset-dialog"
      footer={(
        <div className="flex w-full justify-end gap-2">
          <button type="button" className="sm-btn sm-btn-s" onClick={close}>Cancel</button>
          <button type="button" className="sm-btn sm-btn-p" onClick={studio.reset}>Replace layout</button>
        </div>
      )}
    >
      <p className="text-[13.5px] text-axal-muted dark:text-gray-400">
        Your {count} {count === 1 ? 'module and its size are' : 'modules and their sizes are'} replaced by the {profileName} default. This cannot be undone.
      </p>
    </Lightbox>
  );
}

/** The sticky bar in Customise: the count, Add, Reset, and Done as the only save. */
export function StudioEditBar({ studio }) {
  const saving = studio.saving === 'saving';
  return (
    <>
      <div className="sm-bar" role="region" aria-label="Customise your Studio" data-testid="studio-edit-bar">
        <span className="sm-count text-[13px]">{placedLine(studio.shown, true)}</span>
        <button type="button" className="sm-btn sm-btn-s" onClick={() => studio.setMapOpen(true)} data-testid="button-studio-add">+ Add modules</button>
        <button type="button" className="sm-btn sm-btn-t" onClick={() => studio.setAskReset(true)} data-testid="button-studio-reset">Reset to default</button>
        <span className="sm-spacer" />
        <button
          type="button"
          className="sm-btn sm-btn-p"
          aria-disabled={saving ? 'true' : undefined}
          style={saving ? { cursor: 'progress', opacity: 0.8 } : undefined}
          onClick={() => { if (!saving) studio.done(); }}
          data-testid="button-studio-done"
        >
          {saving ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Saving…</> : 'Done'}
        </button>
      </div>
    </>
  );
}

export function SavedLine({ studio }) {
  if (studio.saving !== 'saved') return null;
  return <span className="sm-saved" role="status" data-testid="studio-saved"><Check size={14} aria-hidden="true" /> Saved</span>;
}
