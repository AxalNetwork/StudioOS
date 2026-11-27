/** D4478: honest lesson position and completion availability, independent of rendering. */
export function lessonPositionLine({ index, total, moduleTitle } = {}) {
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(total) || total < 1 || index >= total) return null;
  const module = typeof moduleTitle === 'string' ? moduleTitle.trim() : '';
  return `Lesson ${index + 1} of ${total}${module ? ` in ${module}` : ''}`;
}

export function markCompleteReason({ marking, hasBody, hasHandler } = {}) {
  if (marking) return 'Saving';
  return hasBody && hasHandler ? null : 'Nothing to complete yet';
}

/** An empty or absent reading has nothing to mark complete. */
export const hasLessonBody = (item) => Boolean(item) && (item.kind !== 'reading' || (typeof item.body === 'string' && Boolean(item.body.trim())));

/** Only the route's refusal payload may supply displayed save-error words. */
export function progressRefusal(error) {
  const data = error?.data;
  const choices = [data?.message, data?.error?.message, data?.detail?.message, data?.detail];
  return choices.find((value) => typeof value === 'string' && value.trim()) || 'Your progress could not be saved.';
}
