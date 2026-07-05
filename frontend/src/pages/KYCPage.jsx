import React from 'react';
import KycVerification from '../components/KycVerification';

// Task #25 — the KYC form now lives in the reusable <KycVerification /> component
// so it can also render embedded in the Trust Center "Identity" tab. This page is
// the standalone `/kyc` route (kept registered — the onboarding KYC gate in
// App.jsx redirects unverified investors here). Full page chrome (header +
// explainer) renders because `embedded` defaults to false.
export default function KYCPage() {
  return <KycVerification />;
}
