import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const AccountLicences = lazy(() => import('../pages/account/AccountLicences'));

/**
 * `/account/licences` — D4473 (#4473), the held licences and how to add one, from the Account menu. Every member
 * licence and exploring; an admin account has no licences page (its menu has no Licences item). A static path, so it
 * ranks above `/account/:section`.
 */
export default function accountLicencesRoutes({ guard }) {
  return (
    <>
      <Route path="/account/licences" element={guard(['founder', 'partner', 'investor', 'advisor', 'exploring'], <AccountLicences />)} />
    </>
  );
}
