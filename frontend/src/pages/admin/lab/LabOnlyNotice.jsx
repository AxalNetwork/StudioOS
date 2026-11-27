import React from 'react';
import { Link } from 'react-router-dom';
/** D1123: SL19a keeps the member's two useful doors. */
export default function LabOnlyNotice({ home = '/studio' }) {
  return <section className="mx-auto my-20 max-w-xl rounded-xl border border-axal-hairline bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-900" data-testid="lab-admin-refusal">
    <h1 className="text-lg font-bold text-axal-ink dark:text-gray-100">This page is for studio admins.</h1>
    <p className="text-sm text-axal-muted dark:text-gray-400">The Spin-Out Lab itself is open to every member.</p>
    <div className="mt-4 flex flex-wrap justify-center gap-3"><Link to="/spinout-lab" className="text-axal-violet dark:text-violet-300">See the Spin-Out Lab</Link><Link to={home} className="text-axal-violet dark:text-violet-300">Go to your home</Link></div>
  </section>;
}
