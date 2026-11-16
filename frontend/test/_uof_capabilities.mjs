/**
 * D5074 slice 5 (#5074): Use of funds' plan read `capabilities`, as the Worker computes them
 * (`cloudflare-worker/src/services/useOfFunds/capabilities.ts`), for the frontend fixtures.
 * `cloudflare-worker/test/uof_capabilities_5074.test.ts` pins this mirror to the Worker's own function.
 */
export const UOF_CAPABILITIES = ['edit', 'mercury', 'admin_logged'];

/** The Worker's map for a standing: `admin`, `founderAccount` (the venture's founder), `support` (a support session). */
export function uofCapabilities({ admin = false, founderAccount = false, support = false } = {}) {
  return { edit: !support, mercury: founderAccount && !support && !admin, admin_logged: admin };
}

/**
 * The map the Worker sends the viewer a fixture describes in the page's old words (`kind`, `can_write`, `mercury`):
 * an admin, a support session when it may not write, the founder when it reads Mercury.
 */
export const capsForViewer = ({ kind = 'founder', can_write = true, mercury = true } = {}) =>
  uofCapabilities({ admin: kind === 'admin', support: !can_write, founderAccount: kind !== 'admin' && mercury });
