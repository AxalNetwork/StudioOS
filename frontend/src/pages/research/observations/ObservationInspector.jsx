// Read-only market observation detail for Geography and study evidence (D7718).
import React from 'react';
import Sheet from '../../../ui/Sheet';
import { Unrecorded } from '../../../ui/Honesty';
import { externalLink, fieldGroups, reading } from './observationRead.js';

function Field({ name, label, value }) {
  const display = reading(name, value);
  const href = name === 'source_url' || name === 'methodology_url' ? externalLink(value) : null;
  return <div className="grid grid-cols-2 gap-3 border-b border-axal-hairline py-2 dark:border-gray-700">
    <dt className="text-axal-muted">{label}</dt>
    <dd className="min-w-0 break-words">{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{display}</a> : display ?? <Unrecorded />}</dd>
  </div>;
}

export default function ObservationInspector({ observation, onClose }) {
  return <Sheet title={observation.metric_label} eyebrow="Observation" phone="sheet" onClose={onClose}>
    <div className="space-y-5 p-4 text-sm text-axal-ink dark:text-gray-100">
      {Object.entries(fieldGroups).map(([group, fields]) => <section key={group}><h3 className="font-bold">{group}</h3>
        <dl>
          {group === 'What it measures' && <Field label="Definition" value={observation.definition} />}
          {Object.entries(fields).map(([key, label]) => <Field key={key} name={key} label={label} value={observation[key]} />)}
          {group === 'Revisions' && <Field label="Replaced by" value={observation.replacedBy} />}
        </dl></section>)}
    </div>
  </Sheet>;
}
