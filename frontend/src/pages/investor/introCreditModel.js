/** Spendable introduction credits and counterpart words from the existing read (#6262). */
export function introCreditView(credits, { unreadable = false, loading = false } = {}) {
  if (unreadable) return { canAccept: false, label: 'Could not be read', reason: 'Accept is turned off until the balance loads. Decline remains available.' };
  if (loading) return { canAccept: false, label: 'Reading credits…', reason: 'Accept is turned off until the balance loads. Decline remains available.' };
  const balance = credits?.balance;
  if (!Number.isSafeInteger(balance) || balance < 0) return introCreditView(null, { unreadable: true });
  return { canAccept: balance >= 1, label: `${balance} ${balance === 1 ? 'credit' : 'credits'} available`,
    reason: balance < 1 ? 'Insufficient credits. Accepting needs 1 credit. You have 0 spendable credits. Decline remains available.' : null };
}

export function counterpartAnswer(status) {
  return ({ accepted: 'Agreed', declined: 'Declined', pending: 'Not answered', expired: 'Not answered (expired)' })[status] || 'Not recorded';
}
