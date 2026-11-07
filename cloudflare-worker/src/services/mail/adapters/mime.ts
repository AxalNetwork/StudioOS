/**
 * D1340 (#3548) — one plain-text RFC 5322 message, for SMTP and Gmail. A header
 * value never carries a line break (`headerSafe` refuses one before a message
 * is built), non-ASCII header text is an RFC 2047 encoded word, and the body is
 * base64 in UTF-8, so no line of it can end the SMTP DATA early. D4493: an
 * attachment makes it multipart/mixed, each part base64 the same way.
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

export const bytesB64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const lines = (v: string) => v.replace(/.{1,76}/g, '$&\r\n');

export function buildMime(msg: Outgoing, messageId: string, date = new Date()): string {
  const body = lines(b64(msg.body));
  const head = [
    `From: ${mailbox(msg.from, msg.fromName)}`,
    `To: <${msg.to}>`,
    `Subject: ${word(msg.subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
  ];
  if (!msg.attachments?.length) return [...head, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body].join('\r\n');
  const boundary = `axal-${crypto.randomUUID().replace(/-/g, '')}`;
  const parts = msg.attachments.map((a) => [
    `--${boundary}`,
    `Content-Type: ${a.mime}; name="${a.filename.replace(/[^A-Za-z0-9._-]/g, '')}"`,
    `Content-Disposition: attachment; filename="${a.filename.replace(/[^A-Za-z0-9._-]/g, '')}"`,
    'Content-Transfer-Encoding: base64',
    '',
    lines(bytesB64(a.bytes)),
  ].join('\r\n'));
  return [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body,
    ...parts, `--${boundary}--`, ''].join('\r\n');
}
