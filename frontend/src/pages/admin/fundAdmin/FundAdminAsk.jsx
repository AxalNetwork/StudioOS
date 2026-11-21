/** D6397 (#6397): five recorded Fund Admin answers inside today's shared Ask panel. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { pageKeyFor } from '../../../lib/railPages.js';
import { useRailPage } from '../../../ui/railCrumbs.js';
import { shellRoleFor, readHqView } from '../../../lib/shellRole.js';
import { FUND_ADMIN_ASK_CHIPS } from '../../../lib/railOptions/admin.js';
import { useRegisterAskPageBody } from '../../../ui/askPageBody.js';

const NOTE = 'Eadwyn prepares, explains and navigates. It never issues, records or moves money.';
const safeAnswer = (value, prompt) => value?.prompt === prompt && value.no_model === true
  && ['ok', 'not_recorded', 'unreadable'].includes(value.state)
  && (value.as_of === null || typeof value.as_of === 'string')
  && Array.isArray(value.lines) && value.lines.every(line => typeof line === 'string')
  && typeof value.navigation?.label === 'string'
  && /^\/admin\/fund-admin(?:\/|\?|$)/.test(value.navigation?.to || '');

export function FundAdminAskAnswers({ api, fundId, scopeLabel, onNavigate, onClose }) {
  const [reply, setReply] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const firstPrompt = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    firstPrompt.current?.focus?.();
    return () => {
      generation.current++;
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus?.();
    };
  }, []);
  const read = async prompt => {
    const current = ++generation.current;
    setSelected(prompt); setReply(null); setBusy(true);
    let answer;
    try { answer = await api.answer(prompt, fundId); }
    catch (error) { answer = error?.data; }
    if (current !== generation.current) return;
    if (!safeAnswer(answer, prompt)) answer = {
      prompt, state: 'unreadable', as_of: null,
      lines: ['! Unreadable · Retry. The recorded answer could not be read. This is not a zero.'],
      navigation: { to: '/admin/fund-admin' + (fundId == null ? '' : `?fund=${fundId}`), label: 'Open Fund Admin' },
    };
    setReply(answer); setBusy(false);
  };
  const navigate = event => {
    if (onNavigate) { event.preventDefault(); onNavigate(reply.navigation.to); }
    onClose?.('route');
  };
  return <section className="flex flex-col gap-3" aria-label="Fund Admin recorded answers" data-testid="fund-admin-ask">
    <p className="ead-ask-eyebrow m-0">{scopeLabel}</p>
    <div className="ead-ask-chips">
      <span className="ead-ask-eyebrow">Suggested for this page</span>
      <div className="ead-ask-chip-row">
        {FUND_ADMIN_ASK_CHIPS.map(chip => <button key={chip.key} ref={chip.key === FUND_ADMIN_ASK_CHIPS[0].key ? firstPrompt : null} type="button" className="ead-ask-chip" style={{ minHeight: 44, whiteSpace: 'normal', textAlign: 'left' }}
          disabled={busy} onClick={() => read(chip.key)} data-testid={`ask-chip-${chip.key}`}>{chip.label}</button>)}
      </div>
    </div>
    {busy && <p role="status">Reading recorded data…</p>}
    {reply && <div className="ead-ask-said" role="status" data-testid="fund-admin-ask-answer" data-state={reply.state}>
      <b>{FUND_ADMIN_ASK_CHIPS.find(chip => chip.key === selected)?.label}</b>
      <p className="ead-ask-mono">As of {reply.as_of || '— Not recorded'}</p>
      {reply.lines.map((line, index) => <p key={index}>{line}</p>)}
      {reply.state === 'unreadable' && <button type="button" className="ead-ask-btn" style={{ minHeight: 44 }} onClick={() => read(selected)}>Retry</button>}
      <a className="ead-ask-btn" style={{ minHeight: 44 }} href={reply.navigation.to} onClick={navigate} data-testid="fund-admin-ask-open">{reply.navigation.label}</a>
    </div>}
    <p className="ead-ask-foot m-0">{NOTE}</p>
  </section>;
}

/** The console provides its actual scope; no second panel or page-data cache. */
export default function FundAdminAsk({ user, api, fundId, scopeLabel }) {
  const location = useLocation();
  const rail = useRailPage();
  const page = rail?.page ?? pageKeyFor(location.pathname, shellRoleFor(user?.role, user, readHqView()));
  const body = useMemo(() => ({
    scope: String(fundId ?? 'all'),
    render: props => <FundAdminAskAnswers {...props} api={api} fundId={fundId} scopeLabel={scopeLabel} />,
  }), [api, fundId, scopeLabel]);
  useRegisterAskPageBody(page, body);
  return null;
}
