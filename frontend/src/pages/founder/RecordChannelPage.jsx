import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import AdminPageHeader, { HeaderTab } from '../../ui/AdminPageHeader';
import { INBOX, PAGE_LINE, RECORD_CHANNELS, channelOf } from './recordChannels';
import RecordWhatsAppTool from './RecordWhatsAppTool.jsx';
import RecordTelegramTool from './RecordTelegramTool.jsx';
import RecordCallsTool from './RecordCallsTool.jsx';
import { tgRoute, waRoute } from './channelSessionModel.js';
import { mcRoute } from './callsModel.js';

const LINK = 'font-semibold text-violet-700 underline underline-offset-2 dark:text-violet-300';

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
 * D878 (#2525): Calls' boards are built (`RecordCallsTool`, MC1–MC7), on
 * WhatsApp's parts; `callsApi` is the tests' stub. `ChannelToday` stays for a
 * channel whose boards are still to build; none is left today.
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
          : ch.key === 'calls' ? <RecordCallsTool {...(callsApi ? { api: callsApi } : {})} />
            : <ChannelToday ch={ch} />}
    </div>
  );
}

/** D1309's "Today" and "Not built yet", for a channel whose boards are still to build. */
function ChannelToday({ ch }) {
  return (
    <>
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900" data-testid="record-channel-today">
        <h2 className="m-0 text-[15px] font-extrabold text-gray-900 dark:text-gray-100">Today</h2>
        <ul className="mt-2 flex flex-col gap-1.5 pl-4 text-[13px] text-gray-700 dark:text-gray-300">
          <li>Connect {ch.label === 'Calls' ? 'Zoom or Google Meet' : ch.label} on <Link to={ch.connect} className={LINK} data-testid="record-channel-connect">its connector page</Link>.</li>
          <li>{ch.key === 'calls'
            ? <>Schedule a call from an interview’s Record a session; its transcript comes in after the call. <Link to="/validate/record" className={LINK}>Record a session</Link></>
            : <>Waiting chats are in <Link to={INBOX} className={LINK} data-testid="record-channel-inbox">the chats inbox</Link>. Nothing is kept until the person agrees.</>}
          </li>
          <li>Each session’s transcript is on its interview’s session page, from Customer research.</li>
        </ul>
      </section>
      <section className="rounded-xl border border-dashed border-gray-300 bg-white p-5 dark:border-gray-700 dark:bg-gray-900" data-testid="record-channel-wait">
        <h2 className="m-0 text-[15px] font-extrabold text-gray-900 dark:text-gray-100">The {ch.label} screens are not built yet</h2>
        <p className="mt-2 text-[13px] text-gray-600 dark:text-gray-400">
          The approved design ({ch.boards}) adds {ch.builds}. Task #{ch.task} ({ch.decision}) builds them on the data that is already in place.
        </p>
      </section>
    </>
  );
}
