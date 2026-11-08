<script setup lang="ts">
/**
 * S06: the receipt. The words here matter: this is a simulation, so nothing may read as an
 * approval or a real booking (spec §5 S06). There is no edit, reschedule or cancel.
 */
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import type { HelperCaseResponse } from '../../../shared/contract';
import { api, isAccessLost } from '../api/client';
import FullPageState from '../components/FullPageState.vue';
import { kindFromError, type S07Kind } from '../lib/pageState';
import { caseRoute } from '../lib/routes';
import { optionLabel } from '../lib/serviceConfig';
import { formatCalendarDate, formatTaipeiDateTime } from '../lib/time';
import { loadService, service } from '../stores/service';

const props = defineProps<{ id: string }>();
const router = useRouter();

const pageKind = ref<S07Kind | null>(null);
const caseData = shallowRef<HelperCaseResponse | null>(null);

const receipt = computed(() => caseData.value?.receipt ?? null);
const form = computed(() => caseData.value?.formData ?? null);

const location = computed(() =>
  service.value && form.value ? optionLabel(service.value, 'locationPreference', form.value.locationPreference) : '',
);
const period = computed(() =>
  service.value && form.value ? optionLabel(service.value, 'preferredPeriod', form.value.preferredPeriod) : '',
);

async function load(): Promise<void> {
  pageKind.value = null;
  caseData.value = null;
  try {
    const [, data] = await Promise.all([loadService(), api.getHelperCase(props.id)]);
    if (data.state !== 'submitted' || !data.receipt) {
      await router.replace(caseRoute(props.id, 'edit'));
      return;
    }
    caseData.value = data;
  } catch (error) {
    if (!isAccessLost(error)) pageKind.value = kindFromError(error) ?? 'network';
  }
}

onMounted(load);
</script>

<template>
  <FullPageState v-if="pageKind" :kind="pageKind" @retry="load" />
  <div v-else class="page">
    <h1 tabindex="-1">模擬送出完成</h1>
    <p v-if="!receipt || !form || !caseData" class="muted">載入中…</p>

    <template v-else>
      <div class="status-circle status-circle--success" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="44" height="44" focusable="false">
          <path d="M5 13l5 5L19 7" fill="none" stroke="currentColor" stroke-width="3" />
        </svg>
      </div>

      <section class="card" aria-labelledby="result-receipt">
        <h2 id="result-receipt" class="card__title">模擬需求已儲存</h2>
        <p class="muted">模擬編號：{{ receipt.receiptNo }}</p>
        <p class="muted">送出時間：{{ formatTaipeiDateTime(receipt.submittedAt) }}</p>
      </section>

      <section class="card" aria-labelledby="result-summary">
        <h2 id="result-summary" class="card__title">需求摘要</h2>
        <p v-if="service" class="muted">{{ service.name }}</p>
        <p class="muted">{{ caseData.applicantLabel }} · 偏好 {{ location }}</p>
        <p class="muted">
          {{ form.preferredDate ? formatCalendarDate(form.preferredDate) : '未選擇' }} · {{ period }}
        </p>
        <p class="muted">練習附件：{{ caseData.attachment ? '已備妥' : '未提供' }}</p>
      </section>

      <p class="strong-note">資料已存入展示系統，尚未送交政府或醫院。<br />不是正式預約成功。</p>

      <RouterLink to="/" class="btn btn--primary">返回首頁</RouterLink>
    </template>
  </div>
</template>
