import React, { useEffect, useState } from 'react';
import { deckPublishApi } from '../../../lib/api/deckPublish.js';
import { reportError } from '../../../lib/log';

/**
 * D1564 (#3811, deck builder v2 D3) — the publish control. It lives ONLY in
 * ShareDialog (Share ▾ › Share link…), on the link just made, never in the
 * studio header (plan §2.1 allows nothing else there).
 *
 * Owner decisions: E = B, a link may be published as a web page with the
 * email gate on by default, and a 506(b) round never publishes; T, until
 * counsel's wording lands public (un-gated) pages are off, which this panel
 * says, and the gate cannot be turned off. The Worker enforces both
 * (`routes/deck_publish.ts`); a refusal is shown in its own words.
 *
 * Nothing is written until Publish is pressed. The exemption has no default:
 * the founder states it. A published link can also be embedded on the sites
 * listed (https addresses, at most five).
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:opacity-60`;
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const EYE = 'font-mono text-[10px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const FIELD = 'min-h-[34px] rounded-[8px] border border-axal-hairline bg-white px-2 text-[12.5px] dark:border-gray-700 dark:bg-gray-900';

export const PUBLISH_TITLE = 'Publish as a web page';
export const PUBLIC_OFF = 'Public pages are off until counsel\'s wording is in. A published link asks for the reader\'s email first.';
export const EXEMPTION_ASK = 'Which exemption is this round offered under?';
export const EXEMPTION_506B_NOTE = 'A 506(b) round cannot be published. Share it one investor at a time.';
export const EXEMPTION_OPTIONS = Object.freeze([
  { id: '506b', label: 'Rule 506(b)' },
  { id: '506c', label: 'Rule 506(c)' },
]);

/** The origins typed, one per line or comma-separated. The Worker checks each. */
export const originsOf = (text) => String(text || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

/** The embed address for the link just made, from its share path; null when there is none. */
export function embedUrl(made, origin = globalThis.location?.origin ?? '') {
  const m = /^\/share\/deck\/([A-Za-z0-9._~-]+)$/.exec(String(made?.share_path || ''));
  return m ? `${origin}/embed/${m[1]}` : null;
}

/** What publishing would do, before it does it. */
export function whatPublishDoes(state) {
  if (state.exemption === '506b') return EXEMPTION_506B_NOTE;
  if (state.exemption !== '506c') return 'Say which exemption the round is offered under before publishing.';
  const sites = originsOf(state.origins);
  return `Anyone with this link sees the cards after giving their email.${sites.length ? ` It can be embedded on ${sites.length === 1 ? 'one site' : `${sites.length} sites`}.` : ''}`;
}

const failureOf = (e) => e?.data?.message || e?.data?.detail || (typeof e?.data?.error === 'string' && !/^[a-z_]+$/.test(e.data.error) ? e.data.error : null) || 'It could not be saved. Try again.';

export default function PublishPanel({ deck, made }) {
  const [read, setRead] = useState({ status: 'loading', value: null });
  const [state, setState] = useState({ exemption: null, origins: '' });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    if (!deck?.id || !made?.id) return undefined;
    let alive = true;
    deckPublishApi.read(deck.id, made.id)
      .then((r) => { if (alive) setRead({ status: 'ok', value: r }); })
      .catch((e) => { reportError('PublishPanel:read', e); if (alive) setRead({ status: 'error', value: null }); });
    return () => { alive = false; };
  }, [deck?.id, made?.id]);

  if (!deck?.id || !made?.id) return null;
  const value = read.value;
  const published = value?.publish || null;
  const publicOn = value?.public_views === true;

  const save = async (body) => {
    if (busy) return;
    setBusy(true); setFailed(null);
    try {
      setRead({ status: 'ok', value: await deckPublishApi.save(deck.id, made.id, body) });
    } catch (e) {
      reportError('PublishPanel:save', e);
      setFailed(failureOf(e));
    } finally { setBusy(false); }
  };
  const publish = () => save({ on: true, exemption: state.exemption, gate: 'email', embed_origins: originsOf(state.origins) });
  const embed = embedUrl(made);

  return (
    <section className="flex flex-col gap-2.5 rounded-[12px] border border-axal-hairline p-3 dark:border-gray-700" aria-label={PUBLISH_TITLE} data-testid="pitch-publish">
      <span className={EYE}>{PUBLISH_TITLE}</span>
      {!publicOn ? <p id="pitch-publish-public-off" className={`m-0 ${MUTED}`} data-testid="pitch-publish-public-off">{value?.note || PUBLIC_OFF}</p> : null}
      {read.status === 'loading' ? <p className={`m-0 ${MUTED}`}>Reading whether this link is published…</p> : null}
      {read.status === 'error' ? (
        <div className="flex flex-col gap-1.5">
          <p className={`m-0 ${MUTED}`} data-testid="pitch-publish-unread">Whether this link is published could not be read.</p>
          <button type="button" className={`w-fit ${GHOST}`} onClick={() => { setRead({ status: 'loading', value: null }); deckPublishApi.read(deck.id, made.id).then((r) => setRead({ status: 'ok', value: r })).catch(() => setRead({ status: 'error', value: null })); }} data-testid="pitch-publish-retry">Try again</button>
        </div>
      ) : null}
      {read.status === 'ok' && published ? (
        <div className="flex flex-col gap-2" data-testid="pitch-publish-on">
          <p className={`m-0 ${INK} text-[12.5px]`}>Published under Rule 506(c). Readers give their email first.</p>
          {published.embed_origins?.length && embed ? (
            <div className="flex flex-col gap-1">
              <span className={MUTED}>Embed on {published.embed_origins.join(', ')}:</span>
              <code className="min-w-0 truncate rounded-[8px] bg-axal-ground px-2.5 py-2 font-mono text-[12px] dark:bg-gray-800" data-testid="pitch-publish-embed">{`<iframe src="${embed}" width="100%" height="720"></iframe>`}</code>
            </div>
          ) : null}
          <button type="button" className={`w-fit ${GHOST}`} onClick={() => save({ on: false })} disabled={busy} data-testid="pitch-publish-off">{busy ? 'Saving…' : 'Unpublish'}</button>
        </div>
      ) : null}
      {read.status === 'ok' && !published ? (
        <div className="flex flex-col gap-2.5">
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className={`mb-1 ${INK} text-[12.5px]`}>{EXEMPTION_ASK}</legend>
            {EXEMPTION_OPTIONS.map((o) => (
              <label key={o.id} className={`flex items-center gap-2 text-[12.5px] ${INK}`}>
                <input type="radio" name="pitch-publish-exemption" value={o.id} checked={state.exemption === o.id}
                  onChange={() => setState((s) => ({ ...s, exemption: o.id }))} data-testid={`pitch-publish-exemption-${o.id}`} />
                {o.label}
              </label>
            ))}
          </fieldset>
          <label className={`flex items-center justify-between gap-3 text-[12.5px] ${INK}`}>
            <span>Ask for the reader&apos;s email</span>
            <input type="checkbox" checked readOnly disabled={!publicOn} aria-describedby={publicOn ? undefined : 'pitch-publish-public-off'} data-testid="pitch-publish-gate" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={MUTED}>Sites that may embed it (https addresses, optional)</span>
            <textarea className={`${FIELD} min-h-[56px] py-1.5 font-mono`} value={state.origins} onChange={(e) => setState((s) => ({ ...s, origins: e.target.value }))}
              placeholder="https://example.com" data-testid="pitch-publish-origins" />
          </label>
          <p className={`m-0 ${MUTED}`} data-testid="pitch-publish-what">{whatPublishDoes(state)}</p>
          <button type="button" className={`w-fit ${PRIMARY}`} onClick={publish} disabled={busy || state.exemption !== '506c'} data-testid="pitch-publish-save">
            {busy ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      ) : null}
      {failed ? <div role="alert" className="rounded-[10px] bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-axal-destructive dark:bg-red-950/40 dark:text-red-300" data-testid="pitch-publish-failed">{failed}</div> : null}
    </section>
  );
}
