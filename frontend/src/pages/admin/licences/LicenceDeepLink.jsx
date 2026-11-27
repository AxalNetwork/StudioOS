/**
 * D4819 (#4819), Build part 1 — `/admin/licences/:uid` and
 * `/admin/licences/:uid/:section`, the canvas's deep links, opened in the
 * detail view that exists today: the ledger page with `?licence=&tab=`
 * (D4707). The section defaults to overview; a canvas section opens its
 * nearest tab and an existing tab's key opens itself (`tabForSection`). The
 * detail slice moves the sections onto these paths for real.
 */
import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { DEFAULT_TAB, LICENCE_TABS } from '../licenceNavModel';
import { tabForSection } from '../licenceLedgerModel';

/** Where a deep link lands: the ledger page with the licence open on its tab. */
export function deepLinkTarget(uid, section) {
  const q = new URLSearchParams();
  if (uid) q.set('licence', uid);
  const tab = tabForSection(section, LICENCE_TABS.map((t) => t.key));
  if (uid && tab !== DEFAULT_TAB) q.set('tab', tab);
  const s = q.toString();
  return `/admin/licences${s ? `?${s}` : ''}`;
}

export default function LicenceDeepLink() {
  const { uid, section } = useParams();
  return <Navigate replace to={deepLinkTarget(uid, section)} />;
}
