import { Link } from 'react-router-dom';

/**
 * D882 (#2555) — what a Grow or Raise "From Mercury" part says when the
 * founder's Mercury cannot fill it: not connected, a pasted token, or a
 * sign-in Mercury rejected. The sentence comes from the Worker; "Connect
 * Mercury" opens the founder's Connectors page and is drawn only for the
 * founder (`connection.link`), whose bank account it is.
 */
export default function ConnectMercury({ reason, connection }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2" data-testid="mercury-connect" data-state={connection?.state || ''}>
      <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400">{reason}</p>
      {connection?.link && (
        <Link to={connection.link.href} data-testid="mercury-connect-link"
          className="rounded-md border border-axal-hairline px-2.5 py-0.5 text-[11.5px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-200">{connection.link.label}</Link>
      )}
    </div>
  );
}
