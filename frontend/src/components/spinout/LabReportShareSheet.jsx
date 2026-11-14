// D588 — the scoring page's share sheet. It says what the link shows and
// hides before the link exists, and it shows the link once.
import { useEffect, useState } from 'react';
import { labReportSharesApi } from '../../lib/api/labReportShares.js';
import { Unreadable } from '../../ui/Honesty';

export const SHARE_COPY = {
  summary: {
    shows: 'The latest official total score and its tier.',
    hides: 'Dimension scores, the inputs behind them, notes, and who scored it.',
  },
  dimensions: {
    shows: 'The latest official total, its tier, and the six dimension scores.',
    hides: 'The raw inputs, notes, and who scored it.',
  },
};

const FIELD = 'mt-1 w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 text-sm';

export default function LabReportShareSheet({ projectId, onClose }) {
  const [audience, setAudience] = useState('summary');
  const [days, setDays] = useState('7');
  const [opens, setOpens] = useState('5');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [minted, setMinted] = useState(null);
  const [list, setList] = useState({ status: 'loading', items: [] });

  const load = () => {
    setList({ status: 'loading', items: [] });
    labReportSharesApi.list(projectId)
      .then((data) => setList({ status: 'ready', items: Array.isArray(data?.items) ? data.items : [] }))
      .catch(() => setList({ status: 'failed', items: [] }));
  };

  useEffect(() => { load(); }, [projectId]);

  const scope = SHARE_COPY[audience];

  const create = async (event) => {
    event.preventDefault();
    setError('');
    const expires_in_days = Number(days);
    const open_limit = Number(opens);
    if (!Number.isInteger(expires_in_days) || expires_in_days < 1 || expires_in_days > 90
      || !Number.isInteger(open_limit) || open_limit < 1 || open_limit > 500) {
      setError('Expiry is 1 to 90 days, and the open limit is 1 to 500.');
      return;
    }
    if (!consent) {
      setError('Say that you agree to share this report before the link is created.');
      return;
    }
    setBusy(true);
    try {
      const mintedLink = await labReportSharesApi.create({
        project_id: projectId,
        audience,
        grantee_email: email.trim(),
        expires_in_days,
        open_limit,
        consent: true,
        report_kind: 'scoring',
      });
      setMinted(mintedLink);
      load();
    } catch (err) {
      setError(err?.message || 'The link was not created.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id) => {
    setError('');
    try {
      await labReportSharesApi.revoke(id);
      load();
    } catch (err) {
      setError(err?.message || 'The link was not revoked.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" role="presentation">
      <div role="dialog" aria-labelledby="lab-share-title" data-testid="lab-report-share-sheet" className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 max-h-[90vh] overflow-y-auto">
        <h2 id="lab-share-title" className="text-base font-semibold">Share this scoring report</h2>
        <p className="mt-1 text-[12.5px] text-gray-500 dark:text-gray-400">A practice run is not shared. The link is shown once.</p>

        {minted ? (
          <div className="mt-4" data-testid="lab-report-share-once">
            <p className="text-sm">This link works for the named account only, until {minted.expires_at}, for {minted.open_limit} {minted.open_limit === 1 ? 'open' : 'opens'}.</p>
            <p className="mt-2 text-sm"><span className="font-semibold">Shows.</span> {minted.shows}</p>
            <p className="mt-1 text-sm"><span className="font-semibold">Hides.</span> {minted.hides}</p>
            <p className="mt-3 break-all rounded-lg bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 p-2 text-[12.5px]" data-testid="lab-report-share-url">{minted.share_path}</p>
          </div>
        ) : (
          <form onSubmit={create} className="mt-4 space-y-3">
            <fieldset>
              <legend className="text-[12px] font-semibold">What the link shows</legend>
              {Object.entries(SHARE_COPY).map(([key, copy]) => (
                <label key={key} className="mt-2 flex items-start gap-2 text-sm">
                  <input type="radio" name="audience" value={key} checked={audience === key} onChange={() => setAudience(key)} data-testid={`lab-share-audience-${key}`} />
                  <span><span className="font-semibold">Shows.</span> {copy.shows} <span className="font-semibold">Hides.</span> {copy.hides}</span>
                </label>
              ))}
            </fieldset>
            <p className="text-[12.5px] text-gray-600 dark:text-gray-300" data-testid="lab-share-scope-preview">
              Shows. {scope.shows} Hides. {scope.hides}
            </p>
            <label className="block text-[12px] font-semibold">Account email
              <input className={FIELD} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="lab-share-email" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[12px] font-semibold">Expiry, in days
                <input className={FIELD} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} data-testid="lab-share-days" />
              </label>
              <label className="block text-[12px] font-semibold">Open limit
                <input className={FIELD} inputMode="numeric" value={opens} onChange={(e) => setOpens(e.target.value)} data-testid="lab-share-opens" />
              </label>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="lab-share-consent" />
              <span>I agree to share this official scoring report with that account, showing only what is named above.</span>
            </label>
            <button type="submit" disabled={busy} data-testid="lab-share-create" className="h-9 px-3 rounded-xl bg-violet-600 text-white text-sm font-semibold disabled:opacity-60">
              {busy ? 'Creating…' : 'Create the link'}
            </button>
          </form>
        )}

        {error && <p className="mt-3 text-[12.5px] text-rose-600 dark:text-rose-400" data-testid="lab-share-error">{error}</p>}

        <div className="mt-4">
          <h3 className="text-[12px] font-bold uppercase tracking-wider text-gray-400">Links already created</h3>
          {list.status === 'failed' && (
            <Unreadable what="These links" claim="This is not a claim that no link exists." onRetry={load} />
          )}
          {list.status === 'ready' && list.items.length === 0 && (
            <p className="mt-1 text-sm text-gray-500">No share link has been created for this project.</p>
          )}
          {list.status === 'ready' && list.items.map((item) => (
            <div key={item.id} className="mt-2 flex items-center justify-between gap-2 text-[12.5px]" data-testid={`lab-share-row-${item.id}`}>
              <span>{item.grantee_email} · {item.audience} · {item.opens} of {item.open_limit} opens · {item.revoked_at ? 'revoked' : `until ${item.expires_at}`}</span>
              {!item.revoked_at && (
                <button type="button" onClick={() => revoke(item.id)} data-testid={`lab-share-revoke-${item.id}`} className="underline">Revoke</button>
              )}
            </div>
          ))}
        </div>

        <button type="button" onClick={onClose} data-testid="lab-share-close" className="mt-4 text-sm underline">Close</button>
      </div>
    </div>
  );
}
