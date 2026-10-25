import { Pill, Unrecorded, Unreadable } from '../../../ui';
import { BTN, LoadingRows } from '../../account/AccountCenter';
import { entityErrorWords, entityState } from './mercuryEntityModel';
import { ending, money } from './fundAdminModel';
import { Line, NUM, Note, Panel, Section, TH, Table } from './parts';

/**
 * Decision 9's overview, laid out to the brief's Overview board: one card per
 * Axal entity (its Mercury state, last sync and error, each account as
 * "Checking · ending 4821" with its balance and read time), then one table of
 * the administered funds with each fund's calls, latest fee period, drafts
 * awaiting review and proposed matches.
 *
 * Each block keeps its own state, so one failed store blanks only its own
 * part: its column reads Unreadable and its notice offers Retry. The read is
 * audited before it answers; a 503 means nothing was read.
 */
const amount = (cents) => money(cents) ?? <Unrecorded />;
const KIND = { checking: 'Checking', savings: 'Savings' };
const kindOf = (a) => KIND[a.kind] || 'Account';

function BlockUnreadable({ what, claim, onRetry, testId }) {
  return <div className="px-4 py-3 sm:px-5" data-testid={testId}><Unreadable what={what} claim={claim} onRetry={onRetry} /></div>;
}

function EntityCard({ e }) {
  const state = entityState(e.connection);
  const error = e.connection ? entityErrorWords(e.connection.last_error) : null;
  return (
    <div className="overflow-hidden rounded-axal-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" data-testid={`overview-entity-${e.entity_key}`}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 sm:px-5">
        <div className="min-w-0">
          <div className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">{e.name}</div>
          <div className="mt-0.5 text-[11px] text-axal-muted dark:text-gray-400">
            {e.connection
              ? `${e.connection.org_name || 'Organization not recorded'} · ${e.connection.last_synced_at ? `last synced ${e.connection.last_synced_at}` : 'not synced yet'}`
              : <Unrecorded reason={e.reason}>{e.reason || 'Not recorded'}</Unrecorded>}
          </div>
        </div>
        <Pill tone={state.tone}>{state.text}</Pill>
      </div>
      {error && <p className="mx-4 mt-2 text-[11.5px] text-red-700 sm:mx-5 dark:text-red-300" data-testid={`overview-entity-error-${e.entity_key}`}>{error}</p>}
      <div className="mt-3 border-t border-axal-hairline dark:border-gray-800">
        {e.accounts.length === 0
          ? <Note testId={`overview-entity-no-account-${e.entity_key}`}>{e.connection ? <Unrecorded reason={e.reason}>{e.reason || 'No bank account yet'}</Unrecorded> : 'No bank account yet'}</Note>
          : e.accounts.map((a) => (
            <Line key={a.uid} a={`${kindOf(a)} · ${ending(a.ending)}${a.nickname ? ` · ${a.nickname}` : ''}`}
              b={<>Available {amount(a.available_cents)}{a.balance_read_at ? ` · read ${a.balance_read_at}` : ''}</>}
              figure={amount(a.current_cents)} />
          ))}
      </div>
    </div>
  );
}

const blockOk = (b) => b?.state === 'ok' && Array.isArray(b.items);

export function OverviewTab({ overview, onOpen }) {
  if (overview.status === 'loading' || overview.status === 'idle') return <div className="mx-4 mt-5 sm:mx-6"><LoadingRows lines={5} /></div>;
  if (overview.status === 'unreadable') {
    const audit = overview.error?.status === 503;
    return (
      <div className="mx-4 mt-5 sm:mx-6" data-testid="overview-unreadable">
        <Unreadable what="The fund administration overview"
          claim={audit ? 'Nothing was read, because its audit row could not be written.' : 'This is not a claim that there is nothing to administer.'}
          onRetry={overview.reload} />
      </div>
    );
  }
  const o = overview.data || {};
  const byFund = (block) => new Map((blockOk(block) ? block.items : []).filter((x) => x.fund_id != null).map((x) => [Number(x.fund_id), x]));
  const fees = byFund(o.fees);
  const drafts = byFund(o.drafts);
  const matches = byFund(o.matches);
  const entityDrafts = blockOk(o.drafts) ? o.drafts.items.filter((d) => d.fund_id == null) : [];
  const entityName = new Map((blockOk(o.entities) ? o.entities.items : []).map((e) => [e.entity_key, e.name]));
  const unread = <span className="text-axal-muted dark:text-gray-400">Unreadable</span>;
  const cols = [
    { key: 'fund', label: 'Fund', cell: (f) => (onOpen
      ? <button type="button" className="text-left font-bold text-axal-violet-deep hover:underline dark:text-violet-300" onClick={() => onOpen({ tab: 'calls', fund: f.fund_id })} data-testid={`overview-open-${f.fund_id}`}>{f.name}</button>
      : f.name) },
    { key: 'committed', label: 'Committed', align: 'right', mono: true, cell: (f) => amount(f.committed_cents) },
    { key: 'called', label: 'Called', align: 'right', mono: true, cell: (f) => amount(f.called_cents) },
    { key: 'received', label: 'Received', align: 'right', mono: true, cell: (f) => amount(f.received_cents) },
    { key: 'outstanding', label: 'Outstanding', align: 'right', mono: true, cell: (f) => (
      <>{amount(f.outstanding_cents)}{f.overdue_lines > 0 && <> <Pill tone="warn">{f.overdue_lines} overdue</Pill></>}</>) },
    { key: 'due', label: 'Next due', mono: true, cell: (f) => f.next_due_date || <Unrecorded>No line due</Unrecorded> },
    { key: 'fee', label: 'Latest fee period', cell: (f) => {
      if (!blockOk(o.fees)) return unread;
      const p = fees.get(Number(f.fund_id));
      return p?.state === 'ok' ? <span className={NUM}>{p.quarter} · {p.status} · net {amount(p.net_cents)}</span> : <Unrecorded reason={p?.reason}>{p?.reason || 'Not recorded'}</Unrecorded>;
    } },
    { key: 'drafts', label: 'Awaiting review', cell: (f) => {
      if (!blockOk(o.drafts)) return unread;
      const d = drafts.get(Number(f.fund_id));
      return d ? `${d.draft} draft · ${d.prepared} prepared` : 'None';
    } },
    { key: 'matches', label: 'Proposed matches', cell: (f) => {
      if (!blockOk(o.matches)) return unread;
      const m = matches.get(Number(f.fund_id));
      return m ? `${m.proposed} proposed · ${m.needs_review} need review` : 'None';
    } },
  ];

  return (
    <Section title="Overview" sub={`Each Axal entity's bank connection and balances, then what each administered fund has called, received and still owes${o.as_of ? `, as of ${o.as_of}` : ''}.`} testId="overview">
      <div>
        <div className={`${TH} mb-2.5`}>Axal entities</div>
        {!blockOk(o.entities)
          ? <div className="rounded-axal-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900"><BlockUnreadable testId="overview-entities-unreadable" what="The entity connections" claim="This is not a claim that none is connected." onRetry={overview.reload} /></div>
          : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{o.entities.items.map((e) => <EntityCard key={e.entity_key} e={e} />)}</div>}
      </div>

      <Panel label="Administered funds" testId="overview-funds">
        {!blockOk(o.funds)
          ? <BlockUnreadable testId="overview-funds-unreadable" what="The administered funds" claim="This is not a claim that there is none." onRetry={overview.reload} />
          : o.funds.items.length === 0
            ? <Note testId="overview-no-fund">No administered fund. A fund whose general partner of record is an outside GP is run from its own fund page.</Note>
            : <Table cols={cols} rows={o.funds.items} rowKey={(f) => f.fund_id} wide
              template="1.5fr 1fr 1fr 1fr 1.2fr .9fr 1.5fr 1.1fr 1.2fr" rowTestId={(f) => `overview-fund-${f.fund_id}`} />}
        {blockOk(o.funds) && !blockOk(o.fees) && <BlockUnreadable testId="overview-fees-unreadable" what="The fee periods" claim="This is not a claim that no fee is due." onRetry={overview.reload} />}
        {blockOk(o.funds) && !blockOk(o.drafts) && <BlockUnreadable testId="overview-drafts-unreadable" what="The reporting queue" claim="This is not a claim that nothing waits for review." onRetry={overview.reload} />}
        {blockOk(o.funds) && !blockOk(o.matches) && <BlockUnreadable testId="overview-matches-unreadable" what="The bank matches" claim="This is not a claim that none waits." onRetry={overview.reload} />}
      </Panel>

      {entityDrafts.length > 0 && (
        <Panel label="Entity reports awaiting review" testId="overview-entity-drafts">
          {entityDrafts.map((d) => (
            <Line key={`e${d.entity_key}`} a={entityName.get(d.entity_key) || d.entity_key} b={`${d.draft} draft · ${d.prepared} prepared`}
              action={onOpen ? <button type="button" className={BTN.link} onClick={() => onOpen({ tab: 'reports' })}>Open Reports</button> : null} />
          ))}
        </Panel>
      )}
    </Section>
  );
}
