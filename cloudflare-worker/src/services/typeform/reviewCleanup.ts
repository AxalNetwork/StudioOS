/** D5829: retract derived evidence before removing a source answer. Tombstones survive imports. */
import type { Env } from '../../types';

export function retractTypeformReviews(env: Env, answerIds: number[]) {
  if (!answerIds.length) return [];
  const ids = JSON.stringify(answerIds);
  return [
    env.DB.prepare(`DELETE FROM hypothesis_evidence_links WHERE kind = 'signal' AND ref_id IN
      (SELECT 'signal-' || signal_id FROM typeform_reviews WHERE answer_id IN (SELECT value FROM json_each(?)))`).bind(ids),
    env.DB.prepare(`DELETE FROM demand_signals WHERE id IN
      (SELECT signal_id FROM typeform_reviews WHERE answer_id IN (SELECT value FROM json_each(?)))`).bind(ids),
    env.DB.prepare(`UPDATE typeform_reviews SET status = 'withdrawn', signal_id = NULL, answer_id = NULL
      WHERE answer_id IN (SELECT value FROM json_each(?))`).bind(ids),
  ];
}
