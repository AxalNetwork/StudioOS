import { BrandIcon } from '../../ui';
import { TILE_CLASS } from '../../ui/BrandIcon.jsx';

/**
 * D5810 (#5810): a connector's mark on Account › Connectors. Microsoft Teams
 * draws the owner-requested official Teams favicon kept in `public/` (the
 * same file Record a session's Teams chip draws, 2026-10-28); every other
 * connector is `BrandIcon`'s, unchanged.
 */
export default function ConnectorMark({ p, size = 34 }) {
  if (p?.key !== 'teams') return <BrandIcon provider={p?.key} name={p?.display_name} size={size} />;
  const glyph = Math.round(size * 0.53);
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className={TILE_CLASS} data-brand="local" data-provider="teams">
      <img src="/microsoft-teams.ico" width={glyph} height={glyph} alt="" className="shrink-0" />
    </span>
  );
}
