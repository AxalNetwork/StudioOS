import React from 'react';
import SitePage from '../../components/site/SitePage';
import { Eyebrow } from '../../components/site/SiteBlocks';
import NewsletterSignup from '../../components/site/NewsletterSignup';

/**
 * `/newsletter` — D813 (#2259), board W1's full page: the signup form with
 * the six public topics as switches. The form, its states and its call are
 * `NewsletterSignup`'s (`variant="page"`); this page is its frame.
 */
export default function NewsletterPage() {
  return (
    <SitePage title="Newsletter" signup={false}>
      <div className="ax-wrap ax-nl-page">
        <div className="ax-nl-page-in">
          <Eyebrow>Newsletter</Eyebrow>
          <h1 className="ax-nl-h1">Hear from Axal VC.</h1>
          <p className="ax-nl-lede">Pick what you want to read. Each one is its own email, and you can change them at any time.</p>
          <NewsletterSignup variant="page" />
        </div>
      </div>
    </SitePage>
  );
}
