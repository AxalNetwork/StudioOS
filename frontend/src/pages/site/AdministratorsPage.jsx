import React from 'react';
import SitePage from '../../components/site/SitePage';
import { ButtonLink, Eyebrow } from '../../components/site/SiteBlocks';
import {
  ADMIN_BLOCKS, ADMIN_FAQ, ADMIN_LICENCES, ADMIN_SETTINGS_CHIPS, ADMIN_SETTINGS_COPY,
  DNS_RECORDS, LICENCE_REQUEST_PATH,
} from '../../lib/siteFirm';
import './firm.css';

/**
 * The Administrators page, `/administrators`, from the ADMINISTRATORS view of
 * the owner's canvas (D677, #1551): the hero, the console's eight places (the
 * Studio sketch, the six blocks, Settings with its DNS records, the Eadwyn
 * note), the two licences, the questions and the closing.
 *
 * The DNS table is the Worker's: the CNAME target and the ownership record are
 * what `cloudflare-worker/src/services/licenceDomain.ts` asks a white-label to
 * publish and then checks (D197, D449). `firm_platform_admin_d677.test.mjs`
 * compares the rows with `recordsFor`, so the page cannot drift from the check.
 */

/** "See the console" moves to the console. The anchor still works without it. */
function toConsole(e) {
  const el = typeof document !== 'undefined' ? document.getElementById('admin-console') : null;
  if (!el) return;
  e.preventDefault();
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/** The canvas's Studio sketch: Eadwyn beside a ticket. Decorative, as drawn. */
function StudioSketch() {
  return (
    <div className="fx-sketch" aria-hidden="true">
      <div className="fx-sketch-card">
        <div className="fx-sketch-who"><span className="fx-e">E</span>Eadwyn</div>
        <div className="fx-sketch-msg">I drafted a reply and attached the partner&apos;s KYB file to the ticket.</div>
        <div className="fx-sketch-row"><span className="fx-sketch-chip">Open draft</span><span className="fx-sketch-chip">Show file</span></div>
      </div>
      <div className="fx-sketch-card">
        <div className="fx-sketch-k">Ticket</div>
        <div className="fx-sketch-t">Partner listing review</div>
        <div className="fx-sketch-bar" style={{ width: '90%' }} />
        <div className="fx-sketch-bar" style={{ width: '70%' }} />
        <div className="fx-sketch-row"><span className="fx-sketch-btn is-primary">Approve</span><span className="fx-sketch-btn">Return</span></div>
      </div>
    </div>
  );
}

export default function AdministratorsPage() {
  return (
    <SitePage title="For Administrators">
      <section className="fx-adm-hero" aria-labelledby="fx-adm-h">
        <div className="ax-wrap fx-w1200 fx-adm-hero-grid">
          <div>
            <Eyebrow>For Administrators</Eyebrow>
            <h1 id="fx-adm-h" className="ax-h1">Run your territory from one console.</h1>
            <div className="ax-row-btns" style={{ marginTop: 34 }}>
              <ButtonLink to={LICENCE_REQUEST_PATH}>Request a licence</ButtonLink>
              <ButtonLink href="#admin-console" variant="quiet" onClick={toConsole}>See the console</ButtonLink>
            </div>
            <p className="fx-adm-for">For the person who runs a territory: an Axal VC subsidiary or a white-label operator. Both use the same console.</p>
          </div>
          <div className="fx-adm-aside">
            <p className="ax-display fx-adm-aside-lead">Running a territory means running accounts, approvals, programs, community, contracts, and brand. Here they live in one console.</p>
            <p className="fx-adm-aside-note">Licence fee and revenue share are agreed with Axal VC, not listed.</p>
          </div>
        </div>
      </section>

      <section id="admin-console" className="ax-wrap fx-w1200 fx-console" aria-labelledby="fx-console-h">
        <Eyebrow>The console</Eyebrow>
        <h2 id="fx-console-h" className="ax-h2 fx-sec-h">Eight places. One territory.</h2>

        <div className="fx-studio">
          <div>
            <div className="fx-place-n">01</div>
            <h3 className="fx-place-t">Studio</h3>
            <p className="fx-place-p">Eadwyn, a ticket, and the work in front of the admin. Eadwyn drafts and organises; the ticket carries the request; the administrator decides.</p>
          </div>
          <StudioSketch />
        </div>

        <ul className="fx-blocks">
          {ADMIN_BLOCKS.map((b) => (
            <li key={b.n} className="fx-block">
              <div className="fx-place-n">{b.n}</div>
              <h3 className="fx-block-t">{b.t}</h3>
              <p className="fx-block-d">{b.d}</p>
            </li>
          ))}
        </ul>

        <div className="fx-settings" id="fx-settings">
          <div>
            <div className="fx-place-n">08</div>
            <h3 className="fx-place-t">Settings</h3>
            <p className="fx-settings-p">{ADMIN_SETTINGS_COPY}</p>
            <ul className="fx-chips">
              {ADMIN_SETTINGS_CHIPS.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
          <div>
            <div className="fx-dns-k" id="fx-dns-k">DNS · prefer an app. subdomain</div>
            <table className="fx-dns" aria-labelledby="fx-dns-k" data-testid="dns-records">
              <colgroup><col className="fx-dns-type" /><col /><col /></colgroup>
              <thead>
                <tr><th scope="col">Type</th><th scope="col">Host</th><th scope="col">Value</th></tr>
              </thead>
              <tbody>
                {DNS_RECORDS.map((r) => (
                  <tr key={r.type}>
                    <td>{r.type}</td>
                    <td>{r.host}</td>
                    <td>{r.value}{r.token && <span className="fx-dns-token">{r.token}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="fx-dns-note">Two records. Your nameservers stay where they are.</p>
          </div>
        </div>

        <div className="fx-eadwyn">
          <span className="fx-e fx-e-lg" aria-hidden="true">E</span>
          <div>
            <div className="fx-eadwyn-t">Eadwyn, the assistant inside the console</div>
            <p className="fx-eadwyn-p">Eadwyn drafts, organises, and attaches what a decision needs. The administrator makes the decision.</p>
          </div>
        </div>
      </section>

      <section id="fx-licence" className="ax-wrap fx-w1200 fx-licence-sec" aria-labelledby="fx-licence-h">
        <Eyebrow>Licence</Eyebrow>
        <h2 id="fx-licence-h" className="ax-h2 fx-sec-h">One console, two kinds of licence.</h2>
        <p className="fx-lede">White-label is a kind of licence, not a second product and not a job title.</p>
        <ul className="fx-licences">
          {ADMIN_LICENCES.map((l) => (
            <li key={l.t} className="fx-licence">
              <h3>{l.t}</h3>
              <dl>
                {l.rows.map((r) => (
                  <div key={r.k} className="fx-licence-row"><dt>{r.k}</dt><dd>{r.v}</dd></div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
        <p className="fx-note">Super Admin stays on axal.vc and app.axal.vc and is not offered on this page.</p>
      </section>

      <section id="fx-faq" className="fx-faq-band" aria-labelledby="fx-faq-h">
        <div className="ax-wrap fx-w1200 ax-section">
          <h2 id="fx-faq-h">Questions</h2>
          <ul className="fx-qs">
            {ADMIN_FAQ.map((q) => (
              <li key={q.q} className="fx-q">
                <h3>{q.q}</h3>
                <p>{q.a}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="fx-adm-close" className="ax-wrap fx-w1200 fx-closing" aria-labelledby="fx-adm-close-h">
        <div className="fx-closing-box">
          <h2 id="fx-adm-close-h">One territory. One console.</h2>
          <ButtonLink to={LICENCE_REQUEST_PATH}>Request a licence</ButtonLink>
        </div>
      </section>
    </SitePage>
  );
}
