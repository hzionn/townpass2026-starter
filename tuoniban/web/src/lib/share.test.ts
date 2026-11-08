import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, shareLink } from './share';

const LINK = 'https://example.test/assist#token=abc';

function stubNavigator(values: Partial<Navigator>): void {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(navigator, key, { value, configurable: true });
  }
}

afterEach(() => {
  stubNavigator({ share: undefined, clipboard: undefined } as unknown as Partial<Navigator>);
  vi.restoreAllMocks();
});

function stubExecCommand(result: boolean | Error) {
  const execCommand = vi.fn(() => {
    if (result instanceof Error) throw result;
    return result;
  });
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
  return execCommand;
}

describe('copying the link', () => {
  it('uses the clipboard API when allowed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ clipboard: { writeText } as unknown as Clipboard });
    await expect(copyText(LINK)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(LINK);
  });

  it('falls back to execCommand when the WebView blocks the clipboard', async () => {
    stubNavigator({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } as unknown as Clipboard });
    const execCommand = stubExecCommand(true);
    await expect(copyText(LINK)).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports failure when every method fails, so the page can show a selectable field', async () => {
    stubExecCommand(new Error('not supported'));
    await expect(copyText(LINK)).resolves.toBe(false);
  });
});

describe('sharing the link', () => {
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    await expect(shareLink(LINK)).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: LINK }));
  });

  it('stays quiet when the user closes the share sheet', async () => {
    stubNavigator({ share: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')) });
    await expect(shareLink(LINK)).resolves.toBe('cancelled');
  });

  it('copies instead when sharing is unavailable', async () => {
    stubExecCommand(true);
    await expect(shareLink(LINK)).resolves.toBe('copied');
  });
});
