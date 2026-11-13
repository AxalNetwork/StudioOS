/** #4862: approved GR-01/02/13/16 focus, attention and compact domains on desktop and phone. */
import { Link } from 'react-router-dom';
import { CycleHeader, FigureTile } from './CycleOverview';
import { isPlainClick } from './cycleModel';
import { metricLabel, readTarget } from '../../lib/metricTargets';
import { GROW_AREAS, focusValue, growPrimary, signalCount, growPeriod } from './growOverviewModel';
import { projectSearch } from './founderToolNavigation';
import HeaderAsk from '../../ui/HeaderAsk';
import { Unreadable } from '../../ui';

const CARD = 'min-w-0 rounded-[12px] border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const MUTED = 'text-[12px] leading-relaxed text-axal-muted dark:text-gray-400';
const BUTTON = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-axal-hairline px-3 py-2 text-[12px] font-bold text-axal-violet-deep hover:bg-axal-ground dark:border-gray-700 dark:text-violet-300 dark:hover:bg-gray-800';
const PRIMARY = 'bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500';
const H2 = 'm-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100';

function Focus({ attention, primary }) {
  const focus = attention?.focus;
  const record = focus?.state === 'recorded' ? focus.value : null;
  const measurement = attention?.measurement;
  const measured = measurement?.state === 'recorded' ? measurement.value : null;
  const comparison = record && measured ? readTarget(record, { [record.metric_key]: measured.value }) : null;
  return (
    <section className={`${CARD} grid gap-3 rounded-[14px] ${record ? '' : 'border-dashed'} sm:grid-cols-[minmax(0,1fr)_auto]`} aria-labelledby="grow-focus-title" data-testid="grow-overview-focus">
      <div><span className="font-mono text-[10px] font-bold uppercase tracking-wide text-axal-muted dark:text-gray-400">This month’s focus</span>
        <h2 id="grow-focus-title" className={`${H2} mt-1 text-[17px]`}>{record ? `${record.label || metricLabel(record.metric_key)} · target ${focusValue(record.target_value, record.metric_key)}` : focus?.state === 'not_recorded' ? 'No primary growth metric selected' : 'Focus could not be read'}</h2>
        <p className={`mb-0 mt-1 ${MUTED}`}>{record ? `Target last set: ${record.updated_at || 'Not recorded'}` : focus?.state === 'not_recorded' ? 'Choose the one number you’re trying to move this month.' : 'Check the source before deciding what is missing.'}</p>
      </div>
      {record ? <div className="flex flex-col justify-center gap-1 sm:text-right"><b className="font-mono text-[18px]">{measured ? focusValue(measured.value, record.metric_key) : measurement?.state === 'unreadable' ? 'Unreadable' : 'No value recorded'}</b>
        <span className={MUTED}>{comparison ? comparison.met ? 'Target met' : record.direction === 'down' ? 'Above target' : 'Below target' : 'No comparison available'}</span>
        {measured ? <span className={MUTED}>Source: {measured.source || 'Not recorded'} · as of {measured.as_of}</span> : null}</div>
        : primary ? <Link className={`${BUTTON} ${PRIMARY}`} to={primary.href}>{primary.label}</Link> : null}
    </section>
  );
}

function Attention({ attention, onRetry, readOnly }) {
  const items = readOnly ? [] : attention?.items || [];
  return (
    <section className={CARD} aria-labelledby="grow-attention-title" data-testid="grow-attention">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="grow-attention-title" className={H2}>Needs your attention</h2><span className={MUTED}>{items.length ? `${items.length} · highest value first` : 'From the available records'}</span></div>
      {!attention || attention.state !== 'ready' ? <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="grow-attention-partial"><span className={MUTED}>Some growth signals could not be read. Missing values are not treated as empty records.</span><button type="button" className={BUTTON} onClick={onRetry}>Try again</button></div> : null}
      <ol className="m-0 mt-2 list-none p-0">{items.map((item, i) => (
        <li key={item.key} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-axal-hairline py-3 first:border-0 sm:grid-cols-[24px_minmax(0,1fr)_auto] dark:border-gray-700" data-testid={`grow-attention-${item.key}`}>
          <span className={`flex h-6 w-6 items-center justify-center rounded-[7px] text-[11px] font-bold ${i === 0 ? 'bg-axal-violet text-white dark:bg-violet-600' : 'bg-axal-ground text-axal-muted dark:bg-gray-800 dark:text-gray-400'}`} aria-hidden="true">{i + 1}</span>
          <div><b className="text-[13px]">{item.label}</b><p className={`mb-0 mt-0.5 ${MUTED}`}>{item.why}</p>{item.area ? <span className={MUTED}>{item.area}</span> : null}</div>
          <Link to={item.href} className={`${BUTTON} col-start-2 justify-self-start sm:col-start-auto sm:justify-self-end self-center ${i === 0 ? PRIMARY : ''}`}>{item.actionLabel || `Open ${item.area || 'Focus'}`}</Link>
        </li>
      ))}</ol>
      {!items.length ? <p className={`mb-0 mt-3 ${MUTED}`}>{readOnly ? 'Read only · operating actions are available to the venture’s writers.' : 'No action was identified from the records that were read. Open Focus to review growth.'}</p> : null}
    </section>
  );
}

function Setup({ attention, search }) {
  const signals = attention?.signals || {};
  const facts = [
    ['Choose primary growth metric', attention?.focus?.state === 'recorded' ? true : attention?.focus?.state === 'not_recorded' ? false : null, '/grow/focus'],
    ['Set growth target', signalCount(signals.targets) == null ? null : signals.targets.value > 0, '/grow/focus'],
    ['Record the first KPI', signalCount(signals.kpis) == null ? null : signals.kpis.value > 0, '/grow/focus'],
    ['Add acquisition channel', signalCount(signals.channels) == null ? null : signals.channels.value > 0, '/grow/distribution'],
    ['Add customer or prospect records', signalCount(signals.customers) == null ? null : signals.customers.value > 0, '/grow/customers'],
  ];
  const known = facts.filter(([, done]) => done !== null).length;
  return <section className={CARD} aria-labelledby="grow-setup-title" data-testid="grow-setup"><h2 id="grow-setup-title" className={H2}>Growth setup</h2><p className={`mb-0 mt-1 ${MUTED}`}>{known ? `${facts.filter(([, done]) => done === true).length} recorded · ${known} of ${facts.length} checks answered` : 'Setup could not be read'}</p>
    <ul className="m-0 mt-2 list-none p-0">{facts.map(([label, done, path]) => <li key={label} className="flex items-center justify-between gap-3 border-t border-axal-hairline py-2 text-[12px] first:border-0 dark:border-gray-700"><span>{label}</span>{done === true ? <span>Done</span> : done === null ? <span className={MUTED}>Unreadable</span> : <Link className={BUTTON} to={path + projectSearch(search)}>Open</Link>}</li>)}</ul>
    <p className={`mb-0 mt-2 ${MUTED}`}>Each step is a fact from the venture’s records. Manage connected sources in <Link className="underline" to="/account/connectors">Connections</Link>.</p></section>;
}

export default function GrowOverview({ raw, data, status, search, action, onRetry, readOnly = false, message = '', more = null }) {
  const attention = status === 'ready' ? raw?.attention : null;
  const locked = readOnly || data?.read_only === true || attention?.writable === false;
  const primary = growPrimary(attention, status, locked);
  const sparse = attention?.focus?.state !== 'recorded' || attention?.measurement?.state !== 'recorded';
  const figures = data?.figures || [];
  const cards = data?.cards || [];
  const secondary = <div className="flex flex-wrap items-center gap-2">{growPeriod(attention?.period) ? <span className={MUTED}>Period: {growPeriod(attention.period)}</span> : null}
    {!locked && action?.href ? <Link to={action.href} className={BUTTON} aria-haspopup={action.onOpen ? 'dialog' : undefined} onClick={action.onOpen ? (e) => { if (isPlainClick(e)) { e.preventDefault(); action.onOpen(); } } : undefined}>Share an update</Link> : null}{!locked ? more : null}{!locked ? <HeaderAsk /> : null}</div>;
  const snapshot = <section aria-labelledby="grow-snapshot-title" data-testid="grow-snapshot"><h2 id="grow-snapshot-title" className={`${H2} mb-3`}>Growth snapshot</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{figures.map((f) => <FigureTile key={f.key} fig={f} details={<span className="mt-1 font-mono text-[10px] leading-relaxed text-axal-muted dark:text-gray-400">Source: {f.source || 'Not recorded'} · as of {f.as_of || 'Not recorded'}</span>} />)}</div></section>;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="grow-overview-v2">
      <CycleHeader cycle="grow" cards={cards} action={primary} more={secondary} search={search} sub="How does this venture become larger and more enduring?" />
      {status === 'loading' ? <div aria-busy="true" aria-label="Loading Grow overview" className="h-60 animate-pulse rounded-[14px] bg-axal-ground dark:bg-gray-800" data-testid="grow-overview-loading" />
        : status === 'refused' ? <p className={CARD} role="status">{message || 'You cannot open this venture’s Grow records.'}</p>
        : status !== 'ready' ? <div className={CARD} data-testid="grow-overview-error"><Unreadable what="The Grow overview" claim="The records could not be read. This is not a claim that nothing is recorded." onRetry={onRetry} /></div>
          : <div className="flex flex-col gap-4">
            {locked ? <p className={MUTED} role="status">Read only · you can inspect this venture’s Grow records.</p> : null}
            <div className={sparse ? 'hidden lg:block' : ''}><Focus attention={attention} primary={primary} /></div>
            <div className="order-1 lg:order-2"><Attention attention={attention} onRetry={onRetry} readOnly={locked} /></div>
            {sparse && !locked ? <div className="order-2"><Setup attention={attention} search={search} /></div> : null}
            <div className={sparse ? 'order-3' : 'order-3 lg:order-1'}>{snapshot}</div>
            <section className="order-4" aria-labelledby="grow-domains-title"><h2 id="grow-domains-title" className={`${H2} mb-3`}>What is happening</h2>
              <div className="grid overflow-hidden rounded-[12px] border border-axal-hairline bg-white sm:grid-cols-2 xl:grid-cols-4 dark:border-gray-700 dark:bg-gray-900" data-testid="grow-domains">{GROW_AREAS.filter((a) => a.key).map((area) => {
                const card = cards.find((c) => c.slug === area.key || area.aliases.includes(c.slug));
                const count = area.key === 'customers' ? signalCount(attention?.signals?.customers) : area.key === 'distribution' ? signalCount(attention?.signals?.channels) : null;
                const summary = area.key === 'customers' ? (count == null ? 'Customer records could not be read' : `${count} customer/prospect record${count === 1 ? '' : 's'}`) : area.key === 'distribution' ? (count == null ? 'Channel records could not be read' : `${count} acquisition channel${count === 1 ? '' : 's'}`) : area.key === 'focus' ? (attention?.focus?.state === 'recorded' ? 'Focus metric and target recorded' : attention?.focus?.state === 'not_recorded' ? 'Choose the focus metric' : 'Focus could not be read') : card?.state === 'unreadable' ? 'Could not be read' : card?.caption || 'Open the workspace to review its records.';
                return <Link key={area.key} to={area.path + projectSearch(search)} className="flex min-w-0 flex-col gap-1 border-b border-axal-hairline p-3 last:border-0 sm:border-r dark:border-gray-700"><b className="text-[13px]">{area.name}</b><span className={MUTED}>{summary}</span></Link>;
              })}</div>
              <div className="mt-3 flex flex-wrap gap-4 text-[12px] font-bold"><Link to={'/grow/product-improvement' + projectSearch(search)}>Customers · Feedback</Link><Link to={'/grow/launch' + projectSearch(search)}>Distribution · Launch calendar</Link><Link to={'/build/brand' + projectSearch(search)}>Company · Brand</Link></div>
            </section>
          </div>}
    </div>
  );
}
