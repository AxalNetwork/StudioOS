/**
 * #4017 (#3710 IV-D3, D1454 §1 Q2 A): a record's Email opens the composer in
 * the shared right Sheet (D1317) over the record, in place of leaving for
 * `/email`. The URL stays on the record. `/email?person=…&compose=1` still
 * composes as a deep link (`EmailPage`).
 *
 * It reads what `/email` reads for one person: the mailboxes, the shares and
 * the person's pack. The address is `recipientFor`'s (D1344): a member's only
 * once they share it, and never another member's or a participant's. A
 * member who has not shared an address cannot be written to from here
 * either, and the Sheet says so instead of composing.
 */
import { useCallback, useEffect, useState } from 'react';
import Sheet from '../../ui/Sheet';
import { mailApi } from '../../lib/api/mail.js';
import ComposeSheet from './ComposeSheet.jsx';
import { recipientFor, sendingAccount } from './emailModel.js';
import { BODY, MUTED } from './emailParts.jsx';

export const READING = 'Reading their records…';
export const UNREADABLE = 'Unreadable: this person’s records could not be read. Close and try again.';
export const NOT_SHARED = 'This member has not shared an email address yet. You can write once they do.';

export default function RecordEmailSheet({ person, from = null, onClose, api = mailApi }) {
  const [state, setState] = useState({ status: 'reading' });
  const load = useCallback(() => {
    setState({ status: 'reading' });
    Promise.all([api.accounts(), api.shares().catch(() => ({ items: [] })), api.context(person.ref)])
      .then(([a, s, pack]) => setState({ status: 'ready', accounts: a?.accounts ?? [], shares: s?.items ?? [], pack }))
      .catch(() => setState({ status: 'unreadable' }));
  }, [api, person.ref]);
  useEffect(load, [load]);

  if (state.status !== 'ready') {
    return <Sheet title="Email" eyebrow="Email" sub={`Email to ${person.name}`} onClose={onClose} width={560} testId="record-email-sheet">
      <p className={state.status === 'unreadable' ? BODY : MUTED} role={state.status === 'unreadable' ? 'alert' : 'status'} data-testid="record-email-state">
        {state.status === 'unreadable' ? UNREADABLE : READING}
      </p>
    </Sheet>;
  }
  const { pack, shares, accounts } = state;
  const who = pack.person;
  const share = who.kind === 'member' ? shares.find((s) => s.person === who.ref) ?? null : null;
  if (who.kind === 'member' && !share?.ready) {
    return <Sheet title="Email" eyebrow="Email" sub={`Email to ${who.name}`} onClose={onClose} width={560} testId="record-email-sheet">
      <p className={BODY} data-testid="record-email-state">{NOT_SHARED}</p>
    </Sheet>;
  }
  // As `/email` starts: the records the pack selects.
  const refs = (pack.items ?? []).filter((i) => i.selected).map((i) => i.ref);
  return <ComposeSheet pack={pack} refs={refs} to={recipientFor(who, shares)} account={sendingAccount(accounts)} from={from} api={api}
    onClose={onClose} onSent={onClose} />;
}
