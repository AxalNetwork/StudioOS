/**
 * D940, canvas SHL7b: who is told an `/admin` page is not theirs, and the
 * words. Pure, so `App.jsx` can read the roles without loading the card.
 *
 * `pending` is not here: `RequireAuth` pins it to onboarding.
 */
export const ADMIN_BOUNDARY_ROLES = new Set(['founder', 'partner', 'investor', 'advisor', 'exploring']);

export const ADMIN_BOUNDARY = {
  title: 'This page is for studio admins',
  line: 'If you run a studio, ask HQ for admin access.',
  action: 'Go to your home',
};
