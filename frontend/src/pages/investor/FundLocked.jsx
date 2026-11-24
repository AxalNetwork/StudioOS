/**
 * D6233 (#6233, FV2): the one locked Fund surface. /funds, /funds/lps,
 * /funds/calls, /funds/ledger, /funds/reporting and /funds/history draw it for
 * an investor below the Institutional tier, with the zone name as the variable;
 * /funds/performance draws it for a member without the Investor licence (that
 * page asks the licence and no tier, D6245). It says what the add-on includes
 * and offers Talk to Axal, which opens the Contact form; nothing on the account
 * changes here.
 *
 * There is no blurred preview: FV2 draws none, and a preview could only show
 * invented figures. The zone row is not drawn while locked (FV2), so the one
 * focusable control on the surface is Talk to Axal. Words and rules are in
 * `fundLockedModel.js`.
 */
import { Link } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { CONTACT_CAPTION, TALK_TO_AXAL, lockedCopy } from './fundLockedModel';
import './fundLocked.css';

export default function FundLocked({ zone = 'overview', need = 'institutional' }) {
  const copy = lockedCopy({ zone, need });
  return (
    <main className="fl-locked" data-testid="investor-fund-locked" data-zone={zone} data-need={need} aria-labelledby="fund-locked-title">
      <div className="fl-crumb" data-testid="fund-locked-crumb">Fund <span aria-hidden="true">›</span> <b>{copy.label}</b></div>
      <section className="fl-card">
        <div className="fl-head">
          <span className="fl-lock" aria-hidden="true"><LockKeyhole size={18} /></span>
          <div>
            <span className="fl-kicker" data-testid="text-fund-locked-kicker">{copy.kicker}</span>
            <h1 id="fund-locked-title">{copy.title}</h1>
          </div>
        </div>
        <p className="fl-body">{copy.body}</p>
        <h2 className="fl-inc-title">{copy.includedHeading}</h2>
        <ul className="fl-inc" data-testid="list-fund-locked-included">
          {copy.included.map((item) => (
            <li key={item.slug} data-testid={`fund-locked-included-${item.slug}`}><b>{item.label}</b><small>{item.line}</small></li>
          ))}
        </ul>
        <div className="fl-action">
          <Link to={copy.href} className="fl-btn" data-testid="button-talk-to-axal" aria-describedby="fund-locked-caption">{TALK_TO_AXAL}</Link>
          <span className="fl-cap" id="fund-locked-caption">{CONTACT_CAPTION}</span>
        </div>
        {copy.notes.map((note) => <p className="fl-note" key={note}>{note}</p>)}
      </section>
    </main>
  );
}
