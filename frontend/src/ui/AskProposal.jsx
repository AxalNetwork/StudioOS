// D4484: shared presentation of an existing Ask proposal; writes stay with its host.
import React from 'react';
import AgentDisclaimer from '../pages/team/AgentDisclaimer.jsx';
import './askPanel.css';
export default function AskProposal({ proposal: c, onAccept, onDiscard, onEdit, editHref, busy = false, icon = null }) {
  return <div className="ead-ask-card" data-status={c.status} data-testid={`ask-card-${c.uid}`}>
    <span className="ead-ask-card-head"><span className="ead-ask-eyebrow is-violet">{icon}{c.eyebrow}</span>{c.source && <span className="ead-ask-source">{c.source}</span>}</span>
    <span className="ead-ask-card-text">{c.text}</span>
    <AgentDisclaimer disclaimerKey={c.disclaimer_key} />
    {c.status === 'proposed' ? <span className="ead-ask-card-acts">
      <button type="button" className="ead-ask-btn is-primary" disabled={busy || !onAccept} onClick={onAccept}>Accept</button>
      {onEdit ? <button type="button" className="ead-ask-btn" disabled={busy} onClick={onEdit}>Edit</button> : editHref ? <a className="ead-ask-btn" href={editHref}>Edit</a> : null}
      <button type="button" className="ead-ask-btn is-ghost" disabled={busy || !onDiscard} onClick={onDiscard}>Discard</button>
    </span> : <span className="ead-ask-decided">{c.status === 'accepted' ? 'Accepted' : 'Discarded'}</span>}
  </div>;
}
