/**
 * Getting the link out of the phone. Each step falls back to the next one, because TownPass's
 * WebView may have no share sheet and may block the clipboard:
 * share sheet → navigator.clipboard → execCommand → a read-only field the user selects by hand.
 */
function copyWithExecCommand(text: string): boolean {
  const previousFocus = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  area.value = text;
  area.readOnly = true;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  previousFocus?.focus?.();
  return copied;
}

/** Returns false when every way of copying failed: the caller then shows a selectable field. */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Blocked: common in WebViews. Fall through to the older way.
    }
  }
  return copyWithExecCommand(text);
}

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'manual';

export async function shareLink(url: string): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: '託你辦協助連結', url });
      return 'shared';
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return 'cancelled';
      // Any other failure: the share sheet is not usable here, so copy instead.
    }
  }
  return (await copyText(url)) ? 'copied' : 'manual';
}
