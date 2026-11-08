import { shallowRef } from 'vue';

export interface IssuedToken {
  grantId: string;
  token: string;
}

/**
 * The bearer token of the code on screen. Deliberately memory-only, never localStorage or
 * sessionStorage (spec §10.3): the server returns it only once, and a refresh must lose it.
 */
export const issuedToken = shallowRef<IssuedToken | null>(null);

export function clearIssuedToken(): void {
  issuedToken.value = null;
}
