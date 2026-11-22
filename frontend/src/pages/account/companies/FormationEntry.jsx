/** D6688 — the same server-state incorporation door on company and project surfaces. */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataState, Unreadable } from '../../../ui/Honesty';
import { BTN_TEXT } from '../../team/teamUi';
import * as portfolio from './portfolioAdapter';
import LegalSheet from './LegalSheet';
import { accountCompaniesApi } from '../../../lib/api/accountCompanies';
import { formationEntry } from './companiesModel';

export function useCompanyFormation(uid, tick = 0) {
  const [state, setState] = useState({ uid, loading: true, row: null });
  useEffect(() => {
    let live = true;
    setState({ uid, loading: true, row: null });
    accountCompaniesApi.companies().then(result => {
      if (!Array.isArray(result?.companies)) throw Error('Companies unreadable');
      const row = result.companies.find(row => row.uid === uid) ?? null;
      if (live) setState({ uid, loading: false, row, refused: row === null });
    }).catch(() => { if (live) setState({ uid, loading: false, row: null }); });
    return () => { live = false; };
  }, [uid, tick]);
  if (state.uid !== uid || state.loading) return { state: 'loading' };
  return state.refused ? { state: 'refused', allowed: false, href: null } : { ...formationEntry(state.row), row: state.row };
}

export default function FormationEntry({ entry, name, uid, project = false, onRetry, onSaved = () => {}, onLegal, legalOnly = false, testId, showRefusal = false }) {
  const [legal, setLegal] = useState(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const currentUid = useRef(uid);
  currentUid.current = uid;
  useEffect(() => { setLegal(null); setError(false); setBusy(false); }, [uid]);
  const editLegal = async () => {
    if (onLegal) { onLegal(); return; }
    setBusy(true); setError(false);
    const result = await portfolio.legal(uid);
    if (currentUid.current !== uid) return;
    setBusy(false);
    if (result.available && result.value?.can_edit === true && !result.value.archived) setLegal(result.value);
    else setError(result.refused || result.notFound || (result.available && (result.value?.can_edit === false || result.value?.archived)) ? 'refused' : 'unavailable');
  };
  if (entry?.state === 'loading') return <p aria-busy="true">Reading incorporation status…</p>;
  if (entry?.state === 'refused') return <DataState state="refused" reason="This company is not available to this account." />;
  if (!entry || entry.state === 'unreadable') return <Unreadable what={`The incorporation status of ${name}`} onRetry={onRetry} />;
  if (entry.state === 'incorporated') return null;
  if (entry.state === 'in_formation') return <p className="m-0 text-sm" data-testid="formation-order">In formation{entry.href ? <> · <Link className={`${BTN_TEXT} min-h-11`} to={entry.href}>Open</Link></> : null}</p>;
  if (!entry.allowed) return showRefusal ? <DataState state="refused" reason={`Only ${project ? 'the project owner' : 'an Admin of this company'} can start incorporation.`} /> : null;
  return <div className="flex flex-col items-start gap-2" data-testid="formation-entry">
    {!legalOnly && <Link className={`${BTN_TEXT} min-h-11`} to={entry.href} data-testid={testId}>{project ? 'Convert this project into a company' : `Incorporate ${name}`}</Link>}
    {!project && <button type="button" className={`${BTN_TEXT} min-h-11`} disabled={busy} onClick={editLegal}>{busy ? 'Reading legal facts…' : 'Already incorporated? Record its legal facts'}</button>}
    {error === 'refused' ? <DataState state="refused" reason="The legal facts are not available for editing on this account." /> : error && <Unreadable what="The editable legal facts" onRetry={editLegal} />}
    {legal && <LegalSheet uid={uid} companyName={name} legal={legal} onClose={() => setLegal(null)} onSaved={() => { setLegal(null); onSaved(); }} />}
  </div>;
}
