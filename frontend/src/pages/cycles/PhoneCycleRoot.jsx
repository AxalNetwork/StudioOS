import React from 'react';
import { Link } from 'react-router-dom';
import { cycleValidateApi } from '../../lib/api/cycleValidate';
import { alsoInFor } from '../../lib/adminPlacement.js';
import { EadwynButton, PhoneRows, Unreadable } from '../../ui';
import CycleMeter from './CycleMeter';
import { CYCLE_NAMES, ROOT_ACTION_PATHS, phoneFocus, phoneIndex, rootMeter, thenText } from './validatePhone';

/**
 * A cycle's phone root, One Next Thing (D703, #1665): COM over CO:26-27 and
 * CO:278-282. The eyebrow with the page's Eadwyn button, the headline, the
 * why, the meter where the read sends one, a 52px CTA, "Then" once, then
 * "Everything else in <Cycle>" and, where the cycle has any, "Also in
 * <Cycle>". It draws the Worker's `focus`, `meter` and `index` as sent
 * (`validatePhone.js`); only Validate's rule-1 focus, meter fallback and
 * "Set a target" are cycle-specific.
 *
 * #5999: the meter and "Set a target" are `CycleMeter.jsx`, shared with the
 * desktop Validate lead row, and the meter is `rootMeter`, the one both widths draw.
 * "Set a target" is drawn only where the read says `can_write` (the owner's option B).
 *
 * `CycleRoute` draws it below 1024px on a cycle's root, in place of the
 * overview and `AlsoIn` (#1665's PR 1b); the desktop page draws neither.
 */

/** A plain tap on the cycle's own action route opens it through `openAction`, as the desktop button does. */
const plainTap = (e) => !e.defaultPrevented && (e.button ?? 0) === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export default function PhoneCycleRoot({ cycle, raw, status = raw ? 'ready' : 'loading', search = '', projectId = null, api = cycleValidateApi, openAction, onChanged, onRetry, message = '' }) {
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
  // D1466 (#3714, RO15): a read refused on purpose is the Worker's sentence, muted, never red.
  if (status === 'refused') {
    return (
      <div data-testid="phone-root" data-cycle={cycle}>
        <p role="status" className="m-0 text-[14px] font-semibold text-axal-ink dark:text-gray-100" data-testid="phone-root-refused">{message || `You cannot open this venture’s ${name}.`}</p>
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
  // Validate draws no meter under its first-conversation focus, as drawn, nor
  // (D4589) under a Stop or a step that could not be worked out (`rootMeter`, both widths).
  const meter = rootMeter(raw, focus, cycle);
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
          <CycleMeter meter={meter} cycle={cycle} canWrite={raw.can_write === true} projectId={projectId} api={api} onChanged={onChanged} />
          {/* D4589: a step that could not be worked out has no primary action, only its secondary ones. */}
          {focus.href && (
            <Link to={focus.href}
              onClick={opensAction ? (e) => { if (plainTap(e)) { e.preventDefault(); openAction(); } } : undefined}
              className="mt-6 flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-violet-700 px-4 text-[15px] font-bold text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500"
              data-testid="phone-focus-cta">{focus.cta}</Link>
          )}
          {focus.secondary?.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-2" data-testid="phone-focus-secondary">
              {focus.secondary.map((s) => {
                const opens = !!(openAction && actionHref && s.href.split(/[?#]/)[0] === actionHref);
                return (
                  <Link key={s.href} to={s.href} onClick={opens ? (e) => { if (plainTap(e)) { e.preventDefault(); openAction(); } } : undefined}
                    className="inline-flex min-h-[44px] items-center text-[13.5px] font-semibold text-violet-700 underline dark:text-violet-300">{s.label}</Link>
                );
              })}
            </div>
          )}
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
