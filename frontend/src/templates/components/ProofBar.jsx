import React from 'react';
import { DISPLAY_FONT } from '../brandKit';

export default function ProofBar({ items, className = '' }) {
  return (
    <div
      className={`py-8 px-6 bg-gray-50 border-y border-gray-200 ${className}`}
    >
      <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-center gap-8 md:gap-14">
        {items.map((item, i) => (
          <React.Fragment key={i}>
            <div className="text-center">
              <div style={DISPLAY_FONT} className="text-xl md:text-2xl font-bold text-gray-900">
                {item.value}
              </div>
              <div className="text-xs text-gray-500 mt-0.5 uppercase tracking-wide">{item.label}</div>
            </div>
            {i < items.length - 1 && (
              <div className="hidden md:block w-px h-8 bg-gray-200" />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
