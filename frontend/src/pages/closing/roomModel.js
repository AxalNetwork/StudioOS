/**
 * D1218 (#3215, part 5 of #2424) — the room complete, from the owner's canvas
 * "Closing room" (CP1, CP2, CP4, CP9–CP12, CP16–CP20). Pure, so
 * `frontend/test/closing_room_d1218.test.mjs` holds each rule.
 *
 * WHAT IS READ. The room's closing is the deal's open closing, else its newest
 * (`GET /api/closings`, D1215), read whole by `GET /api/closings/:uid`: every
 * line for the founder and an Admin, the caller's own lines and the round's
 * total for an investor. Each commitment line's paper is D1216's staged
 * envelopes. After Closed, the founder's reporting duties are D1058's desk,
 * kept to this closing's lines. An investor's matches are their own Mercury
 * closing proposals (D840 part 4, D1217). What no mounted route serves says
 * "Not read here yet" with its reason, never a zero.
 *
 * THE PLATFORM NEVER MOVES MONEY. A line reads Received only on the receiving
 * side's evidence; the investor's own Mercury alone reads Sent, not yet
 * confirmed. Amounts are integer cents with the closing's currency.
 */
import { STEPS, daysLeft } from './closingModel.js';
import { lineStatus, moneyCents, routeWord } from './deskModel.js';

export { STEPS };

const cents = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Oct 2026" from a stamp, or null: never a guessed day. */
export function dayOf(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? ''));
  return m && MONTHS[Number(m[2]) - 1] ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/** Who may enter a room (CP19). Anyone else meets the card, and no read is made. */
export const ROOM_ROLES = Object.freeze(['founder', 'investor', 'admin', 'partner']);
export const canEnter = (role) => ROOM_ROLES.includes(role);

export const NO_ACCESS = Object.freeze({
  role: 'Closing rooms open to the founders and investors of a deal.',
  line: 'Only this line’s investor, the founder and the studio team see it.',
  partner: 'Money steps are the studio team’s. An Operating Partner ticks the closing checklist.',
});

export const ROOM_FAILED = Object.freeze({
  title: 'This closing could not be read.',
  claim: 'That is not the same as there being nothing to close.',
});

/** What the room draws that no mounted route serves. Never a zero, never "none". */
export const ROOM_WAITS = Object.freeze({
  account: 'Your company’s receiving account is not read here yet: its route (D1217) is not mounted yet (#3214). Investors see no payment instructions until it is.',
  instructions: 'Payment instructions are not read here yet: the company’s receiving account route (D1217) is not mounted yet (#3214). Nothing here tells you where to pay. Never pay from details sent in an email.',
  sentWord: 'Your word that you sent it is recorded when you accept a match from your Mercury. No route records it without one yet.',
  clause: 'Eadwyn’s summary of a clause and the comments on this paper are not read here yet. Eadwyn summarises and never gives advice; your counsel decides.',
  modelled: 'The fully diluted before and after is not read here yet: no read models a closing line’s change. Accepting records your decision; Raise › Cap table writes the holder (#2432).',
  investorReporting: 'Your reporting duties from this closing are not read here yet: the investor’s reporting read (D1058) names a company, not a closing line. The founder’s card lists each duty the signed paper names.',
});

// ───────────────────────────────────────────────────────────── the lines

const live = (closing) => (Array.isArray(closing?.lines) ? closing.lines : []).filter((l) => l?.status !== 'withdrawn');

/** A line's paper read: its envelopes, null when the read failed, undefined while it is read (a prospect line has none). */
export const papersOf = (papers, line) => (papers && Object.prototype.hasOwnProperty.call(papers, line.uid) ? papers[line.uid] : undefined);

/** The envelope a line is signed on: the newest that is not void. */
export function liveEnvelope(envelopes) {
  return (Array.isArray(envelopes) ? envelopes : []).find((e) => e && !e.voided) || null;
}

/** The stage the paper waits on: the first not signed, or null when every stage is signed. */
export function waitingStage(envelope) {
  const stages = Array.isArray(envelope?.stages) ? [...envelope.stages].sort((a, b) => Number(a.position) - Number(b.position)) : [];
  return stages.find((s) => s.state !== 'signed') || null;
}

/** Which stage is the viewer's own: the company's for the founder, the investor's for an investor. */
export const myRole = (viewer) => (viewer === 'founder' ? 'company' : viewer === 'investor' ? 'investor' : null);

/**
 * Who acts next on a line, in the canvas's words, and whether it is the
 * viewer (`you`). Read from the line's route, paper and status, and the
 * closing's cap-table proposal; a paper read that failed says so.
 */
export function nextOnLine(line, envelopes, closing, viewer, names = {}) {
  const company = names.company || 'The company';
  const investor = viewer === 'investor' ? 'you' : (line?.investor_name || 'The investor');
  const say = (text, you = false) => ({ text, you });
  if (line?.status === 'withdrawn') return say('Withdrawn');
  if (!line?.route) return say('Waiting on the studio team to set the route');
  if (line.commitment_id == null) return say('Waiting on the studio team: a prospect line has no paper here');
  if (envelopes === null) return say('The paper could not be read');
  if (envelopes === undefined) return say('Reading the paper…');
  const env = liveEnvelope(envelopes);
  if (!env) return say('Waiting on the studio team to prepare the paper');
  if (!env.complete) {
    if (env.stages?.some((s) => s.state === 'declined')) return say('Declined: the studio team prepares the paper again');
    const s = waitingStage(env);
    if (s?.state === 'awaiting_release' || s?.role === 'axal') return say('Waiting on the Super Admin to countersign');
    if (s?.state === 'sent') {
      if (s.role === myRole(viewer)) return say('Your turn: sign', true);
      return say(`Waiting on ${s.role === 'company' ? company : investor === 'you' ? 'the investor' : investor} to sign`);
    }
    return say('Waiting on the studio team to send the paper');
  }
  if (line.status === 'open') return viewer === 'investor' ? say('Your turn: send the payment', true) : say(`Waiting on ${investor} to send the payment`);
  if (line.status === 'sent') return say('Waiting on the studio team to confirm receipt');
  if (line.status === 'received') {
    if (closing?.captable?.state === 'proposed') {
      return viewer === 'founder' ? say('Your turn: decide the cap table change', true) : say(`Waiting on ${company} to decide the cap table change`);
    }
    return say('Done');
  }
  return say('Not recorded');
}

/** A line's paper in one phrase, as the room shows it; a failed read and a prospect line each say so. */
export function paperPhrase(line, envelopes) {
  if (line?.commitment_id == null) return 'No paper for a prospect line';
  if (envelopes === null) return 'Could not be read';
  if (envelopes === undefined) return 'Reading the paper…';
  const env = liveEnvelope(envelopes);
  if (!env) return 'No paper sent';
  if (env.complete) return env.countersign ? 'Countersigned' : 'Signed';
  if (env.stages?.some((s) => s.state === 'declined')) return 'Declined';
  if (env.stages?.some((s) => s.state === 'awaiting_release')) return 'Waiting for Axal’s countersign';
  return 'Paper sent';
}

/** The lines the room draws: words for status, route, paper, next, and the line's own figure. */
export function roomLines(closing, papers, viewer, names = {}) {
  const lines = Array.isArray(closing?.lines) ? closing.lines : [];
  const currency = closing?.currency || 'USD';
  return lines.map((l) => {
    const envelopes = papersOf(papers, l);
    return {
      uid: l.uid,
      commitmentId: l.commitment_id ?? null,
      investor: viewer === 'investor' ? 'Your line' : (l.investor_name || 'Name not recorded'),
      route: routeWord(l.route),
      amount: moneyCents(l.amount_cents, l.currency || currency),
      status: lineStatus(l.status),
      paper: paperPhrase(l, envelopes),
      next: nextOnLine(l, envelopes, closing, viewer, names),
      evidence: Array.isArray(l.evidence) ? l.evidence : [],
      withdrawn: l.status === 'withdrawn',
    };
  });
}

// ───────────────────────────────────────────────────────────── CP1, CP2: the strip and the tiles

/**
 * The seven steps, each done, the one now, still to come, or not read. Read
 * over the lines not withdrawn; a paper read that failed makes Paper and Sign
 * "Not read", never done and never zero.
 */
export function stepStrip(closing, papers) {
  const lines = live(closing);
  const read = lines.filter((l) => l.commitment_id != null).map((l) => papersOf(papers, l));
  const failed = read.some((x) => x === null);
  const unread = failed || read.some((x) => x === undefined);
  const env = (l) => liveEnvelope(papersOf(papers, l));
  const count = (n, what) => `${n} ${n === 1 ? 'line' : 'lines'} ${what}`;
  const none = lines.length === 0;
  const steps = [
    unread ? null : none ? [false, 'No line yet'] : [lines.every((l) => env(l)), count(lines.filter((l) => !env(l)).length, 'without paper')],
    unread ? null : none ? [false, 'No line yet'] : [lines.every((l) => env(l)?.complete), count(lines.filter((l) => !env(l)?.complete).length, 'not signed')],
    none ? [false, 'No line yet'] : [lines.every((l) => l.route), count(lines.filter((l) => !l.route).length, 'without a route')],
    none ? [false, 'No line yet'] : [lines.every((l) => l.status === 'sent' || l.status === 'received'), count(lines.filter((l) => l.status === 'open').length, 'not sent')],
    none ? [false, 'No line yet'] : [lines.every((l) => l.status === 'received'), count(lines.filter((l) => l.status !== 'received').length, 'waiting for receipt')],
    (() => {
      const s = closing?.captable?.state;
      if (s === 'accepted') return [true, 'Accepted'];
      if (s === 'dismissed') return [true, 'Dismissed'];
      if (s === 'proposed') return [false, 'Waits for the founder'];
      return [false, 'After every line is received or withdrawn'];
    })(),
    closing?.status === 'closed' ? [true, `Closed ${dayOf(closing.closed_at) || ''}`.trim()] : [false, 'After the closing is Closed'],
  ];
  let now = false;
  return STEPS.map((name, i) => {
    const s = steps[i];
    if (!s) return { name, state: 'unread', text: failed ? 'Not read here' : 'Reading…' };
    if (s[0]) return { name, state: 'done', text: i < 5 ? 'Done' : s[1] };
    const state = now ? 'next' : 'now';
    now = true;
    return { name, state, text: s[1] };
  });
}

/**
 * The tiles. Committed is the round's total (every line not withdrawn, which
 * every reader sees); Signed counts the viewer's lines whose paper is signed,
 * or null when a paper read failed; Received sums received lines only.
 */
export function roomTiles(closing, papers, now = new Date()) {
  const lines = live(closing);
  const currency = closing?.currency || 'USD';
  const read = lines.filter((l) => l.commitment_id != null).map((l) => papersOf(papers, l));
  const signedRead = read.some((x) => x === null) ? 'failed' : read.some((x) => x === undefined) ? 'reading' : 'ok';
  const signed = lines.filter((l) => liveEnvelope(papersOf(papers, l))?.complete).length;
  const received = lines.filter((l) => l.status === 'received');
  const left = daysLeft(closing?.deadline, now);
  return {
    committed: moneyCents(closing?.total_cents, currency),
    lineCount: lines.length,
    signed: signedRead === 'ok' ? `${signed} of ${lines.length}` : null,
    signedRead,
    received: moneyCents(received.reduce((n, l) => n + (cents(l.amount_cents) ?? 0), 0), currency),
    receivedOf: `${received.length} of ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`,
    deadline: dayOf(closing?.deadline),
    left: left == null ? null : left < 0 ? `${-left} ${left === -1 ? 'day' : 'days'} past` : `in ${left} ${left === 1 ? 'day' : 'days'}`,
    mine: moneyCents(lines.reduce((n, l) => n + (cents(l.amount_cents) ?? 0), 0), currency),
  };
}

/** What waits on the viewer: their turn on each line, and the founder's cap-table decision. */
export function needsYou(rows, closing, viewer) {
  const out = rows.filter((r) => r.next.you && !r.next.text.includes('cap table')).map((r) => ({ key: r.uid, text: r.next.text, line: r }));
  if (viewer === 'founder' && closing?.status === 'open' && closing?.captable?.state === 'proposed') {
    out.push({ key: 'captable', text: 'Decide the cap table change', line: null });
  }
  return out;
}

// ───────────────────────────────────────────────────────────── CP4: review and sign

const ROLE_WORD = Object.freeze({ company: 'The company', investor: 'The investor', axal: 'Axal countersign' });

/** The signing order, as the canvas shows each signer: Signed with its day, Your turn, Waiting, Declined. */
export function signingRows(envelope, viewer) {
  const stages = Array.isArray(envelope?.stages) ? [...envelope.stages].sort((a, b) => Number(a.position) - Number(b.position)) : [];
  return stages.map((s) => {
    const mine = s.role === myRole(viewer);
    let state;
    if (s.state === 'signed') state = dayOf(s.signed_at) ? `Signed ${dayOf(s.signed_at)}` : 'Signed, day not recorded';
    else if (s.state === 'sent') state = mine ? 'Your turn' : 'Sent for signature';
    else if (s.state === 'awaiting_release') state = 'Waiting for the Super Admin';
    else if (s.state === 'declined') state = 'Declined';
    else if (s.state === 'void') state = 'Void';
    else state = 'Waiting';
    return {
      key: `${s.position}-${s.role}`,
      position: Number(s.position),
      who: s.role === 'axal' ? 'Axal countersign' : (s.name || ROLE_WORD[s.role] || 'Signer not recorded'),
      role: mine ? `${ROLE_WORD[s.role]} · you` : (s.role === 'axal' ? 'Super Admin' : ROLE_WORD[s.role] || 'Signer'),
      state,
      yourTurn: mine && s.state === 'sent',
      sentAt: dayOf(s.sent_at),
    };
  });
}

// ───────────────────────────────────────────────────────────── CP10: the receipt drawer

const EVIDENCE_WORD = Object.freeze({
  company_mercury: ['Connector', 'Matched in the company’s Mercury'],
  axal_mercury: ['Connector', 'Matched in an Axal entity’s Mercury'],
  investor_mercury: ['Connector', 'Matched in the investor’s Mercury'],
  phone_verified_record: ['Recorded', 'A transfer recorded and confirmed by phone'],
  bank_confirmation: ['Document', 'A bank confirmation file'],
});

/** A line's evidence, newest first (the Worker gives it oldest first). Only the receiving side's turns a line Received; withdrawn evidence says why. */
export function evidenceRows(evidence) {
  return (Array.isArray(evidence) ? evidence : []).map((e, i) => {
    const w = EVIDENCE_WORD[e?.kind];
    return {
      key: e?.uid || String(i),
      source: w ? w[0] : 'Recorded',
      words: w ? w[1] : 'Evidence of a kind this page does not name',
      side: e?.side === 'receiving' ? 'Receiving side' : e?.side === 'sending' ? 'Sending side' : 'Side not recorded',
      receiving: e?.side === 'receiving',
      at: dayOf(e?.created_at),
      withdrawn: e?.withdrawn_at ? `Withdrawn ${dayOf(e.withdrawn_at) || ''}${e.withdrawn_reason ? `: ${e.withdrawn_reason}` : ''}`.trim() : null,
      order: i,
    };
  }).sort((a, b) => b.order - a.order);
}

// ───────────────────────────────────────────────────────────── CP11: the cap-table proposal

/** The cap-table proposal as this viewer meets it: who decides, and whether they can now. */
export function captableView(closing, viewer) {
  const s = closing?.captable?.state;
  const open = closing?.status === 'open';
  if (s === 'accepted') return { state: s, text: `Accepted ${dayOf(closing.captable.decided_at) || ''}`.trim(), canDecide: false };
  if (s === 'dismissed') return { state: s, text: `Dismissed ${dayOf(closing.captable.decided_at) || ''}`.trim(), canDecide: false };
  if (s === 'proposed') {
    return viewer === 'founder' && open
      ? { state: s, text: 'Every line is received or withdrawn. Add the received lines to the cap table, or not now.', canDecide: true }
      : { state: s, text: 'The founder decides the cap-table change.', canDecide: false };
  }
  return { state: 'not_ready', text: 'The cap-table change is proposed once every line is received or withdrawn, with one received.', canDecide: false };
}

// ───────────────────────────────────────────────────────────── CP12: reporting

/** The founder's duties for this closing's lines, from D1058's desk. A term the paper left blank is a default. */
export function dutyRows(desk, lineUids) {
  const keep = new Set((Array.isArray(lineUids) ? lineUids : []).map(String));
  return (Array.isArray(desk?.duties) ? desk.duties : [])
    .filter((d) => d?.closing_line_uid != null && keep.has(String(d.closing_line_uid)))
    .map((d) => {
      const src = d.source || {};
      const from = src.document ? `From ${src.document}${src.clause ? `, clause ${src.clause}` : ''}` : 'Source not recorded';
      return {
        uid: d.uid,
        holder: d.holder?.name || 'Holder not recorded',
        title: d.title || 'Reporting duty',
        cadence: d.cadence || null,
        from,
        signed: !!src.signed,
        defaulted: Array.isArray(d.defaulted) && d.defaulted.length > 0,
        status: d.status || null,
      };
    });
}

// ───────────────────────────────────────────────────────────── CP2, CP20: the investor's matches

/** The investor's own Mercury proposals that fit their lines: proposed only, by commitment. */
export function matchesFor(proposals, lines) {
  const ids = new Set(live({ lines }).map((l) => (l.commitment_id == null ? null : Number(l.commitment_id))).filter((x) => x != null));
  return (Array.isArray(proposals) ? proposals : [])
    .filter((p) => p?.state === 'proposed' && p?.target_kind === 'deal_commitment' && ids.has(Number(p.target_id)))
    .map((p) => ({ uid: p.uid, cents: cents(p.amount_cents), postedOn: dayOf(p.posted_on), lastFour: /^\d{2,4}$/.test(String(p.account_last_four ?? '')) ? String(p.account_last_four) : null }));
}
