export function eventSocialCard(event: {
  title?: unknown;
  summary?: unknown;
  starts_at?: unknown;
  timezone?: unknown;
  location_kind?: unknown;
  cover_url?: unknown;
}): {
  title: string;
  description: string;
  image: string;
  imageIsCard: boolean;
  imageAlt: string;
  type: 'website';
};
