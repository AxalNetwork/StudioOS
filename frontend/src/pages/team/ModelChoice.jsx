import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as agents from './agentsAdapter.js';
import { BTN_TEXT, HonestBlock, MUTED } from './teamUi.jsx';
import {
  OFFER_WORDS, allowedModels, basisLine, modelGroups, modelOffer, per100Line, strengthsLine, tokenRate,
} from './agentChoiceModel.js';

/**
 * D8769 (#8769, TMM05, TMM06, TMM08, TMM11) — the Add-an-agent sheet's model
 * choice, by the work each model supports and what a run would cost.
 *
 * GROUPS. `modelGroups` puts the models listed for the agent's area of work
 * first ("Suited to research"), each group one radio group; the rest wait
 * under "Other models this team allows", grouped by the first job each is
 * listed for (the Worker's `jobs`, from `USE_KINDS`).
 *
 * WHAT CAN BE CHOSEN. A model the plan locks reads "Not on your plan"; one the
 * team's allowlist (D4422, `readAllowlists`) leaves out reads "Not allowed on
 * this team". Both are drawn, disabled, so the person sees why. An allowlist
 * that could not be read marks nothing: the add route still checks it.
 *
 * THE ESTIMATE is D4121's `GET /:scope/:id/cost-estimate` for this draft
 * (model, area, persona, skills), read once per model that can be chosen in a
 * group on screen, and once for the chosen model. Its dearest run × 100 is the
 * "per 100 runs" line (owner Q3 = A, drawn). A read that answers
 * `{ available: false }` or fails says "Estimate unavailable" with "Try the
 * estimate for {model} again", which re-reads that model only. No answer, no
 * figure: nothing here is a 0 or a number of our own. The basis is the
 * Worker's own (`basis`), under "How the estimate is worked out".
 *
 * TOKEN PRICES are one press away ("Show token prices", `aria-expanded`): the
 * billed input and output price per 1M tokens, as `agentModels` sends them.
 */

const GROUP = 'flex flex-col gap-1.5';

function ModelRow({ m, chosen, offer, est, prices, onChoose, onRetry }) {
  const off = offer !== 'ok';
  const line = strengthsLine(m);
  const per100 = est?.status === 'ready' ? per100Line(est.value) : null;
  return (
    <div className={`flex min-h-[52px] items-start gap-3 rounded-axal-md border px-3 py-2 ${chosen ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-900/30' : 'border-axal-hairline dark:border-gray-700'} ${off ? 'opacity-70' : ''}`}
      data-testid={`model-${m.id}`} data-offer={offer}>
      <label className={`flex min-w-0 flex-1 items-start gap-3 ${off ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
        <input type="radio" name="model" checked={chosen} disabled={off} onChange={() => onChoose(m.id)} className="mt-1 accent-violet-600" aria-describedby={`model-est-${m.id.replace(/[^a-z0-9]/gi, '-')}`} />
        <span className="min-w-0 flex-1">
          <b className="block text-[13px] text-axal-ink dark:text-gray-100">{m.label}{m.beta ? ' · beta' : ''}</b>
          {line ? <span className={`block ${MUTED}`}>{line}</span> : null}
          <span id={`model-est-${m.id.replace(/[^a-z0-9]/gi, '-')}`} className="block text-[12.5px] text-axal-ink dark:text-gray-200" data-testid={`model-est-${m.id}`}>
            {off ? OFFER_WORDS[offer]
              : !est || est.status === 'loading' ? <span className={MUTED}>Working out the estimate…</span>
                : per100 || <span className="font-semibold text-axal-amber-deep">Estimate unavailable</span>}
          </span>
          {prices ? <span className={`block font-mono text-[11.5px] ${MUTED}`} data-testid={`model-prices-${m.id}`}>{`${tokenRate('Input', m.input_usd_per_million)} · ${tokenRate('Output', m.output_usd_per_million)}`}</span> : null}
        </span>
      </label>
      {!off && est?.status === 'ready' && !per100 ? (
        <button type="button" className={`shrink-0 ${BTN_TEXT}`} onClick={() => onRetry(m.id)} aria-label={`Try the estimate for ${m.label} again`} data-testid={`model-retry-${m.id}`}>Try again</button>
      ) : null}
    </div>
  );
}

function ModelGroup({ title, models, testId, ...row }) {
  return (
    <div role="radiogroup" aria-label={title} className={GROUP} data-testid={testId}>
      <h4 className="m-0 text-[12.5px] font-bold text-axal-ink dark:text-gray-100">{title}</h4>
      {models.map((m) => <ModelRow key={m.id} m={m} chosen={row.model === m.id} offer={modelOffer(m, row.allowed)} est={row.estimates[m.id]}
        prices={row.prices} onChoose={row.setModel} onRetry={row.read} />)}
    </div>
  );
}

/**
 * The model choice. `draft` is `{ kind, id, role, persona, skills }` for the
 * estimate; `onEstimate(est)` hands the chosen model's estimate up (or null),
 * for the cap's runs line and the phone bar.
 */
export default function ModelChoice({ models, draft, allowBlock, model, setModel, onEstimate }) {
  const [estimates, setEstimates] = useState({});
  const [prices, setPrices] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const allowed = useMemo(() => allowedModels(allowBlock), [allowBlock]);
  const list = Array.isArray(models) ? models : [];
  const { suited, others } = useMemo(() => modelGroups(list, draft.role), [list, draft.role]);
  const draftKey = `${draft.kind}|${draft.id}|${draft.role}|${draft.persona}|${(draft.skills || []).join(',')}`;
  const asked = useRef(new Set());
  const current = useRef(draftKey);
  useEffect(() => { current.current = draftKey; asked.current = new Set(); setEstimates({}); }, [draftKey]);
  const read = useCallback((id) => {
    asked.current.add(id);
    const key = draftKey;
    // An answer for a draft that has since changed (another skill, area or persona) is dropped, never shown.
    const land = (value) => { if (current.current === key) setEstimates((e) => ({ ...e, [id]: { status: 'ready', value } })); };
    setEstimates((e) => ({ ...e, [id]: { status: 'loading' } }));
    agents.draftCostEstimate(draft.kind, draft.id, { model: id, role: draft.role, persona: draft.persona, skills: draft.skills || [] })
      .then((out) => land(out?.available ? out.value : { available: false }))
      .catch(() => land({ available: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  const onScreen = useMemo(() => {
    const shown = [...(suited ? suited.models : []), ...((othersOpen || !suited) ? others.flatMap((g) => g.models) : [])];
    if (model && !shown.some((m) => m.id === model)) { const m = list.find((x) => x.id === model); if (m) shown.push(m); }
    return shown.filter((m) => modelOffer(m, allowed) === 'ok');
  }, [suited, others, othersOpen, model, list, allowed]);
  useEffect(() => { for (const m of onScreen) if (!asked.current.has(m.id)) read(m.id); }, [onScreen, read]);
  const chosenEst = model && estimates[model]?.status === 'ready' ? estimates[model].value : null;
  useEffect(() => { onEstimate?.(chosenEst); }, [chosenEst, onEstimate]);

  if (!list.length) return <HonestBlock>The models offered on your plan could not be read. That is not the same as none.</HonestBlock>;
  const row = { model, setModel, allowed, estimates, prices, read };
  const anyOk = list.some((m) => modelOffer(m, allowed) === 'ok');
  const basis = basisLine(Object.values(estimates).find((e) => e.status === 'ready' && e.value?.available)?.value);
  return (
    <div className="flex flex-col gap-3" data-testid="add-agent-models">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 flex-1 text-[13px] font-bold text-axal-ink dark:text-gray-100">Model</h3>
        <button type="button" className={BTN_TEXT} aria-expanded={prices} onClick={() => setPrices((v) => !v)} data-testid="model-prices-toggle">{prices ? 'Hide token prices' : 'Show token prices'}</button>
      </div>
      {prices ? <p className={`m-0 ${MUTED}`}>What you pay per million tokens, as the catalogue lists it today.</p> : null}
      {!anyOk && allowed instanceof Set ? (
        <HonestBlock testId="model-none-allowed">No model is allowed for this team. An editor sets the allowed models in Team › Settings.</HonestBlock>
      ) : null}
      {allowed === 'unread' && allowBlock ? <p className={`m-0 ${MUTED}`} data-testid="model-allow-unread">The models this team allows could not be read. Adding still checks them.</p> : null}
      {suited ? <ModelGroup title={suited.title} models={suited.models} testId="model-group-suited" {...row} /> : null}
      {others.length ? (
        suited ? (
          <details open={othersOpen} onToggle={(e) => setOthersOpen(e.currentTarget.open)} className="rounded-axal-md border border-axal-hairline dark:border-gray-700" data-testid="model-others">
            <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
              {`Other models this team allows · ${others.map((g) => `${g.title} ${g.models.length}`).join(' · ')}`}
            </summary>
            <div className="flex flex-col gap-3 border-t border-axal-hairline px-3 py-3 dark:border-gray-800">
              {others.map((g) => <ModelGroup key={g.key} title={g.title} models={g.models} testId={`model-group-${g.key}`} {...row} />)}
            </div>
          </details>
        ) : others.map((g) => <ModelGroup key={g.key} title={g.title} models={g.models} testId={`model-group-${g.key}`} {...row} />)
      ) : null}
      <details className="rounded-axal-md border border-axal-hairline dark:border-gray-700" data-testid="model-basis">
        <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-[13px] font-semibold text-axal-ink dark:text-gray-100">How the estimate is worked out</summary>
        <p className={`m-0 border-t border-axal-hairline px-3 py-2 dark:border-gray-800 ${MUTED}`}>
          {basis || 'Each estimate is the platform’s own figure for one run on that model at what you pay. Where it could not be worked out, no figure is shown.'}
        </p>
      </details>
    </div>
  );
}
