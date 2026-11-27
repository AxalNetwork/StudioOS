import React, { useEffect, useState } from 'react';
import { productTestingApi } from '../../../lib/api/productTesting';
import { logoInitial } from './reviewModel';

/** The programme's square: its logo (D1199), else its letter when there is none or it does not load. */
export default function ProgrammeLogo({ p, size = 28 }) {
  const [failed, setFailed] = useState(!p?.logo_key);
  useEffect(() => { setFailed(!p?.logo_key); }, [p?.logo_key]);
  const box = { width: size, height: size };
  if (failed) {
    return (
      <span style={box} aria-hidden="true" className="grid flex-none place-items-center rounded-[7px] border border-violet-200 bg-violet-50 text-[12px] font-extrabold text-axal-violet-deep dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300">
        {logoInitial(p?.product_name)}
      </span>
    );
  }
  return <img src={productTestingApi.logoSrc(p.uid)} alt="" style={box} className="flex-none rounded-[7px] border border-axal-hairline object-contain dark:border-gray-700" onError={() => setFailed(true)} />;
}
