import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { BTN_SECONDARY } from '../../team/teamUi.jsx';
import { resolve } from './portfolioAdapter.js';
import { BASE_PATH, companyLegalPath, companyPathFor, companyProjectsPath, companySettingsPathFor, projectPagePath } from './companiesModel';
import { companyProjectTeamPath, companyTeamPath, projectSettingsPath, projectTeamPath } from '../../../lib/settingsScope.js';
import { INK, MUTED } from './portfolioUi.jsx';

/**
 * D1413 (#3696) — the canonical addresses every Portfolio view shows:
 * `/c/<company>`, `/c/<company>/p/<project>` and `/p/<project>`, with an
 * optional `/settings[/<tab>]` tail (the settings scope's own tab paths, D1415
 * part 2). Each is resolved by `GET /api/account/resolve` (a slug, a uid or
 * id, or a slug the target retired) and opens its page under Account ›
 * Portfolio in one hop.
 *
 * An address that names nothing, and one that names something you cannot
 * see, read the same: "This is not yours to open", with Back to Portfolio.
 */

const TAIL = /^(.*?)(?:\/settings(?:\/([a-z]+))?)?\/?$/;

/** Where a resolved address opens, inside Account. */
export function portfolioTarget(answer, tab = null) {
  if (!answer) return null;
  const uid = answer.company_uid || null;
  const id = answer.project_id != null ? answer.project_id : null;
  if (id != null) {
    if (tab === 'team') return uid ? companyProjectTeamPath(uid, id) : projectTeamPath(id);
    if (tab) return uid ? companyProjectsPath(uid, id) : projectSettingsPath(id);
    return projectPagePath(id);
  }
  if (!uid) return null;
  if (tab === 'legal') return companyLegalPath(uid);
  if (tab === 'projects') return companyProjectsPath(uid);
  if (tab === 'team') return companyTeamPath(uid);
  if (tab) return companySettingsPathFor(uid);
  return companyPathFor(uid);
}

export default function PortfolioAddress() {
  const { pathname } = useLocation();
  const [state, setState] = useState({ status: 'loading' });
  const m = TAIL.exec(pathname) || [];
  const base = m[1] || pathname;
  const tab = /\/settings(\/|$)/.test(pathname) ? (m[2] || 'general') : null;
  useEffect(() => {
    let alive = true;
    resolve(base).then((out) => { if (alive) setState(out.available ? { status: 'ready', value: out.value } : { status: 'refused' }); });
    return () => { alive = false; };
  }, [base]);
  if (state.status === 'loading') return <p className={`p-6 ${MUTED}`} data-testid="portfolio-address-reading">Opening…</p>;
  const to = state.status === 'ready' ? portfolioTarget(state.value, tab) : null;
  if (to) return <Navigate replace to={to} />;
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-6" data-testid="portfolio-address-refused">
      <p className={`m-0 text-[15px] font-bold ${INK}`}>This is not yours to open.</p>
      <p className={`m-0 ${MUTED}`}>Nothing at this address belongs to a company or project you are in.</p>
      <Link to={BASE_PATH} className={`w-fit ${BTN_SECONDARY}`}>Back to Portfolio</Link>
    </div>
  );
}
