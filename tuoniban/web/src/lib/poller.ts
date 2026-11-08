/**
 * Polls while the page is visible, pauses while hidden, and refreshes at once on coming back
 * (spec §5 S02). A slow request never overlaps the next one. Returns a function that stops it.
 */
export function startPolling(tick: () => Promise<void>, intervalMs: number): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule(): void {
    clearTimeout(timer);
    if (!stopped && !document.hidden) timer = setTimeout(run, intervalMs);
  }

  async function run(): Promise<void> {
    if (stopped || running || document.hidden) return;
    running = true;
    clearTimeout(timer);
    try {
      await tick();
    } finally {
      running = false;
      schedule();
    }
  }

  function onVisibilityOrFocus(): void {
    if (document.hidden) clearTimeout(timer);
    else void run();
  }

  document.addEventListener('visibilitychange', onVisibilityOrFocus);
  window.addEventListener('focus', onVisibilityOrFocus);
  schedule();

  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    window.removeEventListener('focus', onVisibilityOrFocus);
  };
}
