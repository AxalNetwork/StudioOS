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
 *
 * #4017 items 2 and 3: the Sheet is `RecordCompose`. Its Body carries Ask's
 * field trigger while blank; the draft arrives as a form intent in the Ask
 * panel, and Accept places it "Not saved" until Send. `readOnly` (a reader:
 * the narrative's admin, a support session) never sees the trigger or Send.
 */
import { useCallback, useEffect, useState } from 'react';
import Sheet from '../../ui/Sheet';
import { mailApi } from '../../lib/api/mail.js';
import RecordCompose from './RecordCompose.jsx';
import { isPersonRef, recipientFor, sendingAccount } from './emailModel.js';
import { BODY, MUTED } from './emailParts.jsx';

export const READING = 'Reading their records…';
export const UNREADABLE = 'Unreadable: this person’s records could not be read. Close and try again.';
export const NOT_SHARED = 'This member has not shared an email address yet. You can write once they do.';

/**
 * `person` is the record's person ref string (`kind:id`, from `personOfRecord`),
 * the same value `EmailAction` and `emailHref` take (#4660). `label` is the
 * record's own title, drawn in the Sheet's subtitle until the pack names the
 * person. A `person` that is not a ref is unreadable, and nothing is asked.
 */
export default function RecordEmailSheet({ person, label = '', from = null, readOnly = false, onClose, api = mailApi }) {
  const [state, setState] = useState({ status: 'reading' });
  const ref = isPersonRef(person) ? person : null;
  const load = useCallback(() => {
    if (!ref) { setState({ status: 'unreadable' }); return; }
    setState({ status: 'reading' });
    // #4740 (S1 audit): a failed shares read used to fall back to `{ items: [] }`,
    // which told a member who HAD shared that they had not (NOT_SHARED is a
    // false statement of fact) and silently blocked their composer too. No
    // catch here: a failed shares read reaches the same `unreadable` state as
    // a failed accounts or context read, below.
    Promise.all([api.accounts(), api.shares(), api.context(ref)])
      .then(([a, s, pack]) => setState({ status: 'ready', accounts: a?.accounts ?? [], shares: s?.items ?? [], pack }))
      .catch(() => setState({ status: 'unreadable' }));
  }, [api, ref]);
  useEffect(load, [load]);

  if (state.status !== 'ready') {
    return <Sheet title="Email" eyebrow="Email" sub={`Email to ${label || 'this person'}`} onClose={onClose} width={560} testId="record-email-sheet">
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
  // #4017 (IV-D3): a form the member writes, with Ask's field trigger on a blank Body (`RecordCompose`).
  return <RecordCompose pack={pack} refs={refs} to={recipientFor(who, shares)} account={sendingAccount(accounts)} from={from} readOnly={readOnly} api={api}
    onClose={onClose} onSent={onClose} />;
}
