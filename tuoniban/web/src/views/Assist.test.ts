import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, api } from '../api/client';
import { TOKEN } from '../test/fixtures';
import { createTestRouter } from '../test/routerStub';
import Assist from './Assist.vue';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: {
      createDemoSession: vi.fn(),
      redeem: vi.fn(),
    },
  };
});

const createDemoSession = vi.mocked(api.createDemoSession);
const redeem = vi.mocked(api.redeem);

async function openAssist() {
  window.history.replaceState({ current: `/assist#token=${TOKEN}` }, '', `/assist#token=${TOKEN}`);
  const router = createTestRouter();
  await router.push('/assist');
  const wrapper = mount(Assist, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  createDemoSession.mockResolvedValue({ persona: 'helper', publicLabel: '代辦者', serverNow: '2026-11-07T06:00:00Z' });
});

afterEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = '';
});

describe('/assist', () => {
  it('becomes a helper first, then redeems the token from the fragment and opens the case', async () => {
    redeem.mockResolvedValueOnce({
      grantId: 'g',
      caseId: 'case-1',
      state: 'active',
      accessExpiresAt: '',
      serverNow: '',
    });
    const { router } = await openAssist();

    expect(createDemoSession).toHaveBeenCalledWith('helper');
    expect(createDemoSession.mock.invocationCallOrder[0]).toBeLessThan(redeem.mock.invocationCallOrder[0]!);
    expect(redeem).toHaveBeenCalledWith(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.history.state.current).toBe('/assist');
    expect(router.currentRoute.value.fullPath).toBe('/cases/case-1/edit');
  });

  it('opens the result for a case this helper already submitted', async () => {
    redeem.mockResolvedValueOnce({ grantId: 'g', caseId: 'case-1', state: 'completed', accessExpiresAt: '', serverNow: '' });
    const { router } = await openAssist();
    expect(router.currentRoute.value.fullPath).toBe('/cases/case-1/result');
  });

  it('keeps the fragment after a network failure, so 重試 and reloading still work', async () => {
    redeem.mockRejectedValueOnce(new NetworkError(true));
    const { wrapper } = await openAssist();

    expect(window.location.hash).toBe(`#token=${TOKEN}`);
    expect(wrapper.find('h1').text()).toBe('暫時連不上');

    redeem.mockResolvedValueOnce({ grantId: 'g', caseId: 'case-1', state: 'active', accessExpiresAt: '', serverNow: '' });
    await wrapper.find('button').trigger('click'); // 重試
    await flushPromises();
    expect(redeem).toHaveBeenLastCalledWith(TOKEN);
    expect(window.location.hash).toBe('');
  });

  it('removes the fragment after a definitive answer and shows the S07 state', async () => {
    redeem.mockRejectedValueOnce(new ApiError(409, 'ALREADY_CLAIMED', 'x'));
    const { wrapper } = await openAssist();
    expect(window.location.hash).toBe('');
    expect(wrapper.find('h1').text()).toBe('這個協助碼已被領取');
  });

  it('does not call redeem for a malformed fragment', async () => {
    window.history.replaceState(null, '', '/assist#token=short');
    const router = createTestRouter();
    await router.push('/assist');
    const wrapper = mount(Assist, { global: { plugins: [router] } });
    await flushPromises();
    expect(redeem).not.toHaveBeenCalled();
    expect(wrapper.find('h1').text()).toBe('這不是可用的協助碼');
  });
});
