import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { service } from '../stores/service';
import { PUBLIC_ORIGIN, SERVICE, TOKEN } from '../test/fixtures';
import { createTestRouter } from '../test/routerStub';
import Scan from './Scan.vue';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, api: { getService: vi.fn(), redeem: vi.fn() } };
});

const redeem = vi.mocked(api.redeem);
let replyToScan: (data: unknown) => void = () => {};
const getUserMedia = vi.fn();

async function mountScan() {
  const router = createTestRouter();
  await router.push('/scan');
  const wrapper = mount(Scan, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, router };
}

function scanButton(wrapper: Awaited<ReturnType<typeof mountScan>>['wrapper']) {
  return wrapper.findAll('button').find((button) => button.text() === '掃描協助碼')!;
}

beforeEach(() => {
  service.value = SERVICE;
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  const listeners = new Set<FlutterMessageListener>();
  window.flutterObject = {
    postMessage: () => {},
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  replyToScan = (data) => listeners.forEach((listener) => listener({ data: JSON.stringify({ name: 'qr_code_scan', data }) }));
});

afterEach(() => {
  delete window.flutterObject;
  service.value = null;
  vi.resetAllMocks();
  document.body.innerHTML = '';
});

describe('S03 inside TownPass', () => {
  it('uses the app scanner, never getUserMedia', async () => {
    const { wrapper } = await mountScan();
    await scanButton(wrapper).trigger('click');
    expect(getUserMedia).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('redeems only the token of a valid link, then opens the form', async () => {
    redeem.mockResolvedValueOnce({ grantId: 'g', caseId: 'case-1', state: 'active', accessExpiresAt: '', serverNow: '' });
    const { wrapper, router } = await mountScan();
    await scanButton(wrapper).trigger('click');
    replyToScan(`${PUBLIC_ORIGIN}/assist#token=${TOKEN}`);
    await flushPromises();
    expect(redeem).toHaveBeenCalledWith(TOKEN);
    expect(router.currentRoute.value.fullPath).toBe('/cases/case-1/edit');
    wrapper.unmount();
  });

  it('stays silent when the user cancels the scanner', async () => {
    const { wrapper } = await mountScan();
    await scanButton(wrapper).trigger('click');
    replyToScan(null);
    await flushPromises();
    expect(redeem).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('這不是託你辦協助碼');
    wrapper.unmount();
  });

  it('never follows or sends a foreign link', async () => {
    const hrefBefore = window.location.href;
    const { wrapper, router } = await mountScan();
    await scanButton(wrapper).trigger('click');
    replyToScan(`https://evil.example/assist#token=${TOKEN}`);
    await flushPromises();
    expect(redeem).not.toHaveBeenCalled();
    expect(window.location.href).toBe(hrefBefore);
    expect(router.currentRoute.value.fullPath).toBe('/scan');
    expect(wrapper.text()).toContain('這不是託你辦協助碼');
    wrapper.unmount();
  });
});

describe('S03 pasting a link', () => {
  it('rejects a bare token or another site, and focuses the field', async () => {
    const { wrapper } = await mountScan();
    const input = wrapper.find('input#assist-link');
    await input.setValue(TOKEN);
    await wrapper.find('form').trigger('submit');
    expect(redeem).not.toHaveBeenCalled();
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby')).toBe('assist-link-error');
    expect(document.activeElement).toBe(input.element);
    wrapper.unmount();
  });

  it('shows the S07 state the server reports', async () => {
    const { ApiError } = await import('../api/client');
    redeem.mockRejectedValueOnce(new ApiError(410, 'INVITATION_EXPIRED', 'x'));
    const { wrapper } = await mountScan();
    await wrapper.find('input#assist-link').setValue(`${PUBLIC_ORIGIN}/assist#token=${TOKEN}`);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('h1').text()).toBe('協助已到期');
    wrapper.unmount();
  });
});
