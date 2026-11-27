/** D4496 (#4496): DS phone/tablet boundaries, using the shared reactive media hook. */
import { usePhoneWidth } from '../../../ui/phone/usePhoneWidth.js';
export function useDistributionLayout() {
  const phone=usePhoneWidth('(max-width: 639px)');
  const tablet=usePhoneWidth('(min-width: 640px) and (max-width: 1023px)');
  return {phone,tablet,width:phone?390:tablet?768:1440};
}
