/** D4439 (#4439) — the existing published co-marketing feed in Grow › Partner network. */
import React from 'react';
import FounderWorkspacePage from './FounderWorkspacePage';
import FounderModuleBackLink from './FounderModuleBackLink';
import CoMarketingPage from '../CoMarketingPage';

export default function FounderCoMarketingPage({ user }) {
  return <FounderWorkspacePage page="grow" hideHeader>
    <FounderModuleBackLink user={user} />
    <CoMarketingPage user={user} landingPath="/grow/partner-network/co-marketing" />
  </FounderWorkspacePage>;
}
