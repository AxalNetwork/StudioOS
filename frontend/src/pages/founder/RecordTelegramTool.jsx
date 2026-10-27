import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { RecordChatTool, DEFAULT_API } from './RecordChatTool.jsx';
import { BTN, BTN_SEC, CARD, ConfirmDialog, ErrorBoard, H3, LoadingBoard, MUTED, NoPermissionBoard, Pill, useRead } from './ChannelSessionParts.jsx';
import { CHAT_TOOLS, premiumLine, telegramSteps } from './channelSessionModel.js';

/**
 * D869 (#2515) — Record a session › Telegram, the boards TG1–TG7 at
 * `/validate/record/telegram` (`design/incoming/Record a session · Telegram
 * Boards.dc.html`). Inbox, Sessions, Analytics and Proposals are WhatsApp's
 * (`RecordChatTool.jsx`, D862) with Telegram as the channel; this file draws
 * Telegram's own tabs:
 *
 *   TG1 Connection    D863's six steps (`GET /channels/telegram/setup`), done in
 *                     Telegram; only "Link with a code" is pressed here.
 *   TG6 Send to Axal  forwarding a voice note or a recording to the Axal bot
 *                     (D867), and the consent question the bot asks first.
 *   TG7 MCP access    what Eadwyn and the founder's own AI clients can read.
 *
 * Consent comes first (D756): a chat's text enters an assigned session, its
 * notes wait for the contact's own YES, and a forwarded recording is kept
 * only after the founder answers the bot.
 */

const TOOL = CHAT_TOOLS.telegram;
const CR = '/validate/customer-research';

const MARK = {
  done: 'bg-emerald-700 text-white',
  todo: 'border-[1.5px] border-gray-300 bg-white text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-400',
  blocked: 'border-[1.5px] border-dashed border-gray-300 bg-gray-50 text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-500',
};

/** TG1: the six steps, the Premium prerequisite and the one-time link code. */
function TelegramConnection({ api, reloadAll }) {
  const read = useRead(() => api.channels.telegramSetup(), [api]);
  const [ask, setAsk] = useState(false);
  const [code, setCode] = useState(null);
  if (read.status === 'loading') return <LoadingBoard testId="tg-connect-loading" />;
  if (read.status === 'forbidden') return <NoPermissionBoard label="Telegram" />;
  if (read.status !== 'ready') return <ErrorBoard what="Your Telegram setup" onRetry={read.reload} testId="tg-connect-error" />;
  const steps = telegramSteps(read.data);
  const premium = premiumLine(read.data);
  const again = () => { read.reload(); reloadAll(); };
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_320px]" data-testid="tg-connect">
      <div className="flex flex-col gap-3">
        {premium ? (
          <div className={`${CARD} flex flex-col gap-1`} data-testid="tg-premium">
            <span className="flex flex-wrap items-center gap-2"><h3 className={H3}>{premium.t}</h3><Pill tone="out">Not checked by Axal</Pill></span>
            <p className={MUTED}>{premium.p}</p>
          </div>
        ) : null}
        <div className={`${CARD} p-0`}>
          <div className="flex flex-wrap items-start justify-between gap-2 p-4">
            <div>
              <h2 className={H3}>Connect Telegram</h2>
              <p className={MUTED}>Six steps, done in Telegram. Each line says what to do there.{read.data?.account ? ` Linked as ${read.data.account}.` : ''}</p>
            </div>
            {read.data?.ready ? <Pill tone="pos" testId="tg-ready">Ready</Pill> : <button type="button" className={BTN_SEC} onClick={again} data-testid="tg-check-again">Check again</button>}
          </div>
          <ol className="m-0 list-none p-0">
            {steps.map((s) => (
              <li key={s.key} className="flex items-start gap-3 border-t border-gray-100 px-4 py-3.5 dark:border-gray-800" data-testid={`tg-step-${s.key}`}>
                <span className={`grid h-7 w-7 flex-none place-items-center rounded-full text-[12px] font-extrabold ${MARK[s.state]}`}>{s.state === 'done' ? '✓' : s.n}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-gray-900 dark:text-gray-100">{s.t}<Pill tone={s.state === 'done' ? 'pos' : s.state === 'todo' ? 'amb' : 'mut'} testId={`tg-step-pill-${s.key}`}>{s.pill}</Pill></span>
                  <span className={MUTED}>{s.line}</span>
                  {s.action ? <span className="text-[12px] text-gray-700 dark:text-gray-300" data-testid={`tg-step-action-${s.key}`}>{s.action}</span> : null}
                  {s.link ? <div><button type="button" className={BTN} onClick={() => setAsk(true)} data-testid="tg-link-code">Link with a code</button></div> : null}
                  {s.key === 'consent_notice' ? <Link to="/privacy/interviews" className="w-fit text-[12px] font-semibold text-violet-700 underline underline-offset-2 dark:text-violet-300" data-testid="tg-notice">Read the notice each person sees</Link> : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
        {code ? (
          <div className={`${CARD} flex flex-col gap-2`} role="status" data-testid="tg-code">
            <h3 className={H3}>Your link code</h3>
            <p className={MUTED}>Open the Axal bot in Telegram and press Start, or send it this code. {code.expires_at ? `It works until ${String(code.expires_at).replace('T', ' ').slice(0, 16)} UTC.` : 'It works for a few minutes.'}</p>
            {code.code ? <code className="w-fit rounded-md bg-gray-100 px-2.5 py-1.5 font-mono text-[13px] text-gray-900 dark:bg-gray-800 dark:text-gray-100" data-testid="tg-code-value">{code.code}</code> : null}
            {/^https:\/\/t\.me\//.test(String(code.url || '')) ? <a href={code.url} target="_blank" rel="noopener noreferrer" className={`${BTN} w-fit`} data-testid="tg-code-open">Open the Axal bot in Telegram</a> : null}
            <p className={MUTED}>Then send /confirm to the bot, and come back here to confirm the account.</p>
          </div>
        ) : null}
      </div>
      <aside className="flex flex-col gap-3">
        <div className={CARD}>
          <h3 className={H3}>Your login stays yours</h3>
          <p className={MUTED} data-testid="tg-login-line">Axal never asks for your Telegram login code. Anyone who does is not Axal.</p>
        </div>
        <div className={CARD}>
          <h3 className={H3}>Forward instead</h3>
          <p className={MUTED}>You can also forward a voice note or a call recording to the Axal bot.</p>
          <Link to={TOOL.href('send')} className={`${BTN_SEC} mt-2`} data-testid="tg-connect-send">How Send to Axal works</Link>
        </div>
      </aside>
      {ask ? (
        <ConfirmDialog title="Link with a code" testId="tg-link-dialog"
          sub="Axal makes a one-time code. You send it to the Axal bot from your own Telegram account; nothing is linked until you confirm on both sides."
          confirm="Make the code" onClose={() => setAsk(false)}
          onConfirm={() => api.channels.linkTelegram().then((r) => { setCode(r || {}); read.reload(); })} />
      ) : null}
    </section>
  );
}

const SEND_STEPS = [
  'Open the chat with [Contact] in Telegram.',
  'Press and hold the voice note or the call recording, then tap Forward.',
  'Choose the Axal bot. It answers within a few seconds.',
  'Answer the bot’s question about consent. Nothing is kept until you do.',
];
/** The bot's own question and buttons (`telegramCapture.ts` CAPTURE_COPY), so the page and the chat say the same. */
const CAPTURE_QUESTION = 'Before Axal transcribes this: did everyone in the recording agree to be recorded and transcribed before it started?';
const CAPTURE_ANSWERS = [
  ['Yes, out loud', 'Axal transcribes it and saves it as a session.'],
  ['Yes, in writing', 'Axal transcribes it and saves it as a session.'],
  ['No', 'Axal does not keep the recording.'],
];

/** TG6: forwarding a recording to the Axal bot, the held capture and where a saved one goes. */
function TelegramSend() {
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_320px]" data-testid="tg-send">
      <div className="flex flex-col gap-3">
        <div className={CARD}>
          <h2 className={H3}>Send to Axal on Telegram</h2>
          <p className={MUTED}>Forward a voice note or a call recording to the Axal bot from your own Telegram. Voice notes and audio files up to 5 MB.</p>
          <ol className="m-0 mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-[13px] text-gray-800 dark:text-gray-200" data-testid="tg-send-steps">
            {SEND_STEPS.map((t) => <li key={t}>{t}</li>)}
          </ol>
        </div>
        <div className={`${CARD} flex flex-col gap-2`} data-testid="tg-send-held">
          <span className="flex flex-wrap items-center gap-2"><h3 className={H3}>Waiting for your answer</h3><Pill tone="amb">Held</Pill></span>
          <p className={MUTED}>Until you answer, the recording is held as a reference: nothing is downloaded or transcribed.</p>
          <p className="m-0 rounded-lg bg-gray-50 px-3 py-2 text-[13px] text-gray-900 dark:bg-gray-800 dark:text-gray-100">{CAPTURE_QUESTION}</p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {CAPTURE_ANSWERS.map(([a, line]) => (
              <li key={a} className="flex flex-wrap items-center gap-2 text-[12.5px]"><Pill tone="out">{a}</Pill><span className={MUTED}>{line}</span></li>
            ))}
          </ul>
        </div>
        <div className={`${CARD} flex flex-col gap-1`} data-testid="tg-send-saved">
          <span className="flex flex-wrap items-center gap-2"><h3 className={H3}>Saved</h3><Pill tone="pos">Saved</Pill></span>
          <p className={MUTED}>A saved recording becomes a session in Customer research, with its transcript and Eadwyn’s proposals to accept.</p>
          <Link to={CR} className="w-fit text-[12.5px] font-semibold text-violet-700 underline underline-offset-2 dark:text-violet-300" data-testid="tg-send-cr">Open Customer research</Link>
        </div>
      </div>
      <aside className="flex flex-col gap-3">
        <div className={CARD}>
          <h3 className={H3}>Before you forward</h3>
          <p className={MUTED}>Your Telegram account must be linked to Axal (Connection, step 1). A recording larger than 5 MB is refused; record it with the in-app recorder instead.</p>
          <Link to={TOOL.href('connection')} className={`${BTN_SEC} mt-2`}>Connection</Link>
        </div>
      </aside>
    </section>
  );
}

const MCP_READS = [
  { t: 'Eadwyn can read', items: ['Session insights: themes, objections, willingness to pay, competitors and quotes, once consent is given', 'Proposals waiting for you'] },
  { t: 'Your own AI clients can read, through Axal’s MCP', items: ['The chat list without any message text: the contact as shown here, the channel, the consent state and counts', 'Session insights, read-only'] },
];
const MCP_NEVER = ['Message text from anyone who has not agreed', 'Phone numbers in full', 'Your Telegram account or login'];

/** TG7: what Axal's MCP lets Eadwyn and the founder's own AI clients read of Telegram, and what it never does. */
function TelegramMcp() {
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_320px]" data-testid="tg-mcp">
      <div className="flex flex-col gap-3">
        {MCP_READS.map((g) => (
          <div key={g.t} className={CARD}>
            <h2 className={H3}>{g.t}</h2>
            <ul className="m-0 mt-2 flex list-disc flex-col gap-1 pl-5 text-[13px] text-gray-800 dark:text-gray-200">{g.items.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        ))}
        <div className={CARD} data-testid="tg-mcp-never">
          <h2 className={H3}>Never</h2>
          <ul className="m-0 mt-2 flex list-disc flex-col gap-1 pl-5 text-[13px] text-gray-800 dark:text-gray-200">{MCP_NEVER.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
      <aside className="flex flex-col gap-3">
        <div className={CARD}>
          <h3 className={H3}>Your login stays yours</h3>
          <p className={MUTED}>Axal never asks for your Telegram login code.</p>
        </div>
        <div className={CARD}>
          <h3 className={H3}>Connected AI clients</h3>
          <p className={MUTED} data-testid="tg-mcp-clients">The clients you connect read through Axal’s MCP, read-only. They are not listed on this page yet.</p>
        </div>
      </aside>
    </section>
  );
}

const EXTRAS = {
  connection: (ctx) => <TelegramConnection api={ctx.api} reloadAll={ctx.reloadAll} />,
  send: () => <TelegramSend />,
  mcp: () => <TelegramMcp />,
};

const STATES = {
  /** TG-S, empty: Telegram is not linked or no business connection is up yet. */
  empty: () => (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-gray-300 bg-white p-6 dark:border-gray-600 dark:bg-gray-900" data-testid="tg-empty">
      <h2 className="m-0 text-[16px] font-extrabold text-gray-900 dark:text-gray-100">Telegram is not linked yet.</h2>
      <p className="m-0 text-[13px] text-gray-600 dark:text-gray-400">Start with a code, then add the Axal bot in Telegram Business. Nothing is kept until each person agrees.</p>
      <Link to={TOOL.href('connection')} className={BTN} data-testid="tg-empty-connect">Link with a code</Link>
    </div>
  ),
  /** TG-S, canary-only: the channel is in its canary and this founder is outside it. */
  canary: () => (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900" data-testid="tg-canary">
      <Pill tone="lav">Canary</Pill>
      <h2 className="m-0 text-[16px] font-extrabold text-gray-900 dark:text-gray-100">Telegram capture is open to canary founders only.</h2>
      <p className="m-0 text-[13px] text-gray-600 dark:text-gray-400">Your venture is not in the canary yet. WhatsApp and calls work as before.</p>
    </div>
  ),
};

export default function RecordTelegramTool({ api = DEFAULT_API }) {
  return <RecordChatTool tool={TOOL} api={api} extras={EXTRAS} states={STATES} />;
}
