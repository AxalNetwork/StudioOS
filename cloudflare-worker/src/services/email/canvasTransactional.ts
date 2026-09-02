/**
 * Canvas transactional templates M1–M5 from Emails.dc.html.
 *
 * Each renderer returns subject/text/html using the shared M0 chrome.
 * Call sites pass real merge data; the canvas sample figures are defaults
 * only where noted in tests.
 */
import {
  ctaButton,
  ctaNote,
  digestCards,
  h1,
  label,
  numberedChips,
  paragraph,
  securityNote,
  tintBlock,
  type ChecklistChip,
  type DigestCard,
  type TintRow,
} from './canvasEmailParts';
import { footerFor, shell, type FooterLink } from './inviteChrome';

export interface WorkspaceInviteVars {
  to: string;
  inviteeEmail: string;
  inviterName: string;
  inviterRole: string;
  workspaceName: string;
  roleName: string;
  seatType: string;
  joinUrl: string;
  prefsUrl?: string;
}

export function renderWorkspaceInvite(v: WorkspaceInviteVars) {
  const reason = `Sent to ${v.inviteeEmail} because ${v.inviterName} invited you to a workspace.`;
  const rows: TintRow[] = [
    { k: 'Workspace', v: v.workspaceName },
    { k: 'Invited by', v: `${v.inviterName} · ${v.inviterRole}` },
    { k: 'Your role', v: v.roleName, strong: true },
    { k: 'Seat type', v: v.seatType, last: true },
  ];
  const body = `${label('YOU HAVE BEEN INVITED')}
${h1(`${v.inviterName} added you to ${v.workspaceName}`, 'margin-top:11px;')}
${paragraph(`You have been given a seat on the ${v.workspaceName} workspace on Axal VC. ${v.inviterName} set your role as ${v.roleName}, which gives you the product and roadmap surfaces and leaves cap table and fundraise closed.`)}
${paragraph('Sign in with this address and the workspace will be waiting. If you already have an Axal VC account, this seat joins it rather than creating a second one.', 16)}
${tintBlock('YOUR SEAT', rows, 'lav', 'Role and access are set by the workspace admin and can be changed at any time.', '#6d28d9')}
<div style="margin-top:24px;">${ctaButton(`Join ${v.workspaceName}`, v.joinUrl)}</div>
${ctaNote('This invite does not expire. It can be revoked by the workspace admin.')}`;
  const footer = footerFor('transactional', { to: v.to, reason, prefsUrl: v.prefsUrl });
  const html = shell(body, footer);
  const text = `${v.inviterName} added you to ${v.workspaceName}\n\nJoin: ${v.joinUrl}\n`;
  const subject = `${v.inviterName} invited you to ${v.workspaceName} on Axal VC`;
  return { subject, html, text };
}

export interface SignatureRequestVars {
  to: string;
  documentTitle: string;
  companyName: string;
  counterparty: string;
  signatorySummary: string;
  expiresAt: string;
  signUrl: string;
  prefsUrl?: string;
}

export function renderSignatureRequest(v: SignatureRequestVars) {
  const reason = `Sent to ${v.to} because a document is awaiting your signature.`;
  const rows: TintRow[] = [
    { k: 'Document', v: v.documentTitle },
    { k: 'Company', v: v.companyName },
    { k: 'Counterparty', v: v.counterparty },
    { k: 'Signatories', v: v.signatorySummary },
    { k: 'Link expires', v: v.expiresAt, strong: true, warn: true, last: true },
  ];
  const body = `${h1(v.documentTitle)}
${paragraph(`${v.counterparty} countersigned this morning. The document is now waiting on your signature and nothing else.`)}
${paragraph('You will see the full agreement before signing, and you can download a copy at any point afterwards.', 16)}
${tintBlock('DOCUMENT', rows, 'table', 'After expiry the envelope voids and has to be reissued by the sender — the document itself is unaffected.', '#6b6577')}
<div style="margin-top:24px;">${ctaButton('Review & sign', v.signUrl)}</div>
${ctaNote('Opening the document does not sign it.')}
${securityNote(
    'BEFORE YOU CLICK',
    'This email comes from notifications@axal.vc and the link opens on app.axal.vc. We will never ask for a password, a wire, or a document by reply. If anything looks off, sign in directly and the request will be waiting under Send for Signature.',
  )}`;
  const footer = footerFor('transactional', { to: v.to, reason, prefsUrl: v.prefsUrl });
  const html = shell(body, footer, 'SIGNATURE REQUEST');
  const text = `Signature requested: ${v.documentTitle}\n\nReview & sign: ${v.signUrl}\n`;
  const subject = `Signature requested: ${v.documentTitle}`;
  return { subject, html, text };
}

export interface CapitalCallVars {
  to: string;
  fundName: string;
  callNumber: number;
  callPercent: number;
  commitmentFormatted: string;
  calledToDateFormatted: string;
  priorPercent: number;
  amountDueFormatted: string;
  dueDate: string;
  unfundedFormatted: string;
  unfundedPercent: number;
  viewUrl: string;
  asAtDate: string;
  prefsUrl?: string;
}

export function renderCapitalCall(v: CapitalCallVars) {
  const reason = `Sent to ${v.to} because you hold a commitment in ${v.fundName}. Capital notices cannot be turned off.`;
  const rows: TintRow[] = [
    { k: 'Commitment', v: v.commitmentFormatted },
    { k: 'Called to date', v: `${v.calledToDateFormatted} · ${v.priorPercent}%` },
    { k: 'This call', v: `${v.callPercent}% of commitment` },
    { k: 'Amount due', v: v.amountDueFormatted, strong: true },
    { k: 'Due date', v: v.dueDate, warn: true },
    { k: 'Unfunded after payment', v: `${v.unfundedFormatted} · ${v.unfundedPercent}%`, last: true },
  ];
  const body = `${label(`${v.fundName.toUpperCase()} · CALL №${v.callNumber}`)}
${h1(`Capital call №${v.callNumber}`, 'margin-top:11px;')}
${paragraph(`This notice calls ${v.callPercent}% of your commitment to ${v.fundName}. The proceeds fund one new investment and the annual management fee, both itemised in the notice in your workspace.`)}
${paragraph(`Payment is due ${v.dueDate}. This is a draw against capital you have already committed, not a new subscription.`, 16)}
${tintBlock('YOUR POSITION', rows, 'table', `Percentages are of your commitment, not of the fund. Figures as at ${v.asAtDate}.`, '#6b6577')}
<div style="margin-top:24px;">${ctaButton('View capital call', v.viewUrl)}</div>
${ctaNote('Signing in shows the itemised notice and the wire details.')}
${securityNote(
    'WIRE INSTRUCTIONS',
    'Bank details are available in your LP workspace and are never sent by email — not in this message, not in an attachment, not on request. Any email that appears to come from us carrying account numbers is fraudulent. Wire from the account you were verified under, using the reference shown in the workspace.',
  )}`;
  const footer = footerFor('transactional', { to: v.to, reason, prefsUrl: v.prefsUrl });
  const html = shell(body, footer, 'CAPITAL CALL');
  const text = `Capital call №${v.callNumber} — ${v.fundName}\n\nAmount due: ${v.amountDueFormatted} by ${v.dueDate}\n\nView: ${v.viewUrl}\n`;
  const subject = `Capital call №${v.callNumber} — ${v.fundName} — due ${v.dueDate}`;
  return { subject, html, text };
}

export interface WeeklyDigestVars {
  to: string;
  weekLabel: string;
  cards: DigestCard[];
  dashboardUrl: string;
  prefsUrl?: string;
  frequencyUrl?: string;
  unsubscribeUrl: string;
}

export function renderWeeklyDigest(v: WeeklyDigestVars) {
  const reason = `Sent to ${v.to} as part of your weekly digest.`;
  const footLinks: FooterLink[] = [];
  if (v.frequencyUrl) footLinks.push({ label: 'Manage frequency', href: v.frequencyUrl });
  footLinks.push({ label: 'Unsubscribe from digests', href: v.unsubscribeUrl, muted: true });
  const body = `${label(`WEEK OF ${v.weekLabel.toUpperCase()}`)}
${h1('Three things from your week', 'margin-top:11px;')}
${paragraph('Nothing here needs action today. It is a summary, and the numbers link back to the surfaces they came from.')}
${digestCards(v.cards)}
<div style="margin-top:24px;">${ctaButton('Open your dashboard', v.dashboardUrl)}</div>`;
  const footer = footerFor('broadcast', {
    to: v.to,
    reason,
    prefsUrl: v.prefsUrl,
    unsubscribeUrl: v.unsubscribeUrl,
    footLinks,
  });
  const html = shell(body, footer, 'WEEKLY DIGEST');
  const text = `Your week (${v.weekLabel})\n\nOpen dashboard: ${v.dashboardUrl}\n`;
  const subject = 'Your week: summary from Axal VC';
  return { subject, html, text };
}

export interface SpinoutDecisionVars {
  to: string;
  companyName: string;
  cohortLabel: string;
  decisionParagraph: string;
  programmeRows: TintRow[];
  checklist: ChecklistChip[];
  onboardingUrl: string;
  acceptDeadline: string;
  prefsUrl?: string;
}

export function renderSpinoutDecision(v: SpinoutDecisionVars) {
  const reason = `Sent to ${v.to} because you applied to the Spin-Out Lab.`;
  const body = `${label('APPLICATION DECISION')}
${h1(`${v.companyName} is in ${v.cohortLabel}`, 'margin-top:11px;')}
${paragraph(v.decisionParagraph)}
${paragraph('Cohort 7 runs twenty-eight days from 28 September and ends with Demo Day on 26 October. It is full-time in practice, if not in name.', 16)}
${tintBlock('THE PROGRAMME', v.programmeRows, 'lav', 'The Spin-Out Lab is one programme inside Axal VC. Your platform account stays as it is.', '#6d28d9')}
${numberedChips('BEFORE 28 SEPTEMBER', v.checklist)}
<div style="margin-top:24px;">${ctaButton('Begin onboarding', v.onboardingUrl)}</div>
${ctaNote(`Five working days to accept · expires ${v.acceptDeadline}`)}`;
  const footer = footerFor('transactional', { to: v.to, reason, prefsUrl: v.prefsUrl });
  const html = shell(body, footer, `SPIN-OUT LAB · ${v.cohortLabel.toUpperCase()}`);
  const text = `You're in — ${v.cohortLabel}\n\nBegin onboarding: ${v.onboardingUrl}\n`;
  const subject = `You're in — Spin-Out Lab ${v.cohortLabel}`;
  return { subject, html, text };
}
