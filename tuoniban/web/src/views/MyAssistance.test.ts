import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrantState, MyAssistanceResponse } from '../../../shared/contract';
import { ApiError, api } from '../api/client';
import { issuedToken } from '../stores/issuedToken';
import { service } from '../stores/service';
import { SERVICE, TOKEN } from '../test/fixtures';
import { createTestRouter } from '../test/routerStub';
import MyAssistance from './MyAssistance.vue';

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,AAAA') } }));

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: {
      getService: vi.fn(),
      getMyAssistance: vi.fn(),
      createGrant: vi.fn(),
      reissueGrant: vi.fn(),
      revokeGrant: vi.fn(),
      getApplicantCase: vi.fn(),
    },
  };
});

const mocked = vi.mocked(api);

function grant(state: GrantState, overrides: Partial<MyAssistanceResponse> = {}): MyAssistanceResponse {
  return {
    grantId: 'grant-1',
    state,
    claimExpiresAt: '2026-11-07T06:10:00.000Z',
    accessExpiresAt: '2026-11-07T07:00:00.000Z',
    caseId: null,
    receiptNo: null,
    activity: [],
    serverNow: '2026-11-07T06:00:18.000Z',
    ...overrides,
  };
}

const created = {
  grantId: 'grant-2',
  state: 'issued' as const,
  token: TOKEN,
  claimExpiresAt: '2026-11-07T06:10:00.000Z',
  accessExpiresAt: '2026-11-07T07:00:00.000Z',
  serverNow: '2026-11-07T06:00:18.000Z',
};

async function mountPage() {
  const router = createTestRouter();
  await router.push('/my-assistance');
  const wrapper = mount(MyAssistance, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}

function button(wrapper: Awaited<ReturnType<typeof mountPage>>, label: string) {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === label);
  if (!found) throw new Error(`No button ${label}`);
  return found;
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  service.value = SERVICE;
  mocked.getService.mockResolvedValue(SERVICE);
});

afterEach(() => {
  service.value = null;
  issuedToken.value = null;
  vi.resetAllMocks();
  document.body.innerHTML = '';
});

describe('S02', () => {
  it('asks for consent first, then shows the code, the countdown and the link actions', async () => {
    mocked.getMyAssistance.mockResolvedValue(null);
    mocked.createGrant.mockResolvedValueOnce(created);
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain(SERVICE.consentText);
    await button(wrapper, '同意並產生協助碼').trigger('click');
    await flushPromises();

    expect(mocked.createGrant).toHaveBeenCalledWith('demo-consent-v1');
    const qr = wrapper.find('img');
    expect(qr.attributes('alt')).toContain('協助碼 QR Code');
    expect(Number(qr.attributes('width'))).toBeGreaterThanOrEqual(240);
    expect(wrapper.text()).toContain('待領取 · 剩餘 09:42');
    expect(wrapper.text()).toContain('只交給你信任的人。');
    expect(button(wrapper, '分享連結').exists()).toBe(true);
    expect(button(wrapper, '複製連結').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps the token in memory only', async () => {
    mocked.getMyAssistance.mockResolvedValue(null);
    mocked.createGrant.mockResolvedValueOnce(created);
    const wrapper = await mountPage();
    await button(wrapper, '同意並產生協助碼').trigger('click');
    await flushPromises();

    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(stored).not.toContain(TOKEN);
    expect(issuedToken.value?.token).toBe(TOKEN);
    wrapper.unmount();
  });

  it('after a refresh, explains the old code is gone and reissues it', async () => {
    mocked.getMyAssistance.mockResolvedValue(grant('issued'));
    mocked.reissueGrant.mockResolvedValueOnce(created);
    const wrapper = await mountPage();

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('舊的協助碼不會再次顯示');
    await button(wrapper, '重新產碼').trigger('click');
    await flushPromises();

    expect(mocked.reissueGrant).toHaveBeenCalledWith('grant-1');
    expect(mocked.createGrant).not.toHaveBeenCalled();
    expect(wrapper.find('img').exists()).toBe(true);
    wrapper.unmount();
  });

  it.each(['revoked', 'expired'] as const)('after %s, 重新產碼 creates a new grant instead of reissuing', async (state) => {
    mocked.getMyAssistance.mockResolvedValue(grant(state));
    mocked.createGrant.mockResolvedValueOnce(created);
    const wrapper = await mountPage();

    await button(wrapper, '重新產碼').trigger('click');
    await flushPromises();
    expect(mocked.createGrant).toHaveBeenCalledTimes(1);
    expect(mocked.reissueGrant).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows who is helping without a QR code once the code is claimed', async () => {
    mocked.getMyAssistance.mockResolvedValue(grant('active', { caseId: 'case-1' }));
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('有人正在協助');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(button(wrapper, '停止協助').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows the receipt number and the Taipei time once submitted', async () => {
    mocked.getMyAssistance.mockResolvedValue(grant('completed', { caseId: 'case-1', receiptNo: 'DEMO-20261107-0001' }));
    mocked.getApplicantCase.mockResolvedValue({
      caseId: 'case-1',
      state: 'submitted',
      serviceName: SERVICE.name,
      receipt: { receiptNo: 'DEMO-20261107-0001', submittedAt: '2026-11-07T06:20:00Z', isDemo: true, message: '' },
    });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain('模擬編號：DEMO-20261107-0001');
    expect(wrapper.text()).toContain('送出時間：2026/11/07 14:20');
    expect(wrapper.text()).not.toContain('核准');
    expect(button(wrapper, '停止協助').exists()).toBe(true);
    wrapper.unmount();
  });

  it('re-reads the state when the server says a grant is already open', async () => {
    mocked.getMyAssistance.mockResolvedValueOnce(null).mockResolvedValue(grant('active', { caseId: 'case-1' }));
    mocked.createGrant.mockRejectedValueOnce(new ApiError(409, 'ACTIVE_ASSISTANCE_EXISTS', 'x'));
    const wrapper = await mountPage();

    await button(wrapper, '同意並產生協助碼').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('有人正在協助');
    expect(wrapper.text()).not.toContain('目前無法產生協助碼');
    wrapper.unmount();
  });

  it('stops only after confirming, with the spec wording', async () => {
    mocked.getMyAssistance
      .mockResolvedValueOnce(grant('active', { caseId: 'case-1' }))
      .mockResolvedValue(
        grant('revoked', {
          caseId: 'case-1',
          activity: [{ kind: 'stopped', at: '2026-11-07T06:01:00.000Z', count: 1 }],
        }),
      );
    mocked.revokeGrant.mockResolvedValueOnce({ grantId: 'grant-1', state: 'revoked', serverNow: '2026-11-07T06:01:00Z' });
    const wrapper = await mountPage();

    await button(wrapper, '停止協助').trigger('click');
    await flushPromises();
    const dialog = wrapper.find('dialog');
    expect(dialog.attributes('open')).toBeDefined();
    expect(dialog.text()).toContain('停止後，代辦者不能再操作這次協助。已送出的內容不會自動撤回。');
    expect(mocked.revokeGrant).not.toHaveBeenCalled();

    const confirm = dialog.findAll('button').find((candidate) => candidate.text() === '停止協助')!;
    await confirm.trigger('click');
    await flushPromises();
    expect(mocked.revokeGrant).toHaveBeenCalledWith('grant-1');
    expect(wrapper.text()).toContain('這次協助已停止');
    // The log is re-read at once, so the stop shows without waiting for the next poll.
    expect(wrapper.find('.activity').text()).toContain('14:01你停止了協助');
    wrapper.unmount();
  });

  it('lists the activity log newest first, with times in Taipei and blocked attempts marked', async () => {
    mocked.getMyAssistance.mockResolvedValue(
      grant('revoked', {
        caseId: 'case-1',
        activity: [
          { kind: 'blocked', at: '2026-11-07T06:09:00.000Z', count: 2 },
          { kind: 'stopped', at: '2026-11-07T06:08:00.000Z', count: 1 },
          { kind: 'draft_saved', at: '2026-11-07T06:05:00.000Z', count: 3 },
          { kind: 'claimed', at: '2026-11-07T06:02:00.000Z', count: 1 },
          { kind: 'code_issued', at: '2026-11-07T06:00:00.000Z', count: 1 },
        ],
      }),
    );
    const wrapper = await mountPage();

    const section = wrapper.find('section.activity');
    expect(section.find('h2').text()).toBe('協助紀錄');
    const items = section.findAll('li').map((item) => item.text());
    expect(items).toEqual([
      '14:09⚠ 協助結束後代辦者仍嘗試操作，系統已擋下（2 次）',
      '14:08你停止了協助',
      '14:05代辦者儲存草稿（3 次）',
      '14:02代辦者領取協助碼，開始協助',
      '14:00你產生了協助碼',
    ]);
    expect(section.find('li').classes()).toContain('activity__item--warning');
    expect(section.find('time').attributes('datetime')).toBe('2026-11-07T06:09:00.000Z');
    wrapper.unmount();
  });

  it('has no activity log before any code exists', async () => {
    mocked.getMyAssistance.mockResolvedValue(null);
    const wrapper = await mountPage();
    expect(wrapper.find('section.activity').exists()).toBe(false);
    wrapper.unmount();
  });
});
