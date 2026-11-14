/**
 * D1484 part 2 (#3978, of #3723) — CAL4: what is on this calendar, per member.
 *
 * At /calendar/sources, over the view it was opened from, beside
 * /calendar/connected. Each source, grouped by family:
 *   - a Show toggle (a hidden source is not read on the page; `.ics`, the
 *     subscription feeds and the provider copies are unchanged);
 *   - its colour: its family's, or one of nine palette tokens;
 *   - its count in the page's range, "—" with why for a source that did not
 *     answer, never 0 (`calendarSourcesModel.js`).
 * Every change saves at once (migration 708) and the page re-reads.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { calendarSourcesApi } from '../lib/api/calendarSources';
import { Lightbox } from '../ui';
import { COLOURS, COLOUR_LABELS, countOf, groupsOf, withSource } from './calendarSourcesModel';

export default function CalendarSourcesPanel({ items, sources, allowed, onChanged, onClose }) {
  const [read, setRead] = useState(undefined); // undefined: reading; null: could not be read
  const [said, setSaid] = useState({});
  const load = useCallback(async () => {
    try { setRead(await calendarSourcesApi.sources()); }
    catch { setRead(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (key, patch) => {
    setSaid((s) => ({ ...s, [key]: null }));
    try {
      const r = await calendarSourcesApi.setSource(key, patch);
      if (r?.source) setRead((x) => withSource(x, r.source));
      await onChanged?.();
    } catch (e) {
      setSaid((s) => ({ ...s, [key]: e?.message || 'Not saved. Try again.' }));
    }
  };

  const groups = read ? groupsOf(read, { allowed }) : [];
  return (
    <Lightbox label="Calendar sources" eyebrow="Calendar" title="What is on this calendar" width={600}
      sub="Choose what this page shows and its colour. Your calendar links and the copies in Google or Outlook are not changed."
      onClose={onClose} testId="cal-sources">
      <div className="cal-conn" data-testid="cal-sources-body">
        {read === undefined ? <p className="cal-foot" role="status">Reading your sources…</p> : null}
        {read === null ? (
          <p className="cal-foot" role="status" data-testid="cal-sources-error">
            Your sources could not be read. <button type="button" className="cal-btn cal-btn-o cal-btn-sm" onClick={load}>Try again</button>
          </p>
        ) : null}
        {groups.map((g) => (
          <section key={g.key} className="cal-sect" data-testid={`cal-sources-family-${g.key}`}>
            <div className="cal-eb">{g.label}</div>
            <ul className="cal-conn-list">
              {g.sources.map((s) => {
                const count = countOf(s.key, { shown: s.shown, items, sources });
                return (
                  <li key={s.key} className="cal-conn-row" data-testid={`cal-source-${s.key}`} data-shown={s.shown ? '1' : '0'}>
                    <span className="cal-dot" data-kind={s.key} data-colour={s.colour || undefined} aria-hidden="true" />
                    <div className="cal-conn-text">
                      <strong>{s.label}</strong>
                      <p>{s.module}</p>
                      {said[s.key] ? <p role="status" className="cal-conn-said" data-testid={`cal-source-${s.key}-said`}>{said[s.key]}</p> : null}
                    </div>
                    <div className="cal-conn-side">
                      <span className="cal-mono" title={count.why || undefined} data-testid={`cal-source-${s.key}-count`}>{count.text}</span>
                      {count.why ? <span className="cal-foot" data-testid={`cal-source-${s.key}-why`}>{count.why}</span> : null}
                      <label className="cal-foot">
                        <input type="checkbox" checked={s.shown} onChange={(e) => save(s.key, { shown: e.target.checked })}
                          data-testid={`cal-source-${s.key}-shown`} /> Show
                      </label>
                      <select aria-label={`${s.label} colour`} value={s.colour || ''} onChange={(e) => save(s.key, { colour: e.target.value || null })}
                        className="cal-btn cal-btn-o cal-btn-sm" data-testid={`cal-source-${s.key}-colour`}>
                        <option value="">Family colour</option>
                        {COLOURS.map((c) => <option key={c} value={c}>{COLOUR_LABELS[c]}</option>)}
                      </select>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Lightbox>
  );
}
