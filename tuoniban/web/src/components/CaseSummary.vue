<script setup lang="ts">
/**
 * The case content in plain words. The helper checks it on S05; the applicant reads the same
 * thing on S02 before confirming (info.md F09), so both see exactly one wording.
 */
import { computed } from 'vue';
import type { CaseFormData } from '../../../shared/contract';
import { optionFor, optionLabel } from '../lib/serviceConfig';
import { formatCalendarDate } from '../lib/time';
import { service } from '../stores/service';

const props = defineProps<{
  form: CaseFormData;
  attachmentReady: boolean;
  /** Keeps heading ids unique when two summaries could share a page. */
  idPrefix: string;
  /** 3 when the summary sits under a page section that already has an h2. */
  headingLevel?: 2 | 3;
}>();

const heading = computed(() => `h${props.headingLevel ?? 2}`);

const location = computed(() =>
  service.value ? optionLabel(service.value, 'locationPreference', props.form.locationPreference) : '',
);
const locationDetail = computed(() =>
  service.value ? optionFor(service.value, 'locationPreference', props.form.locationPreference)?.detail : undefined,
);
const period = computed(() =>
  service.value ? optionLabel(service.value, 'preferredPeriod', props.form.preferredPeriod) : '',
);
</script>

<template>
  <section class="card" :aria-labelledby="`${idPrefix}-preference`">
    <component :is="heading" :id="`${idPrefix}-preference`" class="card__title">偏好安排</component>
    <p class="muted">地點：{{ location }}</p>
    <p v-if="locationDetail" class="muted">地址：{{ locationDetail }}</p>
    <p class="muted">日期：{{ form.preferredDate ? formatCalendarDate(form.preferredDate) : '未選擇' }}</p>
    <p class="muted">時段：{{ period }}</p>
    <p class="muted">陪同：{{ form.companionRequired ? '需要' : '不需要' }}</p>
    <p class="muted summary-notes">其他需求：{{ form.notes || '未填寫' }}</p>
  </section>

  <section class="card" :aria-labelledby="`${idPrefix}-contact`">
    <component :is="heading" :id="`${idPrefix}-contact`" class="card__title">代辦聯絡</component>
    <p class="muted">稱呼：{{ form.helperName }}</p>
    <p class="muted">電話：{{ form.helperPhone }}</p>
  </section>

  <section class="card" :aria-labelledby="`${idPrefix}-data`">
    <component :is="heading" :id="`${idPrefix}-data`" class="card__title">資料與附件</component>
    <p class="muted">身分資料：已備妥，原值不顯示</p>
    <p class="muted">練習附件：已上傳 {{ attachmentReady ? 1 : 0 }} 份</p>
  </section>
</template>
