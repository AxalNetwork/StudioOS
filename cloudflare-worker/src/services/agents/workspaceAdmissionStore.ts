/** D5570 part 2: durable transaction adapter for the existing admission policy; no namespace or public route enabled. */
import { emptyAdmissionState, type AdmissionState, type AdmissionStore } from './workspaceAdmission';
const KEY = 'workspace-admission-v1';
/** All tenants sharing a provider/region quota must use the same coordinator object.
 * Transactions contain only synchronous policy changes, never provider or billing I/O.
 * A throw rolls back the entire state, including fencing and settlement identity.
 */
export class DurableWorkspaceAdmissionStore implements AdmissionStore {
  constructor(private readonly storage: DurableObjectStorage) {}
  transaction<T>(change: (state: AdmissionState) => T): Promise<T> {
    return this.storage.transaction(async txn => {
      const state = await txn.get<AdmissionState>(KEY) ?? emptyAdmissionState();
      const result = change(state);
      if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('admission_transaction_must_be_synchronous');
      await txn.put(KEY, state);
      return result;
    });
  }
}
