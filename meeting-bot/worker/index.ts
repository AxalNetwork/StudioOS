/** Private cross-script DO host. No public HTTP control endpoint. */
export { MeetingBotContainer } from './container';
export default { fetch: () => new Response(null, { status: 404 }) };
