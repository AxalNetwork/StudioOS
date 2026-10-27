import React from 'react';
import { useLocation } from 'react-router-dom';
import AdminPageHeader, { HeaderTab } from '../../ui/AdminPageHeader';
import { PAGE_LINE, RECORD_CHANNELS, channelOf } from './recordChannels';
import RecordWhatsAppTool from './RecordWhatsAppTool.jsx';
import RecordTelegramTool from './RecordTelegramTool.jsx';
import RecordCallsTool from './RecordCallsTool.jsx';
import { tgRoute, waRoute } from './channelSessionModel.js';
import { mcRoute } from './callsModel.js';

/**
 * D1309 (#2507, #2515, #2525) — Record a session › WhatsApp, Telegram and
 * Calls, at their own addresses (`recordChannels.js`). Each says where today's
 * version of its boards is (the connector page, the chats inbox, the session
 * page) and which task builds the rest. Nothing here reads or writes: the
 * screens it points at do.
 *
 * D862 (#2507): WhatsApp's boards are built. Its address and its tab paths
 * draw `RecordWhatsAppTool` under the same header; `whatsappApi` is the
 * tests' stub.
 *
 * D869 (#2515): Telegram's boards are built too, the same tool with Telegram
 * as the channel (`RecordTelegramTool`); `telegramApi` is the tests' stub.
 *
 * D878 (#2525): Calls' boards are built (`RecordCallsTool`, MC1–MC7);
 * `callsApi` is the tests' stub. With all three built, D1309's "Today" and
 * "Not built yet" panels are gone.
 */
export default function RecordChannelPage({ whatsappApi, telegramApi, callsApi }) {
  const { pathname } = useLocation();
  const ch = (waRoute(pathname) ? RECORD_CHANNELS[0] : tgRoute(pathname) ? RECORD_CHANNELS[1] : mcRoute(pathname) ? RECORD_CHANNELS[2] : channelOf(pathname)) || RECORD_CHANNELS[0];
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6" data-testid={`record-channel-${ch.key}`}>
      <AdminPageHeader
        crumb={{ label: 'Customer research', to: '/validate/customer-research', current: `Record a session · ${ch.label}` }}
        title="Record a session"
        line={PAGE_LINE}
        tabs={RECORD_CHANNELS.map((c) => (
          <HeaderTab key={c.key} to={c.to} end={c.key === 'calls'} data-testid={`record-tab-${c.key}`}>{c.label}</HeaderTab>
        ))}
        data-testid="record-channels-header"
      />
      {ch.key === 'whatsapp' ? <RecordWhatsAppTool {...(whatsappApi ? { api: whatsappApi } : {})} />
        : ch.key === 'telegram' ? <RecordTelegramTool {...(telegramApi ? { api: telegramApi } : {})} />
          : <RecordCallsTool {...(callsApi ? { api: callsApi } : {})} />}
    </div>
  );
}
