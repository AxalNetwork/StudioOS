/** D4557: native Container API adapter; no input bytes cross the port until the running image digest matches the grant. */
import { computeBody, COMPUTE_BODY_CAP } from '../cloudflare-worker/src/services/agents/computeHost';
import type { ComputeVm } from './host';

export type VmControl = {
  start(options: ContainerStartupOptions): void;
  namedImage(): string | undefined;
  inspect(): Promise<{ image: string } | null>;
  monitor(): Promise<void>;
  fetch(request: Request): Promise<Response>;
  destroy(): Promise<void>;
};
/** The old basic alias is not accepted by durable_object startup. Preserve its
 * 1/4-vCPU, 1-GiB, 4-GB ceiling explicitly rather than increasing the profile. */
export const PYTHON_COMPUTE_INSTANCE = Object.freeze({ vcpu: 0.25, memoryMib: 1024, diskMb: 4000 });
export type ComputeInstance = typeof PYTHON_COMPUTE_INSTANCE | 'standard-1';
export function createContainerVm(control: VmControl, profile: {
  schedulingPolicy: string; instance: ComputeInstance; now(): number; pause?(signal: AbortSignal): Promise<void>;
}): ComputeVm {
  let digest: string | null = null, exited = false;
  const imageMatches = (image: string) => !!digest && (image === digest || image.endsWith('@' + digest));
  const decode = async (response: Response, cap: number) => JSON.parse(new TextDecoder().decode(await computeBody(response, cap)));
  return {
    start(expectedDigest: string) {
      if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) throw Error('compute_image_unverified');
      digest = expectedDigest;
      if (!(profile.schedulingPolicy === 'durable_object')) throw Error('compute_scheduling_unconfirmed');
      const image = control.namedImage();
      if (!image || !imageMatches(image)) throw Error('compute_image_unverified');
      control.start({ image, instance: profile.instance, enableInternet: false });
      void control.monitor().then(() => { exited = true; }, () => { exited = true; });
    },
    async ready(signal) {
      const deadline = profile.now() + 30000;
      while (profile.now() < deadline) {
        signal.throwIfAborted(); if (exited) throw Error('compute_process_exited');
        let ready = false;
        try {
          const response = await control.fetch(new Request('http://compute/health', { signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) }));
          ready = response.ok && (await decode(response, 1024)).ready === true;
        } catch { signal.throwIfAborted(); }
        if (ready) {
          const observed = await control.inspect();
          if (!observed || !imageMatches(observed.image)) throw Error('compute_image_unverified');
          return;
        }
        if (profile.pause) await profile.pause(signal);
        else await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw Error('compute_not_ready');
    },
    async run(input, signal, bootstrapGrant) {
      const response = await control.fetch(new Request('http://compute/run', { method: 'POST', headers: { 'x-compute-grant': bootstrapGrant },
        body: JSON.stringify(input), signal }));
      if (!response.ok) { await response.body?.cancel(); throw Error('compute_vm_refused'); }
      return decode(response, COMPUTE_BODY_CAP);
    },
    async destroy() {
      await control.destroy();
      if (await control.inspect() !== null) throw Error('compute_cleanup_unconfirmed');
    },
  };
}
