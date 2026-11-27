// D4493 (#4493): MK7b's Consent by step table: each enrolled prospect's recorded permission per step, from the Worker's read.
import React from 'react';
import { Pill, Table } from './DistributionParts.jsx';
import { CONSENT_RULE, channelLabel, consentCaption, consentPill } from './sequenceModel.js';

export default function ConsentByStep({ steps = [], enrolments = [] }) {
  const counts = {};
  const columns = [{ key: 'prospect', label: 'Prospect' }, ...steps.map((s) => {
    counts[s.channel] = (counts[s.channel] || 0) + 1;
    return { key: `step-${s.position}`, label: `${channelLabel(s.channel)} ${counts[s.channel]}` };
  })];
  const captions = consentCaption(enrolments, steps);
  return <section className="sq-consent" aria-label="Consent by step" data-testid="consent-by-step">
    <h3 className="ds-eyebrow">Consent by step</h3>
    <p className="sq-sub dark:text-gray-400">{CONSENT_RULE}</p>
    {!enrolments.length ? <p className="sq-sub dark:text-gray-400">No prospect is enrolled yet.</p> : <Table label="Consent by step" columns={columns}>
      {enrolments.map((r) => <tr key={r.enrolment_uid}><th scope="row">{r.contact_name || 'Name · Not recorded'}</th>
        {steps.map((s) => { const cell = r.consent?.find((c) => c.position === s.position); const pill = consentPill(cell?.basis); return <td key={s.position}><Pill tone={pill.tone}>{pill.label}</Pill></td>; })}
      </tr>)}
    </Table>}
    {captions.map((line) => <p key={line} className="sq-sub dark:text-gray-400">{line}</p>)}
  </section>;
}
