import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { cycleValidateApi } from '../../lib/api/cycleValidate';
import { alsoInFor } from '../../lib/adminPlacement.js';
import { EadwynButton, PhoneRows, Unreadable } from '../../ui';
import { CYCLE_NAMES, FIRST_FOCUS, ROOT_ACTION_PATHS, phoneFocus, phoneIndex, phoneMeter, targetValue, thenText } from './validatePhone';

/**
 * A cycle's phone root, One Next Thing (D703, #1665): COM over CO:26-27 and
 * CO:278-282. The eyebrow with the page's Eadwyn button, the headline, the
 * why, the meter where the read sends one, a 52px CTA, "Then" once, then
 * "Everything else in <Cycle>" and, where the cycle has any, "Also in
 * <Cycle>". It draws the Worker's `focus`, `meter` and `index` as sent
 * (`validatePhone.js`); only Validate's rule-1 focus, meter fallback and
 * "Set a target" are cycle-specific.
 *
 * `CycleRoute` draws it below 1024px on a cycle's root, in place of the
 * overview and `AlsoIn` (#1665's PR 1b); the desktop page draws neither.
 */

const NR = 'rounded border border-gray-300 px-1.5 text-[9.5px] font-bold text-gray-700 dark:border-gray-700 dark:text-gray-300';

function TargetForm({ projectId, current, api, onSaved, onCancel }) {
  const [text, setText] = useState(current == null ? '' : String(current));
  const [state, setState] = useState({ busy: false, error: null });
  const save = async (e) => {
    e?.preventDefault?.();
    const v = targetValue(text);
    if (v.error) { setState({ busy: false, error: v.error }); return; }
    setState({ busy: true, error: null });
    try {
      await api.setInterviewsTarget(projectId, v.value);
      onSaved?.();
    } catch (err) {
      setState({ busy: false, error: err?.message || 'The target could not be saved.' });
    }
  };
  return (
    <form className="mt-3 space-y-2" onSubmit={save} data-testid="phone-target-form">
      <label className="block text-[12px] font-semibold text-gray-900 dark:text-gray-200">Interviews a month
        <input value={text} onChange={(e) => setText(e.target.value)} inputMode="numeric" data-testid="phone-target-input" placeholder="Leave empty for no target"
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
      </label>
      {state.error && <p role="alert" className="m-0 text-[12px] font-semibold text-red-700 dark:text-red-300" data-testid="phone-target-error">{state.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={state.busy} data-testid="phone-target-save" className="rounded-md bg-violet-700 px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50 dark:bg-violet-600">{state.busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300">Cancel</button>
      </div>
    </form>
  );
}

/** Decision 2's one meter: the Worker's label and display, "· <reason>" with no target, the 7px bar against one. */
function Meter({ meter, children }) {
  return (
    <div className="mt-5" data-testid="phone-meter">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] font-bold text-gray-900 dark:text-gray-100">{meter.label}</span>
        <span className="text-[11.5px] font-extrabold tabular-nums text-violet-700 dark:text-violet-300" data-testid="phone-meter-value">
          {meter.display == null
            ? <span className={NR}>{meter.unreadable ? 'Unreadable' : 'Not recorded'}</span>
            : meter.target_reason ? <>{meter.display} <span className="font-semibold text-gray-600 dark:text-gray-400">· {meter.target_reason}</span></> : meter.display}
        </span>
      </div>
      {meter.pct != null && (
        <div className="mt-2 h-[7px] overflow-hidden rounded-full bg-[#ececf1] dark:bg-gray-800" role="progressbar" aria-label={meter.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.pct}>
          <div className="h-full rounded-full bg-violet-700 dark:bg-violet-400" style={{ width: `${meter.pct}%` }} />
        </div>
      )}
      {children}
    </div>
  );
}

/** A plain tap on the cycle's own action route opens it through `openAction`, as the desktop button does. */
const plainTap = (e) => !e.defaultPrevented && (e.button ?? 0) === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export default function PhoneCycleRoot({ cycle, raw, status = raw ? 'ready' : 'loading', search = '', projectId = null, api = cycleValidateApi, openAction, onChanged, onRetry }) {
  const [editing, setEditing] = useState(false);
  const name = CYCLE_NAMES[cycle] || cycle;
  const overview = `${name} · Overview`;

  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-3" data-testid="phone-root" data-cycle={cycle} aria-busy="true" aria-label="Loading">
        <div className="h-[40px] w-1/3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        <div className="h-[68px] animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        <div className="h-[52px] animate-pulse rounded-[14px] bg-gray-100 dark:bg-gray-800" />
      </div>
    );
  }
  if (status === 'unreadable' || !raw) {
    return (
      <div data-testid="phone-root" data-cycle={cycle}>
        <Unreadable what={`The ${name} overview`} claim="This is not a claim that nothing is recorded." onRetry={onRetry} />
      </div>
    );
  }

  const focus = phoneFocus(raw, search, cycle);
  const first = cycle === 'validate' && focus?.headline === FIRST_FOCUS.headline;
  // Validate draws no meter under its first-conversation focus, as drawn.
  const meter = focus && !first ? phoneMeter(raw, cycle) : null;
  const then = thenText(focus?.then);
  const actionHref = ROOT_ACTION_PATHS[cycle] ? `/${cycle}/${ROOT_ACTION_PATHS[cycle]}` : null;
  const opensAction = !!(openAction && actionHref && focus?.href && focus.href.split(/[?#]/)[0] === actionHref);
  const rows = phoneIndex(raw, search, cycle);
  const also = alsoInFor('founder', name);

  const groups = [{
    label: `Everything else in ${name}`,
    testid: 'phone-index',
    // With no focus the page's Eadwyn button sits beside the index label (D703.md records it).
    action: focus ? undefined : <EadwynButton label={overview} />,
    rows: rows.map((r) => ({
      key: r.key, title: r.title, description: r.detail || undefined, to: r.href || undefined,
      notRecorded: r.value == null, value: r.value || undefined, testid: `phone-index-${r.key}`,
    })),
  }];
  if (also.length) {
    groups.push({
      label: `Also in ${name}`,
      testid: 'phone-also-in',
      rows: also.map((p) => ({ key: p.route, title: p.label, description: p.description, to: p.route })),
    });
  }

  return (
    <div data-testid="phone-root" data-cycle={cycle}>
      {focus && (
        <section data-testid="phone-focus" aria-labelledby="phone-focus-title">
          <div className="flex min-h-[40px] items-center justify-between gap-2">
            <p className="m-0 text-[10px] font-extrabold uppercase tracking-[.12em] text-violet-700 dark:text-violet-300">{focus.eyebrow}</p>
            <EadwynButton label={overview} />
          </div>
          <h2 id="phone-focus-title" className="m-0 mt-2 text-[29px] font-black leading-[1.15] tracking-[-.032em] text-gray-900 [text-wrap:balance] dark:text-gray-100">{focus.headline}</h2>
          {focus.why && <p className="m-0 mt-3 text-[14.5px] leading-[1.6] text-gray-600 dark:text-gray-400" data-testid="phone-focus-why">{focus.why}</p>}
          {meter && (
            <Meter meter={meter}>
              {cycle === 'validate' && projectId != null && !editing && (
                <button type="button" onClick={() => setEditing(true)} data-testid="phone-target-open"
                  className="mt-2 text-[12px] font-semibold text-violet-700 underline dark:text-violet-300">{meter.target == null ? 'Set a target' : 'Change the target'}</button>
              )}
              {cycle === 'validate' && projectId != null && editing && (
                <TargetForm projectId={projectId} current={meter.target} api={api} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged?.(); }} />
              )}
            </Meter>
          )}
          <Link to={focus.href}
            onClick={opensAction ? (e) => { if (plainTap(e)) { e.preventDefault(); openAction(); } } : undefined}
            className="mt-6 flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-violet-700 px-4 text-[15px] font-bold text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500"
            data-testid="phone-focus-cta">{focus.cta}</Link>
          {then && (
            <div className="mt-[26px] border-t border-[#f0eff3] pt-[18px] dark:border-gray-800" data-testid="phone-focus-then">
              <p className="m-0 text-[10px] font-extrabold uppercase tracking-[.12em] text-gray-700 dark:text-gray-300">Then</p>
              <p className="m-0 mt-1 text-[13px] leading-[1.5] text-gray-900 dark:text-gray-100">{then}</p>
            </div>
          )}
        </section>
      )}
      {/* PhoneRows draws its own 22px gutter; the body already has one. */}
      <div className={`-mx-[22px] ${focus ? 'mt-[26px]' : ''}`.trim()}>
        <PhoneRows groups={groups} />
      </div>
    </div>
  );
}
