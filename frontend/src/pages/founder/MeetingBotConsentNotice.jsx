import React from 'react';
import { MEETING_BOT_DISPATCH_DISCLOSURE } from '../../../../meeting-bot/notice.mjs';

/** D886 B9: B7 renders this beside D757's existing agreement control, before dispatch. */
export default function MeetingBotConsentNotice() {
  return <p className="text-[12px] text-axal-faint" data-testid="meeting-bot-consent-notice">{MEETING_BOT_DISPATCH_DISCLOSURE}</p>;
}
