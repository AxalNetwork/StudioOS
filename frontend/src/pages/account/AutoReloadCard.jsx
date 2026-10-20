import { lazy, Suspense, useState } from 'react';
import { aiBudgetApi } from '../../lib/api/aiBudget';
import { Pill, Unreadable } from '../../ui';
import { BTN, INPUT, Outcome, PanelCard, useAccountRead } from './AccountCenter';

// Stripe's element loads only when a card is being added.
const AutoReloadCardSetup = lazy(() => import('./AutoReloadCardSetup'));
import { refusalText } from './accountCenterModel';
import { cardText, lastSkipped, packOptions, parseThreshold, stateLine } from './autoReloadModel';

/**
 * D794 (#2219) — Billing's "Auto-reload" card (`#auto-reload`), beside the
 * orders until D792's Billing page lands.
 *
 * OFF UNTIL THE MEMBER TURNS IT ON. They choose a pack (what is charged each
 * time) and a threshold ("when my token balance drops below $X"), and save a
 * card. The card is entered on Stripe's own element, confirmed as a SetupIntent
 * for off-session use; StudioOS keeps the SetupIntent's id only long enough to
 * save, and the Worker reads the card back from Stripe. A reload is an ordinary
 * pack order, listed under Orders with its invoice.
 *
 * Each call asks for a recent TOTP sign-in; the app's step-up prompt handles
 * it and the call is retried.
 */
export default function AutoReloadCard({ api = aiBudgetApi }) {
  const read = useAccountRead(() => api.autoReload());
  const topUp = useAccountRead(() => api.topUp());
  const packs = packOptions(topUp.status === 'ready' ? topUp.data : null);
  return (
    <div id="auto-reload" className="scroll-mt-4">
      <PanelCard title="Auto-reload" data-testid="card-auto-reload">
        {read.status === 'loading' ? <p className="px-4 py-3 text-[12.5px] text-axal-muted">Reading auto-reload…</p>
          : read.status !== 'ready' ? <div className="px-4 py-3"><Unreadable what="Auto-reload" claim="This is not a claim that it is off." onRetry={read.reload} /></div>
            : <AutoReloadForm key={JSON.stringify(read.data)} settings={read.data} packs={packs} api={api} onSaved={read.reload} />}
      </PanelCard>
    </div>
  );
}

export function AutoReloadForm({ settings, packs, api = aiBudgetApi, onSaved }) {
  const [enabled, setEnabled] = useState(Boolean(settings.enabled));
  const [packUid, setPackUid] = useState(settings.pack_uid ?? packs[0]?.uid ?? '');
  const [threshold, setThreshold] = useState(settings.threshold_usd == null ? '5' : String(settings.threshold_usd));
  const [setupIntentId, setSetupIntentId] = useState(null);
  const [addingCard, setAddingCard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const state = stateLine(settings, packs);
  const skipped = lastSkipped(settings);
  const card = cardText(settings.card);
  const parsed = parseThreshold(threshold);
  const hasCard = Boolean(card || setupIntentId);
  const canSave = !busy && parsed !== null && Boolean(packUid) && (!enabled || hasCard);

  const save = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true); setOutcome(null);
    try {
      await api.saveAutoReload({ enabled, pack_uid: packUid, threshold_usd: parsed, ...(setupIntentId ? { setup_intent_id: setupIntentId } : {}) });
      setOutcome({ tone: 'ok', text: enabled ? 'Auto-reload is on.' : 'Auto-reload is off.' });
      onSaved?.();
    } catch (err) {
      setOutcome({ tone: 'error', text: refusalText(err, 'Auto-reload was not saved. Nothing changed.') });
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-3 px-4 py-3.5" data-testid="auto-reload-form">
      {state && <p className="m-0 text-[12.5px]" data-testid="auto-reload-state"><Pill tone={state.tone}>{enabled && settings.enabled ? 'On' : 'Off'}</Pill> <span className="ml-1">{state.text}</span></p>}
      {skipped && <p className="m-0 text-[12px] text-amber-800 dark:text-amber-300" data-testid="auto-reload-skipped">{skipped}</p>}
      <label className="flex items-center gap-2 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="auto-reload-enabled" />
        Reload my AI tokens automatically
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">
          Pack charged each time
          {packs.length === 0
            ? <span className="text-[12.5px] font-normal" data-testid="auto-reload-no-packs">No token pack is on sale right now.</span>
            : (
              <select className={INPUT} value={packUid} onChange={(e) => setPackUid(e.target.value)} data-testid="auto-reload-pack">
                {packs.map((p) => <option key={p.uid} value={p.uid}>{p.label}</option>)}
              </select>
            )}
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">
          When my token balance drops below (US$)
          <input className={INPUT} inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} data-testid="auto-reload-threshold" aria-invalid={parsed === null ? 'true' : undefined} />
        </label>
      </div>
      {parsed === null && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="auto-reload-threshold-error">Enter an amount from $0 to $500, with at most two decimals.</p>}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="auto-reload-card">
        <span>{setupIntentId ? 'New card added. Save to use it.' : card ? `Card: ${card}` : 'No card saved for auto-reload.'}</span>
        {!addingCard && <button type="button" className={BTN.link} onClick={() => setAddingCard(true)} data-testid="auto-reload-add-card">{card ? 'Replace card' : 'Add a card'}</button>}
      </div>
      {addingCard && (
        <Suspense fallback={<p className="m-0 text-[12.5px] text-axal-muted">Loading the secure card form…</p>}>
          <AutoReloadCardSetup api={api} onSaved={(id) => { setSetupIntentId(id); setAddingCard(false); }} onCancel={() => setAddingCard(false)} />
        </Suspense>
      )}
      {enabled && !hasCard && <p className="m-0 text-[12px] text-axal-muted" data-testid="auto-reload-card-needed">Add a card to turn auto-reload on.</p>}
      <p className="m-0 text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-400">
        Each reload is an ordinary token-pack order with its invoice under Orders, at most five a day. A declined card turns auto-reload off and we tell you.
      </p>
      <Outcome outcome={outcome} />
      <div className="flex justify-end">
        <button type="submit" className={BTN.primary} disabled={!canSave} data-testid="auto-reload-save">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
