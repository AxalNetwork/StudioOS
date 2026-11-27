import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MapPin, Building2 } from 'lucide-react';
import { articles as api } from '../lib/api';
import { reportError } from '../lib/log';
import { safeExternalUrl } from '../lib/url';
import SitePage from '../components/site/SitePage';
import NetworkSubNav from '../components/site/NetworkSubNav';
import { EmptyNote } from '../components/site/SiteBlocks';
import { SOCIALS } from '../components/AuthorCard';
import { ArticleCard } from './ArticlesPage';
import { initials, tintFor } from '../lib/siteResources';
import './site/network.css';
import './site/author.css';

/**
 * An author's public page, in the site frame (owner, 2026-10-12): the profile
 * first — photo, name, headline, where they are, what they do, their bio and
 * links — then everything they have published, as the Articles page draws it.
 *
 * Reachable at /authors/<id> and at /authors/<name slug>; the Worker names the
 * slug, and an id address is replaced by it so the bar shows the readable one.
 * The photo is the author's own upload, offered only when they show it; until
 * it loads, or if it cannot, the page draws their initials instead.
 */

/** The author's photo, or their initials on the canvas's violet tint. */
export function AuthorPhoto({ author }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [author?.headshot_url]);
  if (author?.headshot_url && !failed) {
    return (
      <img
        className="ax-au-photo"
        src={author.headshot_url}
        alt={author.name ? `${author.name}` : 'Author'}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="ax-au-photo ax-au-initials" style={{ background: tintFor(author?.id ?? author?.name) }} aria-hidden="true">
      {initials(author?.name)}
    </span>
  );
}

export default function AuthorProfilePage() {
  const { userId: key = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', author: null, items: [] });

  useEffect(() => {
    // Arriving at the slug this page just redirected to: the data is already here.
    if (state.author && (key === state.author.slug || key === String(state.author.id))) return;
    let alive = true;
    setState({ status: 'loading', author: null, items: [] });
    api.authorProfile(key)
      .then((r) => {
        if (!alive) return;
        const author = r?.author || null;
        setState({ status: author ? 'ready' : 'missing', author, items: Array.isArray(r?.items) ? r.items : [] });
        if (author?.slug && key !== author.slug) navigate(`/authors/${author.slug}`, { replace: true });
      })
      .catch((e) => {
        if (!alive) return;
        if (e?.status !== 404) reportError('AuthorProfile:authorProfile', e);
        setState({ status: e?.status === 404 ? 'missing' : 'error', author: null, items: [] });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const { status, author, items } = state;
  const socials = author ? SOCIALS.filter(({ key: k }) => author.socials?.[k] && safeExternalUrl(author.socials[k])) : [];
  const facts = author ? [
    author.location && { Icon: MapPin, text: author.location },
    author.company && { Icon: Building2, text: author.company },
  ].filter(Boolean) : [];

  return (
    <SitePage title={author?.name || 'Author'} description={author?.headline || 'An author on Axal VC.'}>
      <NetworkSubNav />
      <div className="ax-wrap ax-nw ax-au">
        <Link to="/articles" className="ax-au-back">← All articles</Link>

        {status === 'loading' && <EmptyNote>Loading the author…</EmptyNote>}
        {status === 'missing' && (
          <EmptyNote>No author is published at this address. <Link to="/articles" className="ax-link">Browse the articles →</Link></EmptyNote>
        )}
        {status === 'error' && <EmptyNote>The author could not be loaded. Try again in a moment.</EmptyNote>}

        {status === 'ready' && author && (
          <>
            <header className="ax-au-head">
              <AuthorPhoto author={author} />
              <div className="ax-au-id">
                <div className="ax-lbl-q ax-nw-eyebrow">Author</div>
                <h1 className="ax-nw-h1 ax-au-name">{author.name || 'Axal VC author'}</h1>
                {author.headline && <p className="ax-au-headline">{author.headline}</p>}
                {(facts.length > 0 || items.length > 0) && (
                  <ul className="ax-au-facts">
                    {facts.map(({ Icon, text }) => (
                      <li key={text}><Icon size={15} aria-hidden="true" /> {text}</li>
                    ))}
                    <li className="ax-mono">{items.length} {items.length === 1 ? 'article' : 'articles'}</li>
                  </ul>
                )}
                {author.bio && <p className="ax-au-bio">{author.bio}</p>}
                {socials.length > 0 && (
                  <div className="ax-au-links">
                    {socials.map(({ key: k, label, Icon }) => (
                      <a key={k} href={safeExternalUrl(author.socials[k])} target="_blank" rel="noopener noreferrer" className="ax-au-link">
                        <Icon size={15} /> {label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </header>

            <section aria-labelledby="ax-au-arts">
              <h2 id="ax-au-arts" className="ax-au-h2">Published articles</h2>
              {items.length > 0 ? (
                <div className="ax-art-grid">
                  {items.map((a) => (
                    <ArticleCard key={a.id} a={{ ...a, author: author.name, author_user_id: author.id }} category={a.sector ? a.sector.replace(/_/g, ' ') : null} />
                  ))}
                </div>
              ) : (
                <EmptyNote>Nothing published yet.</EmptyNote>
              )}
            </section>
          </>
        )}
      </div>
    </SitePage>
  );
}
