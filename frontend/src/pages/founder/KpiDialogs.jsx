import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { metricLabel } from '../../lib/metricTargets';

/**
 * `/build/kpi`'s two ops — `Definitions` and `Import CSV`. Task #176, FB5.
 *
 * Both were registered `unbuilt`, which renders NOTHING, so two of the artboard's
 * four ops were invisible. Migration 251 stores definitions;
 * `services/metricsCsv.ts` parses the import.
 *
 * THE IMPORT DIALOG'S REAL JOB IS THE REJECTION LIST. An importer that reports
 * "OK" while eleven of fourteen months went missing is worse than one that fails,
 * because the founder finds out six weeks later when a board pack is short. So the
 * dry run happens first, by default, and every refused line is printed with its
 * file line number before anything is written.
 */

function Shell({ title, sub, onClose, children, testid, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fb-kpi-modal" role="dialog" aria-modal="true" aria-label={title} data-testid={testid}>
      <div className={wide ? 'fb-kpi-modal-card is-wide' : 'fb-kpi-modal-card'}>
        <header>
          <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </header>
        {children}
      </div>
    </div>
  );
}

/**
 * The definitions editor.
 *
 * `keys` and `sources` come from the ROUTE's own read, not from a list in this
 * file — the targets editor set that convention and the reason is the same: a
 * picker that offers an option the write refuses is a form that fails on submit
 * for no reason the reader can see.
 */
export function DefinitionsDialog({ definitions, keys, sources, onClose, onSave, onClear }) {
  const byKey = useMemo(() => {
    const map = new Map();
    for (const d of definitions || []) map.set(d.metric_key, d);
    return map;
  }, [definitions]);

  const [metricKey, setMetricKey] = useState((keys || [])[0] || '');
  const [text, setText] = useState('');
  const [sourceKind, setSourceKind] = useState('manual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Switching metric loads whatever is stored for it, so the editor is showing the
  // row it is about to overwrite rather than the last one that was open.
  useEffect(() => {
    const existing = byKey.get(metricKey);
    setText(existing?.definition || '');
    setSourceKind(existing?.source_kind || 'manual');
    setError('');
  }, [metricKey, byKey]);

  const save = async () => {
    if (!text.trim()) { setError('Write what this metric counts, or clear it instead.'); return; }
    setBusy(true); setError('');
    try {
      await onSave({ metric_key: metricKey, definition: text.trim(), source_kind: sourceKind });
    } catch (cause) {
      setError(cause?.message || 'The definition could not be saved.');
    }
    setBusy(false);
  };

  const clear = async () => {
    setBusy(true); setError('');
    try { await onClear(metricKey); } catch (cause) {
      setError(cause?.message || 'The definition could not be cleared.');
    }
    setBusy(false);
  };

  return (
    <Shell
      testid="dialog-definitions"
      title="Metric definitions"
      sub="What each figure counts, and what it excludes — so “net burn” means the same thing in month 14 as it did in month 1."
      onClose={onClose}
    >
      <div className="fb-kpi-form">
        <label><span>Metric</span>
          <select data-testid="select-definition-metric" value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
            {(keys || []).map((k) => (
              <option key={k} value={k}>{metricLabel(k)}{byKey.has(k) ? ' · defined' : ''}</option>
            ))}
          </select>
        </label>
        <label><span>Expected source</span>
          <select data-testid="select-definition-source" value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}>
            {(sources || ['manual']).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {/* This is NOT `project_metrics.source`. That records where one row came
            from; this records where the founder intends the metric to come from,
            and the two disagreeing is a finding — a metric declared Stripe-synced
            whose rows all say manual means the integration is not running. */}
        <label><span>Definition</span>
          <textarea
            data-testid="input-definition-text"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Net burn = operating cash out minus cash in, excluding financing. Contractors included; prepaid annual tools amortised over the term."
          />
        </label>
        {error && <p className="fb-kpi-form-error" role="alert">{error}</p>}
        <footer>
          {byKey.has(metricKey) && (
            <button type="button" data-testid="button-definition-clear" className="is-quiet" onClick={clear} disabled={busy}>Clear</button>
          )}
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" data-testid="button-definition-save" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save definition'}</button>
        </footer>

        {(definitions || []).length > 0 && (
          <div className="fb-kpi-definition-list">
            <span>On record</span>
            <ul>
              {definitions.map((d) => (
                <li key={d.id}>
                  <strong>{metricLabel(d.metric_key)}</strong>
                  <small>{d.source_kind}</small>
                  <p>{d.definition}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Shell>
  );
}

/**
 * The CSV importer.
 *
 * TWO STEPS AND THE FIRST ONE WRITES NOTHING. `dry_run: true` returns the same
 * verdict the real import would produce, so a founder sees which lines would land
 * and which would be refused before committing. The second press sends the same
 * text without the flag. One endpoint, one parser — a separate "validate" call
 * would be a second answer to the same question.
 */
export function ImportCsvDialog({ onClose, onRun, onDone }) {
  const [csv, setCsv] = useState('');
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [written, setWritten] = useState(null);

  const check = async () => {
    if (!csv.trim()) { setError('Paste the rows first, header included.'); return; }
    setBusy(true); setError(''); setWritten(null);
    try {
      setPlan(await onRun({ csv, dry_run: true }));
    } catch (cause) {
      setError(cause?.message || 'The file could not be read.');
      setPlan(null);
    }
    setBusy(false);
  };

  const commit = async () => {
    setBusy(true); setError('');
    try {
      const result = await onRun({ csv });
      setWritten(result?.written ?? 0);
      setPlan(result);
      await onDone?.();
    } catch (cause) {
      setError(cause?.message || 'The import could not be written.');
    }
    setBusy(false);
  };

  const wouldWrite = plan?.would_write ?? plan?.written ?? 0;
  const rejected = plan?.rejected || [];

  return (
    <Shell
      testid="dialog-import-csv"
      title="Import CSV"
      wide
      sub="Paste a month-per-row export. A month column and at least one metric column are required; everything else is optional."
      onClose={onClose}
    >
      <div className="fb-kpi-form">
        <label><span>Rows</span>
          <textarea
            data-testid="input-import-csv"
            rows={9}
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setPlan(null); setWritten(null); }}
            placeholder={'month,MRR,Net burn,Headcount\n2026-07,98400,58000,4\n2026-08,"104,800","61,200",4'}
            spellCheck={false}
          />
        </label>
        <p className="fb-kpi-form-hint">
          Recognised month formats: <code>2026-08</code>, <code>2026-08-01</code>,
          {' '}<code>08/2026</code>, <code>Aug 2026</code>. Values may carry
          {' '}<code>$</code>, <code>%</code>, thousands commas and accounting
          parentheses for negatives. Imported rows are stored with source
          {' '}<code>csv</code>, so they never overwrite a figure entered by hand.
        </p>

        {error && <p className="fb-kpi-form-error" role="alert">{error}</p>}

        {plan && (
          <div className="fb-kpi-import-verdict" data-testid="import-verdict">
            <div className={rejected.length ? 'fb-kpi-import-head has-rejects' : 'fb-kpi-import-head'}>
              {rejected.length ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
              <strong>
                {written != null
                  ? `${written} ${written === 1 ? 'month' : 'months'} written`
                  : `${wouldWrite} ${wouldWrite === 1 ? 'month' : 'months'} would be written`}
              </strong>
              {rejected.length > 0 && <span>{rejected.length} {rejected.length === 1 ? 'line' : 'lines'} refused</span>}
            </div>
            {/* EVERY REFUSED LINE IS PRINTED, with its line number in the FILE so
                the founder can find it in their own editor. A count alone would
                tell them something went wrong and not what. */}
            {rejected.length > 0 && (
              <ul className="fb-kpi-import-rejects" data-testid="import-rejects">
                {rejected.map((r) => <li key={`${r.line}-${r.reason}`}><b>Line {r.line}</b> {r.reason}</li>)}
              </ul>
            )}
            {(plan.ignored || []).length > 0 && (
              <p className="fb-kpi-form-hint" data-testid="import-ignored">
                Columns ignored: {plan.ignored.join(', ')}. Nothing was read from them.
              </p>
            )}
            {(plan.months || []).length > 0 && (
              <p className="fb-kpi-form-hint">Months written: {plan.months.join(', ')}.</p>
            )}
          </div>
        )}

        <footer>
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" data-testid="button-import-check" onClick={check} disabled={busy}>
            {busy && !plan ? 'Reading…' : 'Check the file'}
          </button>
          {/* Only enabled once a dry run has said there is something to write, so
              the committing press is never the first thing that reads the file. */}
          <button
            type="button"
            data-testid="button-import-commit"
            onClick={commit}
            disabled={busy || written != null || !wouldWrite}
            title={wouldWrite ? undefined : 'Check the file first — nothing would be written yet.'}
          >
            {busy && plan ? 'Writing…' : `Import ${wouldWrite || ''}`.trim()}
          </button>
        </footer>
      </div>
    </Shell>
  );
}
