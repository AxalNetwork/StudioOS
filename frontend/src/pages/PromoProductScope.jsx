import React from 'react';
import { Unreadable } from '../ui';

/**
 * What a promo code applies to. An empty readable list is every product.
 * A list that did not parse is Unreadable — never "All products".
 */
export function PromoProductScope({ promo, productName }) {
  if (promo?.product_ids_readable === false) {
    return (
      <Unreadable
        what="Product list"
        claim="This is not a claim that the code applies to every product."
      />
    );
  }
  const ids = Array.isArray(promo?.product_ids) ? promo.product_ids : [];
  if (ids.length === 0) return <span className="text-gray-400">All products</span>;
  return <>{ids.map(productName).join(', ')}</>;
}
