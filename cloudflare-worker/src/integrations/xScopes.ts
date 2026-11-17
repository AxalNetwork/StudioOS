/**
 * D2403 part 2 (#2403): the two consents a founder's own X connection asks for.
 *
 * READ FIRST. "Connect X" asks for the read set only; "Turn on publishing" is a
 * second consent that adds `tweet.write` and `media.write`. The registry lists
 * the union, so `hasScopeOverreach` accepts either grant; the provider refuses a
 * read sign-in that came back with a write scope, and the publish path refuses
 * unless `tweet.write` is among the scopes X actually granted.
 *
 * No side effects and no imports: the registry and the pages may read it.
 */
export const X_READ_SCOPES = Object.freeze(['tweet.read', 'users.read', 'offline.access'] as const);
export const X_WRITE_SCOPES = Object.freeze(['tweet.write', 'media.write'] as const);
export const X_PUBLISH_SCOPES = Object.freeze([...X_READ_SCOPES, ...X_WRITE_SCOPES]);
