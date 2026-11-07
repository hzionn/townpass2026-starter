import { shallowRef } from 'vue';
import type { ServiceConfigResponse } from '../../../shared/contract';
import { api } from '../api/client';
import { serverClock } from '../lib/time';

export const service = shallowRef<ServiceConfigResponse | null>(null);

/** `force` matters on S04: the allowed date range moves at midnight. */
export async function loadService(options: { force?: boolean } = {}): Promise<ServiceConfigResponse> {
  if (service.value && !options.force) return service.value;
  const config = await api.getService();
  serverClock.sync(config.serverNow);
  service.value = config;
  return config;
}

export function clearService(): void {
  service.value = null;
}
