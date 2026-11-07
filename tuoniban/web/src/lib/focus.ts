import { nextTick } from 'vue';

/** Moves focus to the page's <h1 tabindex="-1">, so a screen reader announces the new page. */
export function focusPageHeading(): void {
  void nextTick(() => document.querySelector<HTMLElement>('h1')?.focus());
}

/** After an async change removed the focused control: keeps keyboard users from falling to the top. */
export function refocusIfLost(): void {
  void nextTick(() => {
    const active = document.activeElement;
    if (!active || active === document.body) document.querySelector<HTMLElement>('h1')?.focus();
  });
}
