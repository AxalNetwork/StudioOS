/** D550: quota requests are pending asks, never consent or completed intros. */
export function introTarget(relationship) {
  const other = relationship?.other;
  const id = Number(other?.id);
  if (other?.role === 'founder' && Number.isSafeInteger(id) && id > 0) {
    return { key: `founder_user_id:${id}`, label: other.name || `Founder #${id}`, body: { founder_user_id: id } };
  }
  const projectId = Number(relationship?.project?.id);
  if (Number.isSafeInteger(projectId) && projectId > 0) {
    return { key: `project_id:${projectId}`, label: relationship.project.name || `Project #${projectId}`, body: { project_id: projectId } };
  }
  return null;
}
export function askKey(ask) {
  for (const field of ['founder_user_id', 'project_id', 'founder_id']) {
    if (ask?.[field]) return `${field}:${ask[field]}`;
  }
  return null;
}
export function createIntroRequests(post, publish) {
  const states = {};
  const update = (key, value) => { states[key] = value; publish({ ...states }); };
  return async (target) => {
    if (!target || ['sending', 'pending'].includes(states[target.key]?.status)) return;
    // Synchronous lock also covers two clicks before React renders again, and
    // the same target reached through both its person and organization rows.
    update(target.key, { status: 'sending' });
    try {
      const result = await post(target.body);
      if (result?.ok !== true) throw new Error('The request was not confirmed.');
      update(target.key, { status: 'pending', message: 'Request pending. An ask does not record either person’s consent or mean an introduction has been made.' });
    } catch (error) {
      const code = error?.code || error?.data?.error;
      const message = error?.data?.message || error?.message;
      update(target.key, { status: 'refused', message: code === 'investor_only'
        ? 'Only investor accounts can request an introduction.'
        : message || 'The introduction request could not be read. Check your recorded asks before retrying.' });
    }
  };
}
