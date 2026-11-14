/** D5676: tail only studioos into conditional R2 batches; independent metadata can expose a caught write failure. No notification is sent through this input. */
import { writeArchiveBatch,type ArchiveEnv,type TailEvent } from './archive';
export default {async tail(events:TailEvent[],env:ArchiveEnv,ctx:ExecutionContext):Promise<void>{await writeArchiveBatch(events,env,ctx);}};
