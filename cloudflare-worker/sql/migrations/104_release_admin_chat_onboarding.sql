-- Task #24 — Stop showing the onboarding chatbot to admins.
--
-- Releases currently-stuck admins. An account created as a partner (signup
-- seeds an `onboarding_progress` row with flow='chat', completed_at=NULL)
-- and later promoted to admin keeps that lingering incomplete chat row,
-- which the SPA gate uses to pin the user to /onboarding/chat. Mark any
-- such row complete so existing admins are immediately unblocked.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/104_release_admin_chat_onboarding.sql
--
-- Idempotent: re-running only affects rows still flow='chat' /
-- completed_at IS NULL for admin users; a second pass is a no-op.

UPDATE onboarding_progress
SET completed_at = datetime('now'),
    updated_at = datetime('now')
WHERE flow = 'chat'
  AND completed_at IS NULL
  AND user_id IN (SELECT id FROM users WHERE role = 'admin');
