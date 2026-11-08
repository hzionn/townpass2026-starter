import { ref } from 'vue';

/** Text of the app's single aria-live region, rendered in App.vue. */
export const liveMessage = ref('');

let timer: ReturnType<typeof setTimeout> | undefined;

/** Clears first, so saying the same thing twice ("已儲存", "已儲存") is still announced. */
export function announce(message: string): void {
  liveMessage.value = '';
  clearTimeout(timer);
  timer = setTimeout(() => {
    liveMessage.value = message;
  }, 50);
}
