import GithubRepositoriesPanel from './GithubRepositoriesPanel';
import { BTN } from './AccountCenter';
import { Sheet } from './ConnectorSheet';

/**
 * D686 §5.4 (#1597) — GitHub's `sync` view (`Cycle Action.dc.html`, `connect`
 * › `sync`): choose what StudioOS reads, then sync it. Reached after GitHub's
 * sign-in returns, and from the connection's detail; Build and the Connectors
 * page open the same sheet.
 *
 * D753 F4 (#1957): the repositories, the project, save, sync and the done
 * state live in `GithubRepositoriesPanel.jsx`, which GitHub's own page also
 * draws. This is the frame around it: the same two Sheets, titles, eyebrow,
 * Back and footer as before.
 */
export default function GithubSyncSheet({ p, conn, projectId = null, companyId = null, eyebrow = 'Connector', onClose, back, onChanged, api, projectsApi, wait, emptySlot = null }) {
  const panel = { p, conn, projectId, companyId, onClose, onChanged, emptySlot };
  if (api) panel.api = api;
  if (projectsApi) panel.projectsApi = projectsApi;
  if (wait) panel.wait = wait;
  return (
    <GithubRepositoriesPanel
      {...panel}
      frame={({ done, name, busy, body, footer }) => (done
        ? (
          <Sheet eyebrow={eyebrow} title={`${name} is synced`} provider="github" providerName={name} onClose={onClose} data-testid="connector-sheet-success" footer={footer}>
            {body}
          </Sheet>
        )
        : (
          <Sheet eyebrow={eyebrow} title={`Connect ${name}`} provider="github" providerName={name} sub="Choose what StudioOS reads. You can change this later." onClose={onClose}
            footer={<>{back && <button type="button" className={BTN.ghost} onClick={back} disabled={busy}>Back</button>}{footer}</>} data-testid="connector-sheet-sync">
            {body}
          </Sheet>
        ))}
    />
  );
}
