import { bucketForPath } from '../workspaces/shellConfig';

/**
 * Is this page a workspace ROOT, where the model is chosen, or a zone UNDER
 * one, where it is inherited? (D402)
 *
 * The Validate canvas settles the rule in its own rail block: "Inherited from
 * Validate — Mode and model are chosen on the workspace, not re-picked here."
 * DetailRail and EmberRail draw the same thing on every zone page: a dashed
 * "Inherited from {workspace}" card, an INHERITED chip, and "Change the model
 * there and this page follows". The STORE already behaves that way — the
 * choice is keyed per workspace (`worker_rail_model:<workspace>`), so a zone
 * reads the same key as its root. What was wrong was the screen: every zone
 * drew the full menu, so a founder could "change the model for Interviews"
 * and change it for all of Validate without being told.
 *
 * WORKED OUT FROM ROLE AND URL, NOT PASSED BY THE PAGE. Seventy pages mount
 * the rail, and the shell config already knows every bucket's prefix per role
 * (`workspaces/shellConfig.js`). A page cannot forget to pass a flag that
 * nobody has to pass.
 *
 *   - the bucket root itself (`/validate`)          → null: the root chooses
 *   - anything below it (`/validate/interviews`,
 *     `/raise/data-room/…`)                          → inherited from the root
 *   - a path no bucket of this role claims, or a
 *     role with no shell (the two admin tiers)       → null: no workspace to
 *                                                      inherit from, so the
 *                                                      rail keeps its menu
 *
 * Returns `{ to, bucket }`: the root's path, for the "change it there" link,
 * and the bucket's own label.
 */
export function railInheritance(role, pathname) {
  // No trailing-slash strip: `/validate/` slices to an empty rest below and
  // is the root either way (a mutation that removed a strip here changed
  // nothing, so the strip went).
  const path = String(pathname || '');
  const bucket = bucketForPath(role, path);
  if (!bucket) return null;
  const rest = path.slice(bucket.prefix.length).replace(/^\/+/, '');
  if (!rest) return null;
  return { to: bucket.prefix, bucket: bucket.label };
}
