import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import LegalDocument from './site/LegalDocument';
import { INTERVIEW_CONTACT_EMAIL, INTERVIEW_NOTICE_PATH, INTERVIEW_NOTICE_VERSION, noticeVersionFrom } from '../lib/interviewNotice';
import { MEETING_BOT_NOTICE_APPROVED_AT, MEETING_BOT_NOTICE_PUBLISHED, MEETING_BOT_NOTICE_VERSION } from '../../../meeting-bot/notice.mjs';

/**
 * `/privacy/interviews` — what a person a founder interviews through Axal VC
 * is told (D756 §1.7, #1894). The in-chat consent notices (D754, D756) link
 * here with `?n=<version>`; the page reads nothing else, calls no API and
 * renders the same for everyone, signed in or not.
 *
 * Each version's words are kept, so an old link still shows what its person
 * was sent. A new version is a new key here and a new `CONSENT_NOTICE_VERSION`
 * in the Worker; `interview_notice_d756.test.mjs` freezes version 1's text by
 * hash once the owner and counsel approve it.
 *
 * DRAFT, NOT YET APPROVED: version 1's `updated` is set to the approval date
 * in the commit that follows the approval.
 */
const deletion = (email) => (
  <>
    <p>Ask the founder to delete it{email ? <>, or write to <a href={`mailto:${email}`}>{email}</a></> : null}.</p>
    <p>We cannot promise a date for this yet.</p>
  </>
);

export const INTERVIEW_NOTICES = {
  1: {
    updated: 'not yet published',
    intro: (
      <p>
        A founder who uses Axal VC asked to record an interview with you. This page says what is kept, why,
        who can read it, for how long, and how to say no.
      </p>
    ),
    sections: (email) => [
      {
        n: '01',
        h: 'What is recorded',
        body: (
          <>
            <p>The founder can record an interview with you from a chat or a call.</p>
            <p>That can include messages, voice notes, audio files, round videos and call recordings.</p>
            <p>Axal VC never messages you first. The founder does.</p>
            <p>
              Nothing from a chat is recorded until you agree in the chat, or until the founder confirms that you
              already agreed.
            </p>
          </>
        ),
      },
      {
        n: '02',
        h: 'Why',
        body: (
          <>
            <p>It is for the founder&apos;s customer research.</p>
            <p>Software turns the audio into text and writes a short summary for the founder.</p>
            <p>Your words are quoted only if you agree to that separately.</p>
          </>
        ),
      },
      {
        n: '03',
        h: 'Who can read it',
        body: (
          <>
            <p>The founder and Axal VC&apos;s administrators can read the recording and the text made from it.</p>
            <p>Axal VC&apos;s administrators and partners can read what the founder writes down from it.</p>
            <p>Cloudflare stores the recording for Axal VC and runs the software that turns it into text.</p>
            <p>Telegram and WhatsApp keep their own copies of a chat, under their own terms.</p>
          </>
        ),
      },
      {
        n: '04',
        h: 'How long it is kept',
        body: (
          <>
            <p>A recording is kept until the founder deletes it.</p>
            <p>A chat the founder never adds to an interview is deleted after 30 days.</p>
          </>
        ),
      },
      {
        n: '05',
        h: 'How to decline or stop',
        body: (
          <>
            <p>Reply NO or STOP in the chat, or tell the founder.</p>
            <p>Before you agree, NO deletes what was waiting to be recorded.</p>
            <p>After you agree, STOP means nothing new is recorded.</p>
            <p>What was already recorded stays until the founder deletes it, so ask them to.</p>
          </>
        ),
      },
      {
        n: '06',
        h: 'How to ask for deletion',
        body: deletion(email),
      },
    ],
  },
};

/** D886 B9: candidate version 2. Not in INTERVIEW_NOTICES until B1/B6/B2
 * verify consent, notice-once, bot audio retention and whole-session cleanup.
 * Keeping it out also prevents ?n=2 from changing the live disclosure.
 */
export const MEETING_BOT_INTERVIEW_NOTICE = {
  updated: MEETING_BOT_NOTICE_APPROVED_AT || 'not yet published',
  intro: INTERVIEW_NOTICES[1].intro,
  sections: (email) => INTERVIEW_NOTICES[1].sections(email).map((section) => {
    if (section.n === '01') return { ...section, body: <>
      {section.body}
      <p>Eadwyn AI, Axal&apos;s meeting bot, may join a Zoom, Google Meet or Microsoft Teams call as a visible participant for the founder&apos;s venture. It announces recording in the meeting chat. The founder must confirm that the interviewee agreed before sending it.</p>
      <p>The meeting bot records the call&apos;s audio, participant display names, and who spoke when. Display names are labels, not proof of identity.</p>
    </> };
    if (section.n === '04') return { ...section, body: <>
      <p>Call audio, including a meeting bot&apos;s recording, is kept for 30 days by default. The founder can choose a different period or keep it until they delete it, and can delete the audio sooner. Deleting audio does not delete the transcript.</p>
      <p>The transcript, participant display names and who spoke when stay with the session until the founder deletes it.</p>
      <p>An in-person recording is kept until the founder deletes it.</p>
      <p>A chat the founder never adds to an interview is deleted after 30 days.</p>
    </> };
    if (section.n === '05') return { ...section, body: <>
      <p>Reply NO or STOP in the chat, or tell the founder.</p>
      <p>In a call with Eadwyn AI, tell the founder to stop recording. The founder can stop the bot or ask the meeting host to remove it.</p>
      <p>Before you agree, NO deletes what was waiting to be recorded.</p>
      <p>After you agree, STOP means nothing new is recorded.</p>
      <p>What was already recorded is kept under the retention rules above unless the founder deletes it sooner.</p>
    </> };
    if (section.n === '06') return { ...section, body: <>
      {section.body}
      <p>Ask for the audio only to be deleted, or for the whole session and its transcript to be deleted. Findings the founder already accepted into their research may remain after the source session is deleted.</p>
    </> };
    return section;
  }),
};

// One switch publishes the bot's page and makes it current. Keep the legacy
// map immutable so existing chat notice versions remain independent.
export const PUBLISHED_INTERVIEW_NOTICES = MEETING_BOT_NOTICE_PUBLISHED
  ? { ...INTERVIEW_NOTICES, [MEETING_BOT_NOTICE_VERSION]: MEETING_BOT_INTERVIEW_NOTICE } : INTERVIEW_NOTICES;
export const CURRENT_INTERVIEW_NOTICE_VERSION = MEETING_BOT_NOTICE_PUBLISHED ? MEETING_BOT_NOTICE_VERSION : INTERVIEW_NOTICE_VERSION;

export default function InterviewNoticePage({ contactEmail = INTERVIEW_CONTACT_EMAIL, notices = PUBLISHED_INTERVIEW_NOTICES, current = CURRENT_INTERVIEW_NOTICE_VERSION }) {
  const [params] = useSearchParams();
  const { shown, asked } = noticeVersionFrom(params.toString(), Object.keys(notices).map(Number), current);
  const notice = notices[shown];
  const older = asked != null && asked === shown && shown !== current;
  return (
    <LegalDocument
      title="When a founder records you"
      updated={notice.updated}
      version={shown}
      notice={older ? (
        <p className="ax-legal-intro">
          This is the notice you were sent. The current one is <Link to={INTERVIEW_NOTICE_PATH}>version {current}</Link>.
        </p>
      ) : null}
      intro={notice.intro}
      sections={notice.sections(contactEmail)}
      email={contactEmail}
    />
  );
}
