/**
 * D9071 (#9071): the words of the people-first Organizations directory (D7680, NPO-01, NPO-03, NPO-04, NPO-10,
 * NPO-15), pure so a test can hold them.
 *
 * A FIRM IS NOT A FUND (NPO-04). The member projection of an organization carries no type: nothing says whether
 * it is a firm, a fund manager or a fund vehicle. So every organization reads "Type not recorded", and no word on
 * these pages calls one a fund. Source categories are the source's own words and are not drawn as a type.
 */

const fmt = (n) => Number(n).toLocaleString('en-US');

/** The type line for every organization: the directory records none, so none is claimed. */
export const TYPE_NOT_RECORDED = 'Type not recorded';
export const TYPE_REASON = 'The directory does not record whether this is a firm or a fund vehicle, so it is shown as neither.';

/**
 * "3 people · 2 current · 1 former" from the Worker's distinct-person count. `undefined` (not yet read) reads
 * "Counting…", `null` (the read failed, or the Worker left the organization out) reads "Unavailable", and a
 * count of 0 is the organization-only state, "No people recorded", never a bare 0.
 */
export function peopleLine(c) {
  if (c === undefined) return { state: 'loading', text: 'Counting…' };
  if (c === null || typeof c !== 'object' || !Number.isFinite(Number(c.people))) return { state: 'unavailable', text: 'Unavailable · people could not be counted' };
  if (Number(c.people) === 0) return { state: 'none', text: '○ No people recorded' };
  const parts = [`${fmt(c.people)} ${Number(c.people) === 1 ? 'person' : 'people'}`];
  if (c.current) parts.push(`${fmt(c.current)} current`);
  if (c.former) parts.push(`${fmt(c.former)} former`);
  if (c.unknown) parts.push(`${fmt(c.unknown)} status not recorded`);
  return { state: 'value', text: parts.join(' · ') };
}

/**
 * The people on an organization, one row per distinct person, with the status the Worker counts by: current if
 * any affiliation there is current, else former if any is former, else status not recorded.
 */
export function peopleAt(affiliations = []) {
  const by = new Map();
  for (const a of affiliations || []) {
    const uid = a?.person?.uid;
    if (!uid) continue;
    const prev = by.get(uid);
    const rank = (s) => (s === 'current' ? 2 : s === 'former' ? 1 : 0);
    if (!prev || rank(a.current) > rank(prev.current)) by.set(uid, a);
  }
  return [...by.values()].sort((x, y) => String(x.person.name).localeCompare(String(y.person.name)) || String(x.person.uid).localeCompare(String(y.person.uid)));
}

/** The status filter on an organization's people (NPO-03): all, current, former, status not recorded. */
export const STATUS_FILTERS = Object.freeze([
  ['all', 'All'], ['current', '● Current'], ['former', '○ Former'], ['unknown', '? Status not recorded'],
]);

export const filterPeople = (rows, status) => (status && status !== 'all' ? rows.filter((r) => (r.current || 'unknown') === status) : rows);

/** The organization's own address, keeping the list's search and page so Back lands where the reader was. */
export const orgPath = (uid, search = '') => `/network/organizations/${encodeURIComponent(uid)}${search || ''}`;

/** A person opened from an organization: the same sheet, with the organization as context. */
export const orgPersonPath = (orgUid, personUid, search = '') => `/network/organizations/${encodeURIComponent(orgUid)}/people/${encodeURIComponent(personUid)}${search || ''}`;

/** The same words for an organization that is unpublished, withdrawn, a person, or unknown. */
export const ORG_NOT_AVAILABLE = 'This organization is not available to you.';
