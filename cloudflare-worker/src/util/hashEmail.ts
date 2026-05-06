// T22.1 / Epic 11 — One-way SHA-256 hash of an email, truncated to 16 hex
// chars (64 bits — enough collision-resistance for activity log
// correlation while keeping the row narrow). Lowercased + trimmed so the
// same email hashes consistently regardless of casing.
//
// Used as the `actor` value in activity_logs for any event where storing
// the plaintext email would constitute PII bleed (register, login,
// email_verified, referral, admin_* actions). user_id remains the join
// key for support workflows.
export async function hashEmail(email: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(String(email || '').toLowerCase().trim()),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}
