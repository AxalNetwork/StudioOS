/**
 * D8529 (#8529) — the visual server's outbox: the Worker's mailer runs as in production, and its two Gmail calls
 * are answered here, so a message is recorded instead of sent. Nothing leaves 127.0.0.1.
 *
 * `installOutbox()` returns the credentials the mailer checks for (made up: no Google account is involved) and the
 * recorded messages: `{ to, subject, text, links }`, `links` being every `http(s)://…` URL in the decoded body.
 * Matched by exact hostname, as `company_invitations.test.ts` does: a substring match would answer requests it was
 * never meant to.
 */
const GMAIL_TOKEN_HOST = 'oauth2.googleapis.com';
const GMAIL_SEND_HOST = 'gmail.googleapis.com';

export type OutboxMessage = { to: string; subject: string; text: string; links: string[] };

const fromB64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/** The raw message, with every base64 part decoded, as one text. */
function decodeRaw(raw: string): { to: string; subject: string; text: string } {
  const message = fromB64(raw);
  const to = (/^To: (.*)$/mi.exec(message)?.[1] ?? '').trim();
  const subject = (/^Subject: (.*)$/mi.exec(message)?.[1] ?? '').trim();
  const parts = message.split(/\r?\n\r?\n/).map((chunk) => {
    const flat = chunk.replace(/\s+/g, '');
    if (/^[A-Za-z0-9+/=]{24,}$/.test(flat)) { try { return Buffer.from(flat, 'base64').toString('utf8'); } catch { return chunk; } }
    return chunk;
  });
  return { to, subject, text: parts.join('\n') };
}

export function installOutbox() {
  const outbox: OutboxMessage[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const href = String(input?.url ?? input);
    let host = '';
    try { host = new URL(href).hostname; } catch { /* not a URL: pass it through */ }
    if (host === GMAIL_TOKEN_HOST) return new Response(JSON.stringify({ access_token: 'synthetic-outbox' }), { status: 200 });
    if (host === GMAIL_SEND_HOST) {
      const body = typeof init?.body === 'string' ? init.body : '';
      let raw = '';
      try { raw = JSON.parse(body).raw ?? ''; } catch { /* not the send shape */ }
      const m = decodeRaw(raw);
      outbox.push({ ...m, links: [...new Set(m.text.match(/https?:\/\/[^\s"'<>)]+/g) ?? [])] });
      return new Response(JSON.stringify({ id: `synthetic-${outbox.length}` }), { status: 200 });
    }
    return real(input, init);
  }) as typeof fetch;
  return {
    outbox,
    env: { GMAIL_CLIENT_ID: 'synthetic-outbox', GMAIL_CLIENT_SECRET: 'synthetic-outbox', GMAIL_REFRESH_TOKEN: 'synthetic-outbox' },
  };
}
