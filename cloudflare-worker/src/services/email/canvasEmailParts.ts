/**
 * Reusable HTML fragments from the Emails canvas (M0 building blocks).
 * Used by persona invites (Set A/B) and transactional templates (M1–M5).
 */
import { escapeHtml as esc } from '../email';
import { SENDER_POSTAL } from './inviteChrome';

const FONT = "Inter,-apple-system,'Segoe UI',Arial,sans-serif";
const MONO = "'Roboto Mono','SFMono-Regular',Consolas,monospace";
const HAIR = '#e8e6ee';
const VT = '#f4f0fe';

export const GP_INVITER = {
  name: 'Guillaume Lauzier',
  title: 'Founder, Managing Partner & GP, Axal VC',
  contact: 'guillaume.lauzier@axal.vc · linkedin.com/in/guillaumelauzier',
  /** Decorative headshot — optional; name/title/contacts are text-only for image blockers. */
  photoUrl: 'https://axal.vc/uploads/guillaume-lauzier.jpg',
} as const;

export function label(text: string, ink = '#6b6577'): string {
  return `<div style="font-family:${MONO};font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.11em;color:${ink};">${esc(text)}</div>`;
}

export function h1(text: string, extraStyle = ''): string {
  return `<h1 style="margin:0;font-size:23px;font-weight:800;letter-spacing:-0.02em;line-height:1.24;color:#241f38;font-family:${FONT};${extraStyle}">${esc(text)}</h1>`;
}

export function paragraph(text: string, top = 16): string {
  return `<p style="margin:${top}px 0 0;font-size:15px;line-height:1.65;color:#332e45;font-family:${FONT};">${esc(text)}</p>`;
}

export function ctaButton(labelText: string, url: string): string {
  return `<a href="${esc(url)}" style="display:block;text-align:center;font-size:15px;font-weight:700;padding:15px 0;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-family:${FONT};">${esc(labelText)}</a>`;
}

export function ctaNote(text: string): string {
  return `<p style="font-size:11px;line-height:1.6;color:#6b6577;margin:11px 0 0;text-align:center;font-family:${FONT};">${esc(text)}</p>`;
}

/** Set A bullet box — purple dot list inside lavender tint. */
export function bulletBox(rows: Array<[string, string]>): string {
  const items = rows.map(([k, v]) =>
    `<tr><td style="padding:0 0 11px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:top;padding-top:6px;padding-right:10px;width:5px;">
  <div style="width:5px;height:5px;border-radius:50%;background:#7c3aed;"></div>
</td>
<td style="vertical-align:top;font-family:${FONT};">
  <span style="font-size:13px;font-weight:700;color:#241f38;">${esc(k)}</span>
  <span style="font-size:12.5px;color:#4a4459;"> — ${esc(v)}</span>
</td>
</tr></table>
</td></tr>`).join('\n');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:${VT};border-radius:11px;">
<tr><td style="padding:18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>
</td></tr></table>`;
}

/** Set B lavender greeting band. */
export function greetingBand(firstName: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:-30px -32px 0;background:${VT};">
<tr><td style="padding:26px 32px 18px;">
<div style="font-size:16px;font-weight:800;letter-spacing:-0.02em;color:#241f38;font-family:${FONT};">Hi ${esc(firstName)},</div>
</td></tr></table>`;
}

export interface InviterBlockOpts {
  /** Set A shows “Invited by” label; Set B omits it. */
  showInvitedBy?: boolean;
  /** Set B carries postal address in the sign-off. */
  includePostal?: boolean;
}

/** Inviter block — identical across Set A and Set B per the canvas. */
export function inviterBlock(opts: InviterBlockOpts = {}): string {
  const invited = opts.showInvitedBy
    ? `${label('Invited by')}<div style="font-family:${MONO};font-size:12.5px;font-weight:700;margin-top:5px;color:#241f38;">${esc(GP_INVITER.name)}</div>`
    : `<div style="font-family:${MONO};font-size:13px;font-weight:700;color:#241f38;">${esc(GP_INVITER.name)}</div>`;
  const postal = opts.includePostal
    ? `<p style="font-size:11px;line-height:1.6;color:#6b6577;margin:10px 0 0;font-family:${FONT};">${esc(SENDER_POSTAL)}</p>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;padding-top:20px;border-top:1px solid ${HAIR};">
<tr><td style="vertical-align:top;padding-right:13px;width:44px;">
  <img src="${esc(GP_INVITER.photoUrl)}" alt="${esc(GP_INVITER.name)}" width="44" height="44" style="width:44px;height:44px;border-radius:50%;display:block;object-fit:cover;" />
</td>
<td style="vertical-align:top;font-family:${FONT};">
${invited}
<div style="font-family:${MONO};font-size:${opts.showInvitedBy ? '11' : '11.5'}px;color:#4a4459;margin-top:3px;">${esc(GP_INVITER.title)}</div>
<div style="font-family:${MONO};font-size:${opts.showInvitedBy ? '10.5' : '11'}px;color:#6b6577;margin-top:${opts.showInvitedBy ? '5' : '6'}px;line-height:1.6;">${esc(GP_INVITER.contact)}</div>
${postal}
</td></tr></table>`;
}

export interface TintRow {
  k: string;
  v: string;
  strong?: boolean;
  warn?: boolean;
  last?: boolean;
}

export type TintStyle = 'lav' | 'table' | 'amber';

export function tintBlock(
  labelText: string,
  rows: TintRow[],
  style: TintStyle,
  foot?: string,
  labelInk = '#6d28d9',
): string {
  const boxStyle = style === 'amber'
    ? `margin-top:18px;padding:16px 18px;background:#fffdf5;border:1px solid #fcd34d;border-radius:11px;`
    : style === 'table'
      ? `margin-top:20px;padding:4px 18px 16px;background:#fff;border:1px solid ${HAIR};border-radius:11px;`
      : `margin-top:18px;padding:16px 18px;background:${VT};border-radius:11px;`;

  const rowHtml = rows.map((r) => {
    const weight = r.strong ? '800' : '500';
    const kInk = r.strong ? '#241f38' : '#4a4459';
    const vInk = r.warn ? '#92400e' : (r.strong ? '#241f38' : '#332e45');
    const border = r.strong
      ? `border-top:1px solid ${HAIR};border-bottom:1px solid ${HAIR};`
      : (r.last ? '' : 'border-bottom:1px solid #f0eef5;');
    return `<tr><td style="padding:11px 0;${border}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:13px;font-weight:${weight};color:${kInk};font-family:${FONT};">${esc(r.k)}</td>
<td align="right" style="font-family:${MONO};font-size:13.5px;font-weight:${weight};color:${vInk};">${esc(r.v)}</td>
</tr></table>
</td></tr>`;
  }).join('\n');

  const footHtml = foot
    ? `<p style="font-size:11px;line-height:1.6;color:#6b6577;margin:12px 0 0;font-family:${FONT};">${esc(foot)}</p>`
    : '';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${boxStyle}">
<tr><td>
${label(labelText, labelInk)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:11px;">${rowHtml}</table>
${footHtml}
</td></tr></table>`;
}

export interface DigestCard {
  kicker: string;
  title: string;
  figure?: string;
  figNote?: string;
  figInk?: string;
  body: string;
  link?: string;
}

export function digestCards(cards: DigestCard[]): string {
  const items = cards.map((c) => {
    const fig = c.figure
      ? `<td align="right" style="vertical-align:top;white-space:nowrap;padding-left:12px;">
<div style="font-family:${MONO};font-size:17px;font-weight:700;letter-spacing:-0.02em;color:${c.figInk || '#6d28d9'};">${esc(c.figure)}</div>
<div style="font-family:${MONO};font-size:10px;color:#6b6577;margin-top:3px;">${esc(c.figNote || '')}</div>
</td>`
      : '';
    const link = c.link
      ? `<div style="font-size:12.5px;font-weight:700;color:#6d28d9;margin-top:10px;font-family:${FONT};">${esc(c.link)} →</div>`
      : '';
    return `<tr><td style="padding:0 0 11px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${HAIR};border-radius:11px;">
<tr><td style="padding:16px 17px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:top;">
${label(c.kicker)}
<div style="font-size:14.5px;font-weight:800;letter-spacing:-0.01em;margin-top:7px;line-height:1.35;color:#241f38;font-family:${FONT};">${esc(c.title)}</div>
</td>${fig}
</tr></table>
<p style="margin:9px 0 0;font-size:12.5px;line-height:1.6;color:#6b6577;font-family:${FONT};">${esc(c.body)}</p>
${link}
</td></tr></table>
</td></tr>`;
  }).join('\n');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">${items}</table>`;
}

export interface ChecklistChip {
  n: string;
  k: string;
  v: string;
}

export function numberedChips(labelText: string, chips: ChecklistChip[]): string {
  const items = chips.map((c) =>
    `<tr><td style="padding:0 0 9px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:top;padding-right:10px;">
<span style="font-family:${MONO};font-size:10px;font-weight:700;color:#6d28d9;background:#fff;border-radius:5px;padding:2px 6px;">${esc(c.n)}</span>
</td>
<td style="vertical-align:top;font-family:${FONT};">
<div style="font-size:13px;font-weight:700;line-height:1.4;color:#241f38;">${esc(c.k)}</div>
<div style="font-size:12px;color:#4a4459;margin-top:3px;line-height:1.5;">${esc(c.v)}</div>
</td></tr></table>
</td></tr>`).join('\n');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;background:${VT};border-radius:11px;">
<tr><td style="padding:16px 18px;">
${label(labelText, '#6d28d9')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:11px;">${items}</table>
</td></tr></table>`;
}

export function securityNote(labelText: string, body: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;padding-top:18px;border-top:1px solid ${HAIR};">
<tr><td>
${label(labelText)}
<p style="font-size:11px;line-height:1.6;color:#6b6577;margin:8px 0 0;font-family:${FONT};">${esc(body)}</p>
</td></tr></table>`;
}
