/**
 * Task #2 (IB) — Master registry of every transactional email template.
 *
 * One file per template would burn 42 files of near-identical chrome,
 * so we keep them in a single typed map. Each entry documents its
 * `vars` contract inline above the entry. Call sites use:
 *
 *     await send(env, 'auth_verify_email', user.email, { name, verify_url });
 *
 * Layout chrome (header/footer, unsubscribe link, registered address)
 * lives in `./layout.ts`. Authors of new templates need only supply
 * `subject`, `text`, `html` fragments and the metadata.
 *
 * Reply-To routing per spec:
 *   - `security@axal.vc` — auth_*, account_email_change_*, account_deleted
 *   - `billing@axal.vc`  — billing_*
 *   - `support@axal.vc`  — everything else (contracts, advisor, partner, …)
 */
import type { EmailTemplate } from './layout';

const t = (e: EmailTemplate): EmailTemplate => e;

export const TEMPLATES: Record<string, EmailTemplate> = {

  // ────────────────────────────────────────────────────────── AUTH
  // vars: name, verify_url
  auth_verify_email: t({
    key: 'auth_verify_email', category: 'security', severity: 'info',
    replyTo: 'security@axal.vc', alwaysSend: true,
    subject: 'Verify your email — Axal',
    text: `Hi {{name}},\n\nThanks for signing up for Axal VC. Please verify your email address to continue setting up your account:\n{{verify_url}}\n\nThis link expires in 24 hours. If you didn't create an account, you can safely ignore this email.`,
    html: `<h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">Verify Your Email</h1>
<p style="font-size:14px;color:#6b7280;margin:0 0 24px;line-height:1.6;">Hi {{name}}, thanks for signing up for Axal VC. Please verify your email address to continue setting up your account.</p>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 24px;">
  <a href="{{{verify_url}}}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:16px 28px;border-radius:14px;">Verify Email Address</a>
</td></tr></table>
<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:18px 20px;">
  <p style="margin:0 0 8px;color:#6b7280;font-size:14px;">Or copy and paste this link into your browser:</p>
  <a href="{{{verify_url}}}" style="color:#2563eb;word-break:break-all;font-size:14px;">{{verify_url}}</a>
</div>
<p style="font-size:12px;color:#9ca3af;margin:24px 0 0;line-height:1.6;">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>`,
  }),
  // vars: name, reset_url
  auth_password_reset: t({
    key: 'auth_password_reset', category: 'security', severity: 'warning',
    replyTo: 'security@axal.vc', alwaysSend: true,
    subject: 'Reset your Axal password',
    text: `Hi {{name}},\n\nUse this link to reset your Axal password:\n{{reset_url}}\n\nThe link expires in 30 minutes. If you didn't request a reset, secure your account.`,
    html: `<p>Hi {{name}},</p><p>Use this link to reset your Axal password.</p><p><a href="{{{reset_url}}}" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Reset password</a></p><p style="color:#6b7280;font-size:13px;">Expires in 30 minutes. If you didn't request this, please secure your account.</p>`,
  }),
  // vars: name, magic_url
  auth_magic_link: t({
    key: 'auth_magic_link', category: 'security', severity: 'info',
    replyTo: 'security@axal.vc', alwaysSend: true,
    subject: 'Your Axal sign-in link',
    text: `Hi {{name}},\n\nClick to sign in to Axal:\n{{magic_url}}\n\nThe link expires in 15 minutes and can only be used once.`,
    html: `<p>Hi {{name}},</p><p>Click to sign in to Axal.</p><p><a href="{{{magic_url}}}" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Sign in</a></p><p style="color:#6b7280;font-size:13px;">Expires in 15 minutes. Single use.</p>`,
  }),
  // vars: name, device_name, ip
  auth_passkey_added: t({
    key: 'auth_passkey_added', category: 'security', severity: 'warning',
    replyTo: 'security@axal.vc', alwaysSend: true,
    subject: 'A new passkey was added to your Axal account',
    text: `Hi {{name}},\n\nA new passkey was registered on your Axal account from {{device_name}} (IP {{ip}}).\n\nIf this was you, no action needed. If not, sign in and remove the passkey from Settings → Security immediately.`,
    html: `<p>Hi {{name}},</p><p>A new passkey was registered on your Axal account:</p><p style="background:#f3f4f6;padding:12px 14px;border-radius:8px;font-family:ui-monospace,monospace;font-size:13px;">{{device_name}} · IP {{ip}}</p><p>If this was you, no action needed. If not, sign in and remove the passkey from Settings → Security immediately.</p>`,
  }),
  // vars: name, ip
  auth_totp_added: t({
    key: 'auth_totp_added', category: 'security', severity: 'warning',
    replyTo: 'security@axal.vc', alwaysSend: true,
    subject: 'An authenticator app was added to your Axal account',
    text: `Hi {{name}},\n\nAn authenticator app (TOTP) was just set up on your Axal account (IP {{ip}}).\n\nIf this was you, no action needed. If not, reply to security@axal.vc immediately and sign out all sessions from Settings → Security.`,
    html: `<p>Hi {{name}},</p><p>An authenticator app (TOTP) was just set up on your Axal account:</p><p style="background:#f3f4f6;padding:12px 14px;border-radius:8px;font-family:ui-monospace,monospace;font-size:13px;">IP {{ip}}</p><p>If this was you, no action needed. If not, reply to <a href="mailto:security@axal.vc">security@axal.vc</a> immediately and sign out all sessions from Settings → Security.</p>`,
  }),
  // vars: name, ticket_id
  auth_recovery_started: t({
    key: 'auth_recovery_started', category: 'security', severity: 'warning',
    replyTo: 'security@axal.vc', alwaysSend: true,
    subject: 'Account recovery started — Axal',
    text: `Hi {{name}},\n\nWe received a request to recover access to your Axal account (ticket #{{ticket_id}}). We will email you again once a member of our team has reviewed the request.\n\nIf you didn't start this, reply to security@axal.vc immediately.`,
    html: `<p>Hi {{name}},</p><p>We received a request to recover access to your Axal account (ticket #{{ticket_id}}). We'll email you again once a member of our team has reviewed the request.</p><p style="color:#dc2626;">If you didn't start this, reply to <a href="mailto:security@axal.vc">security@axal.vc</a> immediately.</p>`,
  }),
  // vars: name, ticket_id
  auth_recovery_resolved: t({
    key: 'auth_recovery_resolved', category: 'security', severity: 'info',
    replyTo: 'security@axal.vc', alwaysSend: true,
    subject: 'Account recovery resolved — Axal',
    text: `Hi {{name}},\n\nYour Axal account recovery request (ticket #{{ticket_id}}) has been resolved. Sign in to confirm everything looks correct, and rotate any recovery codes you no longer trust.`,
    html: `<p>Hi {{name}},</p><p>Your account recovery request (ticket #{{ticket_id}}) has been resolved. Sign in to confirm everything looks correct, and rotate any recovery codes you no longer trust.</p>`,
  }),
  // vars: name, device_name, ip, location, when
  auth_signin_new_device: t({
    key: 'auth_signin_new_device', category: 'security', severity: 'warning',
    replyTo: 'security@axal.vc', alwaysSend: true,
    subject: 'New sign-in on your Axal account',
    text: `Hi {{name}},\n\nA new device signed in to your Axal account:\n  Device: {{device_name}}\n  IP: {{ip}}\n  Location: {{location}}\n  When: {{when}}\n\nIf this wasn't you, change your password and sign out everywhere from Settings → Security.`,
    html: `<p>Hi {{name}},</p><p>A new device just signed in to your Axal account:</p><table style="border-collapse:collapse;font-size:13px;color:#374151;"><tr><td style="padding:3px 12px 3px 0;color:#6b7280;">Device</td><td>{{device_name}}</td></tr><tr><td style="padding:3px 12px 3px 0;color:#6b7280;">IP</td><td>{{ip}}</td></tr><tr><td style="padding:3px 12px 3px 0;color:#6b7280;">Location</td><td>{{location}}</td></tr><tr><td style="padding:3px 12px 3px 0;color:#6b7280;">When</td><td>{{when}}</td></tr></table><p style="color:#dc2626;">If this wasn't you, change your password and sign out everywhere from Settings → Security.</p>`,
  }),

  // ────────────────────────────────────────────────────────── ACCOUNT
  // vars: name, dashboard_url
  account_welcome_founder: t({
    key: 'account_welcome_founder', category: 'account', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'Welcome to Axal — your StudioOS is ready',
    text: `Welcome, {{name}}.\n\nYour Axal account is live. Your next steps:\n  • Complete your founder profile\n  • Submit your project for AI scoring\n  • Book office hours with a Studio partner\n\nOpen your dashboard: {{dashboard_url}}`,
    html: `<p>Welcome, {{name}}.</p><p>Your Axal account is live. A few good first moves:</p><ul><li>Complete your founder profile</li><li>Submit your project for AI scoring</li><li>Book office hours with a Studio partner</li></ul><p><a href="{{{dashboard_url}}}" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Open dashboard</a></p>`,
  }),
  // vars: name, dashboard_url
  account_welcome_investor: t({
    key: 'account_welcome_investor', category: 'account', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'Welcome to Axal — investor access',
    text: `Welcome, {{name}}.\n\nYour Axal investor account is live. Browse curated pipeline, place watchlist tags, and request intros from {{dashboard_url}}.`,
    html: `<p>Welcome, {{name}}.</p><p>Your Axal investor account is live. Browse curated pipeline, place watchlist tags, and request intros.</p><p><a href="{{{dashboard_url}}}" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Open investor dashboard</a></p>`,
  }),
  // vars: name, dashboard_url
  account_welcome_advisor: t({
    key: 'account_welcome_advisor', category: 'account', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'Welcome to Axal — advisor access',
    text: `Welcome, {{name}}.\n\nThanks for joining the Axal advisor network. Set your availability and topics from {{dashboard_url}}/advisor.`,
    html: `<p>Welcome, {{name}}.</p><p>Thanks for joining the Axal advisor network. Set your availability and topic tags so founders can book office hours with you.</p><p><a href="{{{dashboard_url}}}/advisor" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Open advisor dashboard</a></p>`,
  }),
  // vars: name, dashboard_url
  account_welcome_partner: t({
    key: 'account_welcome_partner', category: 'account', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'Welcome to Axal — partner access',
    text: `Welcome, {{name}}.\n\nYour Axal partner workspace is live. Configure your mandate, set your deal-flow filters, and review introductions from {{dashboard_url}}.`,
    html: `<p>Welcome, {{name}}.</p><p>Your Axal partner workspace is live. Configure your mandate, set your deal-flow filters, and review introductions.</p><p><a href="{{{dashboard_url}}}" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Open partner dashboard</a></p>`,
  }),
  // vars: name
  account_deleted_confirmation: t({
    key: 'account_deleted_confirmation', category: 'account', severity: 'warning',
    replyTo: 'security@axal.vc', alwaysSend: true,
    subject: 'Your Axal account has been deleted',
    text: `Hi {{name}},\n\nYour Axal account has been deleted. Personally identifying records have been purged or anonymised. If this was a mistake, reply to security@axal.vc within 7 days to request recovery.`,
    html: `<p>Hi {{name}},</p><p>Your Axal account has been deleted. Personally identifying records have been purged or anonymised.</p><p>If this was a mistake, reply to <a href="mailto:security@axal.vc">security@axal.vc</a> within 7 days to request recovery.</p>`,
  }),
  // vars: name, new_email, confirm_url
  account_email_change_confirm: t({
    key: 'account_email_change_confirm', category: 'security', severity: 'warning',
    replyTo: 'security@axal.vc', alwaysSend: true,
    subject: 'Confirm your new Axal email address',
    text: `Hi {{name}},\n\nConfirm this is the email you want to use for Axal:\n{{confirm_url}}\n\nYou'll keep getting mail at the old address until you click to confirm.`,
    html: `<p>Hi {{name}},</p><p>Confirm <strong>{{new_email}}</strong> is the email you want to use for Axal.</p><p><a href="{{{confirm_url}}}" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Confirm new email</a></p>`,
  }),
  // vars: name, revoke_url
  account_email_change_revoke: t({
    key: 'account_email_change_revoke', category: 'security', severity: 'critical',
    replyTo: 'security@axal.vc', alwaysSend: true,
    subject: 'Someone tried to change your Axal email',
    text: `Hi {{name}},\n\nSomeone requested to change the email on your Axal account. If that wasn't you, click to revoke immediately:\n{{revoke_url}}`,
    html: `<p>Hi {{name}},</p><p>Someone requested to change the email on your Axal account.</p><p>If that wasn't you, click to revoke immediately and rotate your password:</p><p><a href="{{{revoke_url}}}" style="display:inline-block;background:#dc2626;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Revoke change</a></p>`,
  }),

  // ────────────────────────────────────────────────────────── BILLING
  // vars: name, plan, manage_url
  billing_subscribed_growth: t({
    key: 'billing_subscribed_growth', category: 'billing', severity: 'info',
    replyTo: 'billing@axal.vc', alwaysSend: true,
    subject: 'Welcome to Axal Growth',
    text: `Hi {{name}},\n\nThanks for upgrading to the Growth plan. Manage your subscription any time at {{manage_url}}.`,
    html: `<p>Hi {{name}},</p><p>Thanks for upgrading to the <strong>Growth</strong> plan. Your tier-gated features (advanced scoring, deck publish, captable sim) are unlocked immediately.</p><p><a href="{{{manage_url}}}" style="color:#111;">Manage subscription</a></p>`,
  }),
  // vars: name, manage_url
  billing_subscribed_studio: t({
    key: 'billing_subscribed_studio', category: 'billing', severity: 'info',
    replyTo: 'billing@axal.vc', alwaysSend: true,
    subject: 'Welcome to Axal Studio',
    text: `Hi {{name}},\n\nWelcome to the Studio plan. Capital, funds, liquidity, KYC, fund-sim, and partner office hours are unlocked. Manage at {{manage_url}}.`,
    html: `<p>Hi {{name}},</p><p>Welcome to the <strong>Studio</strong> plan. Capital, funds, liquidity, KYC, fund-sim, and partner office hours are now unlocked on your account.</p><p><a href="{{{manage_url}}}" style="color:#111;">Manage subscription</a></p>`,
  }),
  // vars: name, manage_url
  billing_subscribed_investor_pro: t({
    key: 'billing_subscribed_investor_pro', category: 'billing', severity: 'info',
    replyTo: 'billing@axal.vc', alwaysSend: true,
    subject: 'Welcome to Investor Pro',
    text: `Hi {{name}},\n\nWelcome to the Investor Pro tier. Pipeline, deals, calendar, and the Market-Intel export are unlocked. Manage at {{manage_url}}.`,
    html: `<p>Hi {{name}},</p><p>Welcome to the <strong>Investor Pro</strong> tier. Pipeline, deals, calendar, and the Market-Intel export are unlocked.</p><p><a href="{{{manage_url}}}" style="color:#111;">Manage subscription</a></p>`,
  }),
  // vars: name, manage_url
  billing_subscribed_investor_inst: t({
    key: 'billing_subscribed_investor_inst', category: 'billing', severity: 'info',
    replyTo: 'billing@axal.vc', alwaysSend: true,
    subject: 'Welcome to Investor Institutional',
    text: `Hi {{name}},\n\nWelcome to the Investor Institutional tier. Co-invest discovery, dealroom Carta-write, LP reporting, and benchmarks are unlocked. Manage at {{manage_url}}.`,
    html: `<p>Hi {{name}},</p><p>Welcome to the <strong>Investor Institutional</strong> tier. Co-invest discovery, dealroom Carta-write, LP reporting, and benchmarks are unlocked.</p><p><a href="{{{manage_url}}}" style="color:#111;">Manage subscription</a></p>`,
  }),
  // vars: name, attempt, retry_at, manage_url
  billing_payment_failed: t({
    key: 'billing_payment_failed', category: 'billing', severity: 'critical',
    replyTo: 'billing@axal.vc', alwaysSend: true,
    subject: 'Payment failed on your Axal subscription',
    text: `Hi {{name}},\n\nWe couldn't charge your card for your Axal subscription (attempt {{attempt}}). We'll retry on {{retry_at}}. To avoid losing access, update your payment method at {{manage_url}}.`,
    html: `<p>Hi {{name}},</p><p>We couldn't charge your card for your Axal subscription (attempt {{attempt}}). We'll retry on <strong>{{retry_at}}</strong>.</p><p>To avoid losing access, update your payment method:</p><p><a href="{{{manage_url}}}" style="display:inline-block;background:#dc2626;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Update payment</a></p>`,
  }),
  // vars: name, plan, end_at
  billing_canceled: t({
    key: 'billing_canceled', category: 'billing', severity: 'info',
    replyTo: 'billing@axal.vc', alwaysSend: true,
    subject: 'Your Axal subscription is canceled',
    text: `Hi {{name}},\n\nYour {{plan}} subscription is canceled. You'll keep access until {{end_at}}, after which your account drops back to the free tier.`,
    html: `<p>Hi {{name}},</p><p>Your <strong>{{plan}}</strong> subscription is canceled. You'll keep access until <strong>{{end_at}}</strong>, after which your account drops back to the free tier.</p>`,
  }),
  // vars: name, invoice_number, amount, currency, paid_at, invoice_url
  billing_invoice_receipt: t({
    key: 'billing_invoice_receipt', category: 'billing', severity: 'info',
    replyTo: 'billing@axal.vc', alwaysSend: true,
    subject: 'Receipt for your Axal payment — {{invoice_number}}',
    text: `Hi {{name}},\n\nReceipt for invoice {{invoice_number}}\n  Amount: {{amount}} {{currency}}\n  Paid at: {{paid_at}}\n\nDownload PDF: {{invoice_url}}`,
    html: `<p>Hi {{name}},</p><p>Receipt for invoice <strong>{{invoice_number}}</strong>.</p><table style="border-collapse:collapse;font-size:13px;color:#374151;"><tr><td style="padding:3px 12px 3px 0;color:#6b7280;">Amount</td><td>{{amount}} {{currency}}</td></tr><tr><td style="padding:3px 12px 3px 0;color:#6b7280;">Paid at</td><td>{{paid_at}}</td></tr></table><p><a href="{{{invoice_url}}}" style="color:#111;">Download PDF receipt</a></p>`,
  }),
  // vars: name, amount, currency, invoice_number, refunded_at
  billing_refund_issued: t({
    key: 'billing_refund_issued', category: 'billing', severity: 'info',
    replyTo: 'billing@axal.vc', alwaysSend: true,
    subject: 'Refund issued for invoice {{invoice_number}}',
    text: `Hi {{name}},\n\nA refund of {{amount}} {{currency}} has been issued against invoice {{invoice_number}} on {{refunded_at}}. It should reach your card within 5–10 business days.`,
    html: `<p>Hi {{name}},</p><p>A refund of <strong>{{amount}} {{currency}}</strong> has been issued against invoice <strong>{{invoice_number}}</strong> on {{refunded_at}}. It should reach your card within 5–10 business days.</p>`,
  }),

  // ────────────────────────────────────────────────────────── CONTRACTS / NDA
  // vars: name, envelope_title, sender_name, sign_url
  contract_envelope_sent: t({
    key: 'contract_envelope_sent', category: 'contract', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: '{{sender_name}} sent you a document to sign',
    text: `Hi {{name}},\n\n{{sender_name}} has sent you "{{envelope_title}}" to review and sign. Open it: {{sign_url}}`,
    html: `<p>Hi {{name}},</p><p><strong>{{sender_name}}</strong> has sent you <strong>{{envelope_title}}</strong> to review and sign.</p><p><a href="{{{sign_url}}}" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Open document</a></p>`,
  }),
  // vars: name, envelope_title, view_url
  contract_envelope_signed: t({
    key: 'contract_envelope_signed', category: 'contract', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: '"{{envelope_title}}" is fully signed',
    text: `Hi {{name}},\n\n"{{envelope_title}}" has been fully signed. Download the executed copy: {{view_url}}`,
    html: `<p>Hi {{name}},</p><p><strong>{{envelope_title}}</strong> has been fully signed.</p><p><a href="{{{view_url}}}" style="color:#111;">Download executed copy</a></p>`,
  }),
  // vars: name, envelope_title, decliner_name, reason
  contract_envelope_declined: t({
    key: 'contract_envelope_declined', category: 'contract', severity: 'warning',
    replyTo: 'support@axal.vc',
    subject: '{{decliner_name}} declined "{{envelope_title}}"',
    text: `Hi {{name}},\n\n{{decliner_name}} declined to sign "{{envelope_title}}". Reason: {{reason}}`,
    html: `<p>Hi {{name}},</p><p><strong>{{decliner_name}}</strong> declined to sign <strong>{{envelope_title}}</strong>.</p><p style="background:#fef2f2;padding:10px 12px;border-radius:8px;font-size:13px;color:#991b1b;">Reason: {{reason}}</p>`,
  }),
  // vars: name, envelope_title, voider_name
  contract_envelope_voided: t({
    key: 'contract_envelope_voided', category: 'contract', severity: 'warning',
    replyTo: 'support@axal.vc',
    subject: '"{{envelope_title}}" has been voided',
    text: `Hi {{name}},\n\n{{voider_name}} voided "{{envelope_title}}". No signatures on it are binding.`,
    html: `<p>Hi {{name}},</p><p><strong>{{voider_name}}</strong> voided <strong>{{envelope_title}}</strong>. No signatures on it are binding.</p>`,
  }),
  // vars: name, requester_name, sign_url
  nda_pairwise_requested: t({
    key: 'nda_pairwise_requested', category: 'contract', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: '{{requester_name}} requested a pairwise NDA',
    text: `Hi {{name}},\n\n{{requester_name}} requested a pairwise NDA before sharing materials. Review and sign: {{sign_url}}`,
    html: `<p>Hi {{name}},</p><p><strong>{{requester_name}}</strong> requested a pairwise NDA before sharing materials with you.</p><p><a href="{{{sign_url}}}" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Review &amp; sign</a></p>`,
  }),
  // vars: name, counterparty_name, view_url
  nda_pairwise_signed: t({
    key: 'nda_pairwise_signed', category: 'contract', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'Pairwise NDA with {{counterparty_name}} is signed',
    text: `Hi {{name}},\n\nYour pairwise NDA with {{counterparty_name}} is fully executed. The shared room is now unlocked: {{view_url}}`,
    html: `<p>Hi {{name}},</p><p>Your pairwise NDA with <strong>{{counterparty_name}}</strong> is fully executed. The shared room is now unlocked.</p><p><a href="{{{view_url}}}" style="color:#111;">Open shared room</a></p>`,
  }),

  // ────────────────────────────────────────────────────────── DUE DILIGENCE
  // vars: name, section_name, project_name, work_url
  dd_section_assigned: t({
    key: 'dd_section_assigned', category: 'dd', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'DD section assigned: {{section_name}}',
    text: `Hi {{name}},\n\nYou've been assigned the {{section_name}} due-diligence section on {{project_name}}. Start: {{work_url}}`,
    html: `<p>Hi {{name}},</p><p>You've been assigned the <strong>{{section_name}}</strong> due-diligence section on <strong>{{project_name}}</strong>.</p><p><a href="{{{work_url}}}" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Start review</a></p>`,
  }),
  // vars: name, section_name, project_name, verdict, view_url
  dd_section_completed: t({
    key: 'dd_section_completed', category: 'dd', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'DD section completed: {{section_name}}',
    text: `Hi {{name}},\n\nThe {{section_name}} section on {{project_name}} is complete. Verdict: {{verdict}}. View: {{view_url}}`,
    html: `<p>Hi {{name}},</p><p>The <strong>{{section_name}}</strong> section on <strong>{{project_name}}</strong> is complete. Verdict: <strong>{{verdict}}</strong>.</p><p><a href="{{{view_url}}}" style="color:#111;">View section</a></p>`,
  }),
  // vars: name, project_name, report_url
  dd_report_ready: t({
    key: 'dd_report_ready', category: 'dd', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'DD report ready: {{project_name}}',
    text: `Hi {{name}},\n\nThe full due-diligence report for {{project_name}} is ready. Download: {{report_url}}`,
    html: `<p>Hi {{name}},</p><p>The full due-diligence report for <strong>{{project_name}}</strong> is ready.</p><p><a href="{{{report_url}}}" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Download report</a></p>`,
  }),

  // ────────────────────────────────────────────────────────── PARTNER / REFERRAL / ADVISOR
  // vars: name, inviter_name, accept_url
  partner_invitation: t({
    key: 'partner_invitation', category: 'partner', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: '{{inviter_name}} invited you to partner with Axal',
    text: `Hi {{name}},\n\n{{inviter_name}} invited you to join Axal as a partner. Accept: {{accept_url}}`,
    html: `<p>Hi {{name}},</p><p><strong>{{inviter_name}}</strong> invited you to join Axal as a partner.</p><p><a href="{{{accept_url}}}" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Accept invitation</a></p>`,
  }),
  // vars: name, deal_title, founder_name, view_url
  partner_deal_signed: t({
    key: 'partner_deal_signed', category: 'partner', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'A partner deal you sourced is signed: {{deal_title}}',
    text: `Hi {{name}},\n\n{{founder_name}} signed the deal "{{deal_title}}" — you'll see the rev-share window open shortly. View: {{view_url}}`,
    html: `<p>Hi {{name}},</p><p><strong>{{founder_name}}</strong> signed the deal <strong>{{deal_title}}</strong> — you'll see the rev-share window open shortly.</p><p><a href="{{{view_url}}}" style="color:#111;">View deal</a></p>`,
  }),
  // vars: name, referrer_name, signup_url
  referral_invitation: t({
    key: 'referral_invitation', category: 'partner', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: '{{referrer_name}} invited you to Axal',
    text: `Hi {{name}},\n\n{{referrer_name}} invited you to join Axal. Sign up here — they'll be credited automatically: {{signup_url}}`,
    html: `<p>Hi {{name}},</p><p><strong>{{referrer_name}}</strong> invited you to join Axal.</p><p><a href="{{{signup_url}}}" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Accept &amp; sign up</a></p>`,
  }),
  // vars: name, amount, currency, payout_id, paid_at
  referral_payout_paid: t({
    key: 'referral_payout_paid', category: 'billing', severity: 'info',
    replyTo: 'billing@axal.vc', alwaysSend: true,
    subject: 'Referral payout sent — {{amount}} {{currency}}',
    text: `Hi {{name}},\n\nA referral payout of {{amount}} {{currency}} was sent to your connected Stripe account on {{paid_at}}. Reference: {{payout_id}}`,
    html: `<p>Hi {{name}},</p><p>A referral payout of <strong>{{amount}} {{currency}}</strong> was sent to your connected Stripe account on {{paid_at}}.</p><p style="font-family:ui-monospace,monospace;font-size:12px;color:#6b7280;">Reference: {{payout_id}}</p>`,
  }),
  // vars: name, advisor_name, start_time, join_url
  advisor_session_booked: t({
    key: 'advisor_session_booked', category: 'advisor', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'Booking with {{advisor_name}}',
    text: `Hi {{name}},\n\nYour session with {{advisor_name}} is booked.\n\nWhen: {{start_time}}\n\nJoin / manage: {{join_url}}\n\nAdd to your calendar from the scheduler page — we'll send a reminder before the session.`,
    html: `<h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">Session confirmed</h1>
<p style="font-size:14px;color:#6b7280;margin:0 0 20px;line-height:1.6;">Hi {{name}}, your session with <strong style="color:#111827;">{{advisor_name}}</strong> is booked.</p>
<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:14px;padding:18px 20px;margin:0 0 24px;">
  <table cellpadding="0" cellspacing="0" style="width:100%;">
    <tr><td style="padding:0 0 10px;vertical-align:top;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#7c3aed;font-weight:600;margin:0 0 4px;">With</div>
      <div style="font-size:15px;color:#111827;font-weight:600;">{{advisor_name}}</div>
    </td></tr>
    <tr><td style="padding:6px 0 0;vertical-align:top;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#7c3aed;font-weight:600;margin:0 0 4px;">When</div>
      <div style="font-size:15px;color:#111827;font-weight:600;">{{start_time}}</div>
    </td></tr>
  </table>
</div>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 0 24px;">
  <a href="{{{join_url}}}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:16px 28px;border-radius:14px;">Open scheduler</a>
</td></tr></table>
<p style="font-size:13px;color:#6b7280;margin:0;line-height:1.6;">You can add this session to your calendar from the scheduler page. We'll send a reminder before it starts.</p>`,
  }),
  // vars: name, advisor_name, start_time, reason
  advisor_session_canceled: t({
    key: 'advisor_session_canceled', category: 'advisor', severity: 'warning',
    replyTo: 'support@axal.vc',
    subject: 'Advisor session with {{advisor_name}} canceled',
    text: `Hi {{name}},\n\nThe session with {{advisor_name}} scheduled for {{start_time}} was canceled.\n\nReason: {{reason}}`,
    html: `<h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">Session canceled</h1>
<p style="font-size:14px;color:#6b7280;margin:0 0 20px;line-height:1.6;">Hi {{name}}, the session with <strong style="color:#111827;">{{advisor_name}}</strong> scheduled for <strong style="color:#111827;">{{start_time}}</strong> was canceled.</p>
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:14px;padding:14px 18px;color:#991b1b;font-size:14px;line-height:1.55;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;margin:0 0 4px;">Reason</div>
  {{reason}}
</div>`,
  }),

  // ────────────────────────────────────────────────────────── SPINOUT
  // vars: name, milestone_name, lab_url
  spinout_milestone_unlocked: t({
    key: 'spinout_milestone_unlocked', category: 'spinout', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'Milestone unlocked: {{milestone_name}}',
    text: `Hi {{name}},\n\nYou just unlocked "{{milestone_name}}" in the Spin-Out Lab. Open the next step: {{lab_url}}`,
    html: `<p>Hi {{name}},</p><p>You just unlocked <strong>{{milestone_name}}</strong> in the Spin-Out Lab.</p><p><a href="{{{lab_url}}}" style="display:inline-block;background:#111;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Next step</a></p>`,
  }),
  // Task #7 — cohort admission. vars: name, cohort_label, lab_url
  spinout_admitted: t({
    key: 'spinout_admitted', category: 'spinout', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: "You're in — welcome to the Spin-Out Lab ({{cohort_label}})",
    text: `Hi {{name}},\n\nCongratulations — you've been admitted to the Spin-Out Lab ({{cohort_label}}).\n\nOver the next 28 days you'll go from idea to incorporated: customer discovery, MVP scope, venture-readiness scoring, and Delaware C-Corp formation — with advisors and warm investor introductions along the way.\n\nStart Week 1 here:\n{{lab_url}}\n\nSee you inside,\nThe Axal team`,
    html: `<h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">You're in 🎉</h1>
<p style="font-size:14px;color:#6b7280;margin:0 0 20px;line-height:1.6;">Hi {{name}}, congratulations — you've been admitted to the <strong style="color:#111827;">Spin-Out Lab</strong> ({{cohort_label}}).</p>
<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:14px;padding:18px 20px;margin:0 0 24px;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#7c3aed;font-weight:600;margin:0 0 6px;">The next 28 days</div>
  <div style="font-size:14px;color:#111827;line-height:1.6;">Idea → customer discovery → MVP scope → venture-readiness score → Delaware C-Corp → warm investor introductions.</div>
</div>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 0 24px;">
  <a href="{{{lab_url}}}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:16px 28px;border-radius:14px;">Start Week 1</a>
</td></tr></table>
<p style="font-size:13px;color:#6b7280;margin:0;line-height:1.6;">Sign in with this email address and you'll land straight in your founder workspace.</p>`,
  }),
  // Cohort application confirmation. vars: name, company_name, cohort_label
  spinout_application_received: t({
    key: 'spinout_application_received', category: 'spinout', severity: 'info',
    replyTo: 'support@axal.vc', alwaysSend: true,
    subject: 'Application received — Spin-Out Lab ({{cohort_label}})',
    text: `Hi {{name}},\n\nWe've received your Spin-Out Lab application for {{company_name}} ({{cohort_label}}).\n\nWhat happens next:\n1. Application review — a program manager reviews within 5 business days.\n2. Founder interview — a 30-minute call to align on scope and readiness.\n3. Cohort onboarding — accepted founders start at the Validate gate on day one.\n\nNo equity taken by Axal VC. Acceptance is selective.\n\nThe Axal team`,
    html: `<h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">Application received</h1>
<p style="font-size:14px;color:#6b7280;margin:0 0 20px;line-height:1.6;">Hi {{name}}, we've received your <strong style="color:#111827;">Spin-Out Lab</strong> application for <strong style="color:#111827;">{{company_name}}</strong> ({{cohort_label}}).</p>
<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:14px;padding:18px 20px;margin:0 0 24px;">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#7c3aed;font-weight:600;margin:0 0 10px;">What happens next</div>
  <div style="font-size:14px;color:#111827;line-height:1.8;">1. <strong>Application review</strong> — a program manager reviews within 5 business days.<br/>2. <strong>Founder interview</strong> — a 30-minute call to align on scope and readiness.<br/>3. <strong>Cohort onboarding</strong> — accepted founders start at the Validate gate on day one.</div>
</div>
<p style="font-size:13px;color:#6b7280;margin:0;line-height:1.6;">No equity taken by Axal VC. Acceptance is selective.</p>`,
  }),
  // Cohort application refusal. vars: name, company_name, cohort_label, next_cohort_label, apply_url
  spinout_refused: t({
    key: 'spinout_refused', category: 'spinout', severity: 'info',
    replyTo: 'support@axal.vc', alwaysSend: true,
    subject: 'Your Spin-Out Lab application — {{cohort_label}}',
    text: `Hi {{name}},\n\nThank you for applying to the Spin-Out Lab ({{cohort_label}}) with {{company_name}}. After careful review, we weren't able to offer you a spot in this cohort — spots are limited and acceptance is selective.\n\nThis is not the end of the road. Founders often strengthen their idea and get in on the next try. We'd love to see you re-apply for {{next_cohort_label}}:\n{{apply_url}}\n\nKeep building,\nThe Axal team`,
    html: `<h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">About your application</h1>
<p style="font-size:14px;color:#6b7280;margin:0 0 20px;line-height:1.6;">Hi {{name}}, thank you for applying to the <strong style="color:#111827;">Spin-Out Lab</strong> ({{cohort_label}}) with <strong style="color:#111827;">{{company_name}}</strong>. After careful review, we weren't able to offer you a spot in this cohort — spots are limited and acceptance is selective.</p>
<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:14px;padding:18px 20px;margin:0 0 24px;">
  <div style="font-size:14px;color:#111827;line-height:1.6;">This is not the end of the road — founders often strengthen their idea and get in on the next try. We'd love to see you re-apply for <strong>{{next_cohort_label}}</strong>.</div>
</div>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 0 24px;">
  <a href="{{{apply_url}}}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:16px 28px;border-radius:14px;">Re-apply for {{next_cohort_label}}</a>
</td></tr></table>
<p style="font-size:13px;color:#6b7280;margin:0;line-height:1.6;">Keep building — the Axal team.</p>`,
  }),
  // vars: name, dashboard_url
  spinout_graduated: t({
    key: 'spinout_graduated', category: 'spinout', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'You graduated the Spin-Out Lab',
    text: `Hi {{name}},\n\nCongrats — you graduated the Spin-Out Lab. Your StudioOS now has the full founder feature set. Open: {{dashboard_url}}`,
    html: `<p>Hi {{name}},</p><p>Congratulations — you graduated the <strong>Spin-Out Lab</strong>. Your StudioOS now has the full founder feature set.</p><p><a href="{{{dashboard_url}}}" style="color:#111;">Open dashboard</a></p>`,
  }),

  // ────────────────────────────────────────────────────────── DIGESTS + FORMS
  // vars: name, items (array rendered as HTML/text by caller), period
  daily_digest: t({
    key: 'daily_digest', category: 'marketing', severity: 'info',
    replyTo: 'support@axal.vc', marketing: true,
    subject: 'Your daily Axal digest',
    text: `Hi {{name}},\n\nHere's what happened in your Axal in the last 24 hours:\n\n{{items}}`,
    html: `<p>Hi {{name}},</p><p>Here's what happened in your Axal in the last 24 hours:</p>{{{items}}}`,
  }),
  // vars: name, items, period
  weekly_digest: t({
    key: 'weekly_digest', category: 'marketing', severity: 'info',
    replyTo: 'support@axal.vc', marketing: true,
    subject: 'Your weekly Axal digest',
    text: `Hi {{name}},\n\nHere's the week in your Axal:\n\n{{items}}`,
    html: `<p>Hi {{name}},</p><p>Here's the week in your Axal:</p>{{{items}}}`,
  }),
  // Task #5 — Waitlist CRM outreach. Recipients are waitlist signups, NOT
  // platform users, so there is no users.id to build the HMAC one-click
  // unsubscribe URL from. We therefore set category 'marketing' (inbox
  // routing / Reply-To) but deliberately leave `marketing` UNSET — the
  // List-Unsubscribe header would carry a null URL otherwise. Opt-out is
  // offered in-body via a plain reply-to line (these are solicited: the
  // recipient explicitly joined the product waitlist).
  // vars: name, product_name, founder_name, cta_url
  waitlist_product_invitation: t({
    key: 'waitlist_product_invitation', category: 'marketing', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: "You're invited to try {{product_name}}",
    text: `Hi {{name}},\n\nThanks for joining the {{product_name}} waitlist — we'd love for you to be one of the first to try it.\n\nGet started here:\n{{cta_url}}\n\nIf you have any questions, just reply to this email.\n\n— {{founder_name}}\n\nYou're receiving this because you joined the {{product_name}} waitlist. Reply to this email if you'd prefer not to hear from us.`,
    html: `<p style="margin:0 0 16px;">Hi {{name}},</p>
<p style="margin:0 0 16px;">Thanks for joining the <strong>{{product_name}}</strong> waitlist — we'd love for you to be one of the first to try it.</p>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 24px;">
  <a href="{{{cta_url}}}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:16px 28px;border-radius:14px;">Get started</a>
</td></tr></table>
<p style="margin:0 0 16px;">If you have any questions, just reply to this email.</p>
<p style="margin:0 0 4px;">— {{founder_name}}</p>
<p style="font-size:12px;color:#9ca3af;margin:24px 0 0;line-height:1.6;">You're receiving this because you joined the {{product_name}} waitlist. Reply to this email if you'd prefer not to hear from us.</p>`,
  }),
  // vars: name, product_name, founder_name, cta_url
  waitlist_follow_up: t({
    key: 'waitlist_follow_up', category: 'marketing', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'Following up from {{product_name}}',
    text: `Hi {{name}},\n\nJust circling back from the {{product_name}} team — we wanted to check in and see if you're still interested in getting early access.\n\nTake a look here:\n{{cta_url}}\n\nHappy to answer anything — just reply to this email.\n\n— {{founder_name}}\n\nYou're receiving this because you joined the {{product_name}} waitlist. Reply to this email if you'd prefer not to hear from us.`,
    html: `<p style="margin:0 0 16px;">Hi {{name}},</p>
<p style="margin:0 0 16px;">Just circling back from the <strong>{{product_name}}</strong> team — we wanted to check in and see if you're still interested in getting early access.</p>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 24px;">
  <a href="{{{cta_url}}}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:16px 28px;border-radius:14px;">Take a look</a>
</td></tr></table>
<p style="margin:0 0 16px;">Happy to answer anything — just reply to this email.</p>
<p style="margin:0 0 4px;">— {{founder_name}}</p>
<p style="font-size:12px;color:#9ca3af;margin:24px 0 0;line-height:1.6;">You're receiving this because you joined the {{product_name}} waitlist. Reply to this email if you'd prefer not to hear from us.</p>`,
  }),
  // vars: name, message_preview, ticket_id
  contact_form_acknowledgement: t({
    key: 'contact_form_acknowledgement', category: 'system', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'We received your message (#{{ticket_id}})',
    text: `Hi {{name}},\n\nWe received your message and will reply within 1 business day.\n\n— Your note —\n{{message_preview}}`,
    html: `<p>Hi {{name}},</p><p>We received your message (ticket #{{ticket_id}}) and will reply within 1 business day.</p><blockquote style="margin:0;padding:10px 14px;border-left:3px solid #e5e7eb;color:#374151;background:#f9fafb;font-size:14px;">{{message_preview}}</blockquote>`,
  }),
  // vars: name, ticket_id, subject_line
  support_form_acknowledgement: t({
    key: 'support_form_acknowledgement', category: 'system', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'Support ticket opened — #{{ticket_id}}',
    text: `Hi {{name}},\n\nYour support ticket "#{{ticket_id}} — {{subject_line}}" is open. A team member will follow up shortly.`,
    html: `<p>Hi {{name}},</p><p>Your support ticket <strong>#{{ticket_id}} — {{subject_line}}</strong> is open. A team member will follow up shortly.</p>`,
  }),
  // vars: name, issue_title, reply_preview, issue_url
  github_issue_replied: t({
    key: 'github_issue_replied', category: 'system', severity: 'info',
    replyTo: 'support@axal.vc',
    subject: 'New reply on your GitHub issue: {{issue_title}}',
    text: `Hi {{name}},\n\nA new reply was posted on your GitHub issue "{{issue_title}}":\n{{reply_preview}}\n\nOpen: {{issue_url}}`,
    html: `<p>Hi {{name}},</p><p>A new reply was posted on your GitHub issue <strong>{{issue_title}}</strong>:</p><blockquote style="margin:0;padding:10px 14px;border-left:3px solid #e5e7eb;color:#374151;background:#f9fafb;font-size:14px;">{{reply_preview}}</blockquote><p><a href="{{{issue_url}}}" style="color:#111;">Open issue</a></p>`,
  }),
};

export type TemplateKey = keyof typeof TEMPLATES;

export function getTemplate(key: string): EmailTemplate | null {
  return (TEMPLATES as Record<string, EmailTemplate>)[key] || null;
}
