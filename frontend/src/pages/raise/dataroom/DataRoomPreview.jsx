import React, { useEffect, useMemo, useState } from 'react';
import { dataRoomApi } from '../../../lib/api/dataRoom';
import { Unreadable } from '../../../ui';
import { infoLine, previewView, viewAsOptions } from './previewModel';

/**
 * D1108 (#2988) — Preview (DR13, DR13e): the room exactly as one investor sees
 * it today, from D1103's read, which runs the investor read's own filter for
 * that grant. Files the grant may not open are counted, never named; an
 * investor whose access ended or was revoked sees one sentence. Nothing here
 * is logged or sent, and nothing can be opened: it is a look, not a download.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const NOTE = 'rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-2.5 text-[12.5px] font-semibold text-axal-ink dark:border-violet-800 dark:bg-violet-900/30 dark:text-gray-100';
const CHIP_ON = 'border-axal-violet bg-axal-lavender font-bold text-axal-violet-deep dark:border-[#a78bfa] dark:bg-violet-900/30 dark:text-[#a78bfa]';
const CHIP_OFF = 'border-axal-hairline font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100';

export default function DataRoomPreview({ room, projectUid }) {
  const options = useMemo(() => viewAsOptions(room), [room]);
  const [as, setAs] = useState(options[0]?.uid || null);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState({ status: 'idle', read: null });
  const chosen = options.find((o) => o.uid === as) || null;

  useEffect(() => {
    if (!projectUid || !as) return undefined;
    let alive = true;
    setState({ status: 'loading', read: null });
    dataRoomApi.preview(projectUid, as)
      .then((read) => { if (alive) setState({ status: 'ready', read }); })
      .catch(() => { if (alive) setState({ status: 'error', read: null }); });
    return () => { alive = false; };
  }, [projectUid, as, reload]);

  if (!options.length) {
    return (
      <section className={`${CARD} px-4 py-4`} data-testid="dataroom-preview-none">
        <h2 className={`m-0 text-[15px] font-extrabold ${INK}`}>Preview as an investor</h2>
        <p className={`m-0 mt-1 text-[12.5px] ${MUTED}`}>The room is not shared with anyone yet, so there is no investor to view it as. Share it from Access.</p>
      </section>
    );
  }

  const view = state.status === 'ready'
    ? previewView(state.read, { who: chosen?.who, committed: chosen?.committed, roomFolders: Array.isArray(room?.folders) ? room.folders.length : null })
    : null;

  return (
    <div className="flex flex-col gap-4" data-testid="dataroom-preview">
      <div className="flex flex-wrap items-center gap-2">
        <span className={EYEBROW}>View as</span>
        <span className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="View as">
          {options.map((o) => (
            <button key={o.uid} type="button" role="radio" aria-checked={o.uid === as} onClick={() => setAs(o.uid)}
              className={`min-h-[30px] rounded-full border px-3 text-[12px] ${o.uid === as ? CHIP_ON : CHIP_OFF}`} data-testid={`dataroom-preview-as-${o.uid}`}>
              {o.label}
            </button>
          ))}
        </span>
      </div>
      <p className={`m-0 ${NOTE}`} data-testid="dataroom-preview-info">{infoLine(chosen?.who)}</p>
      {state.status === 'loading' || state.status === 'idle'
        ? <div className="h-40 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid="dataroom-preview-loading" />
        : state.status === 'error'
          ? (
            <div data-testid="dataroom-preview-unreadable">
              <Unreadable what="The preview" claim="This is not a claim that this investor sees nothing." onRetry={() => setReload((n) => n + 1)} />
            </div>
          )
          : !view.open
            ? (
              <section className={`${CARD} mx-auto flex w-full max-w-[560px] flex-col items-center gap-2 px-7 py-8 text-center`} data-testid="dataroom-preview-ended">
                <span aria-hidden="true" className={`text-[22px] ${MUTED}`}>⊘</span>
                <h2 className={`m-0 text-[16px] font-extrabold ${INK}`}>{view.title}</h2>
                <p className={`m-0 text-[13px] ${MUTED}`}>{view.line}</p>
              </section>
            )
            : (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                <section className={CARD} data-testid="dataroom-preview-room">
                  <div className="border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
                    <span className={EYEBROW}>As on their deal page</span>
                    <h2 className={`m-0 text-[15px] font-extrabold ${INK}`}>Data room · {view.room}</h2>
                  </div>
                  <div className="flex flex-col gap-3 px-4 py-3">
                    <p className={`m-0 ${NOTE}`} data-testid="dataroom-preview-banner">{view.banner}</p>
                    {view.empty ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-preview-empty">No file is in the room for them yet.</p> : null}
                    {view.groups.map((g) => (
                      <div key={g.uid || 'top'} className="flex flex-col gap-1" data-testid="dataroom-preview-folder">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`text-[13px] font-bold ${INK}`}>{g.name}</span>
                          <span className={`font-mono text-[11.5px] ${MUTED}`}>{g.count}</span>
                        </div>
                        {g.files.length ? (
                          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 pl-3">
                            {g.files.map((name, i) => <li key={`${name}-${i}`} className={`text-[12.5px] ${INK}`} data-testid="dataroom-preview-file">{name}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                    {view.withheld ? (
                      <div className="flex flex-col gap-0.5 border-t border-axal-hairline pt-2 dark:border-gray-800" data-testid="dataroom-preview-withheld">
                        <span className={`text-[13px] font-bold ${INK}`}>⊘ {view.withheld.title}</span>
                        <span className={`text-[12px] ${MUTED}`}>{view.withheld.sub}</span>
                      </div>
                    ) : null}
                  </div>
                  <p className={`m-0 border-t border-axal-hairline px-4 py-2.5 text-[11.5px] dark:border-gray-800 ${MUTED}`}>
                    When they open a file, it makes a one-time link that works for two minutes, and it is logged. Files are not watermarked.
                  </p>
                </section>
                {view.margin.length ? (
                  <section className={`${CARD} border-axal-lavender-edge bg-axal-lavender px-4 py-3 dark:border-violet-800 dark:bg-violet-900/20`} data-testid="dataroom-preview-margin">
                    <span className={EYEBROW}>Only you see this</span>
                    <ul className="m-0 mt-1 flex list-none flex-col gap-1.5 p-0">
                      {view.margin.map((t) => <li key={t} className={`text-[12.5px] ${INK}`}>• {t}</li>)}
                    </ul>
                  </section>
                ) : null}
              </div>
            )}
    </div>
  );
}
