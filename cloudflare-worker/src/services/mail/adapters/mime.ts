/**
 * D1340 (#3548) — one plain-text RFC 5322 message, for SMTP and Gmail. A header
 * value never carries a line break (`headerSafe` refuses one before a message
 * is built), non-ASCII header text is an RFC 2047 encoded word, and the body is
 * base64 in UTF-8, so no line of it can end the SMTP DATA early.
 */
import type { Outgoing } from './types';

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
export const b64url = (s: string) => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** True when a value can sit in a header: no CR, no LF, no NUL. */
export const headerSafe = (v: string) => !/[\r\n\0]/.test(v);

function word(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`;
}

function mailbox(address: string, name: string | null): string {
  if (!name) return `<${address}>`;
  const shown = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, '')}"` : word(name);
  return `${shown} <${address}>`;
}

export function buildMime(msg: Outgoing, messageId: string, date = new Date()): string {
  const body = b64(msg.body).replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${mailbox(msg.from, msg.fromName)}`,
    `To: <${msg.to}>`,
    `Subject: ${word(msg.subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}
