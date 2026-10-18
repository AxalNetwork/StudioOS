import { Pill, Unrecorded, Unreadable } from '../../../ui';
import { LoadingRows } from '../../account/AccountCenter';
import { Group, Row } from '../../account/ConnectorSheet';
import { ending, money } from './fundAdminModel';

/**
 * Decision 9's overview: one block per store, each with its own state, so one
 * failed store blanks only its own group. The read is audited before it
 * answers; a 503 means nothing was read.
 */
const amount = (cents) => money(cents) ?? <Unrecorded />;

function BlockUnreadable({ what, claim, onRetry, testId }) {
  return <div className="px-3 py-2" data-testid={testId}><Unreadable what={what} claim={claim} onRetry={onRetry} /></div>;
}

export function OverviewTab({ overview }) {
  if (overview.status === 'loading' || overview.status === 'idle') return <div className="mx-5 mt-4"><LoadingRows lines={5} /></div>;
  if (overview.status === 'unreadable') {
    const audit = overview.error?.status === 503;
    return (
      <div className="mx-5 mt-4" data-testid="overview-unreadable">
        <Unreadable what="The fund administration overview"
          claim={audit ? 'Nothing was read, because its audit row could not be written.' : 'This is not a claim that there is nothing to administer.'}
          onRetry={overview.reload} />
      </div>
    );
  }
  const o = overview.data || {};
  const fundName = new Map((o.funds?.items || []).map((f) => [Number(f.fund_id), f.name || `Fund #${f.fund_id}`]));
  const nameOf = (id) => fundName.get(Number(id)) || `Fund #${id}`;
  const entityName = new Map((o.entities?.items || []).map((e) => [e.entity_key, e.name]));

  return (
    <div data-testid="overview">
      <Group label="Axal entities">
        {o.entities?.state !== 'ok'
          ? <BlockUnreadable testId="overview-entities-unreadable" what="The entity connections" claim="This is not a claim that none is connected." onRetry={overview.reload} />
          : o.entities.items.map((e) => (
            <div key={e.entity_key} data-testid={`overview-entity-${e.entity_key}`}>
              <Row a={e.name}
                b={e.connection
                  ? `${e.connection.org_name || 'Organization not recorded'} · ${e.connection.last_synced_at ? `last synced ${e.connection.last_synced_at}` : 'not synced yet'}`
                  : <Unrecorded reason={e.reason}>{e.reason || 'Not recorded'}</Unrecorded>}
                pill={e.connection ? <Pill>{e.connection.status}</Pill> : null} />
              {e.connection?.last_error && <Row a="Last error" b={String(e.connection.last_error)} tone="danger" />}
              {e.connection && e.accounts.length === 0 && <Row a="Accounts" b={<Unrecorded reason={e.reason}>{e.reason || 'No bank account yet'}</Unrecorded>} />}
              {e.accounts.map((a) => (
                <Row key={a.uid} a={`${a.nickname || a.kind} · ${ending(a.ending)}`}
                  b={<>Current {amount(a.current_cents)} · Available {amount(a.available_cents)}{a.balance_read_at ? ` · read ${a.balance_read_at}` : ''}</>} />
              ))}
            </div>
          ))}
      </Group>

      <Group label="Administered funds">
        {o.funds?.state !== 'ok'
          ? <BlockUnreadable testId="overview-funds-unreadable" what="The administered funds" claim="This is not a claim that there is none." onRetry={overview.reload} />
          : o.funds.items.length === 0
            ? <Row a="No administered fund" b="A fund whose general partner of record is an outside GP is run from its own fund page." />
            : o.funds.items.map((f) => (
              <div key={f.fund_id} data-testid={`overview-fund-${f.fund_id}`}>
                <Row a={f.name}
                  b={<>Committed {amount(f.committed_cents)} · Called {amount(f.called_cents)} · Received {amount(f.received_cents)} · Outstanding {amount(f.outstanding_cents)}</>}
                  pill={f.overdue_lines > 0 ? <Pill tone="warn">{f.overdue_lines} overdue</Pill> : null} />
                <Row a="Next due" b={f.next_due_date || <Unrecorded>No line due</Unrecorded>} />
              </div>
            ))}
      </Group>

      <Group label="Management fees">
        {o.fees?.state !== 'ok'
          ? <BlockUnreadable testId="overview-fees-unreadable" what="The fee periods" claim="This is not a claim that no fee is due." onRetry={overview.reload} />
          : o.fees.items.map((p) => (
            <Row key={p.fund_id} a={nameOf(p.fund_id)}
              b={p.state === 'ok' ? <>{p.quarter} · {p.status} · net {amount(p.net_cents)}</> : <Unrecorded reason={p.reason}>{p.reason || 'Not recorded'}</Unrecorded>} />
          ))}
      </Group>

      <Group label="Report drafts awaiting review">
        {o.drafts?.state !== 'ok'
          ? <BlockUnreadable testId="overview-drafts-unreadable" what="The reporting queue" claim="This is not a claim that nothing waits for review." onRetry={overview.reload} />
          : o.drafts.items.map((d) => (
            <Row key={d.fund_id != null ? `f${d.fund_id}` : `e${d.entity_key}`}
              a={d.fund_id != null ? nameOf(d.fund_id) : (entityName.get(d.entity_key) || d.entity_key)}
              b={`${d.draft} draft · ${d.prepared} prepared`} />
          ))}
      </Group>

      <Group label="Bank matches to review">
        {o.matches?.state !== 'ok'
          ? <BlockUnreadable testId="overview-matches-unreadable" what="The bank matches" claim="This is not a claim that none waits." onRetry={overview.reload} />
          : o.matches.items.map((m) => (
            <Row key={m.fund_id} a={nameOf(m.fund_id)} b={`${m.proposed} proposed · ${m.needs_review} need review`} />
          ))}
      </Group>
    </div>
  );
}
