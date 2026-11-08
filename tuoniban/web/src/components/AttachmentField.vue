<script setup lang="ts">
/**
 * The S04 practice attachment. Only one is allowed, and it must be deleted before replacing it,
 * so nothing is ever silently overwritten (spec §5 S04).
 */
import { computed } from 'vue';
import { REQUIREMENT_ID, type AttachmentInfo, type AttachmentRequirement } from '../../../shared/contract';
import { attachmentTypeLabel, formatFileSize } from '../lib/serviceConfig';
import type { WriteKind } from '../lib/caseDraft';

const props = defineProps<{
  requirement: AttachmentRequirement;
  attachment: AttachmentInfo | null;
  /** Which write is running right now, if any. */
  writing: WriteKind | null;
  error?: string;
}>();

const emit = defineEmits<{
  selected: [file: File];
  'use-sample': [];
  remove: [];
}>();

const inputId = `field-${REQUIREMENT_ID}`;
const labelId = `${inputId}-label`;
const hintId = `${inputId}-hint`;
const warningId = `${inputId}-warning`;
const statusId = `${inputId}-status`;
const errorId = `${inputId}-error`;

const busy = computed(() => props.writing !== null);

const statusText = computed(() => {
  if (props.writing === 'upload') return '上傳中';
  if (props.writing === 'delete') return '刪除中';
  const file = props.attachment;
  if (!file) return '未上傳';
  return `已上傳：${file.displayName}（${attachmentTypeLabel(file.mime)}，${formatFileSize(file.size)}）`;
});

const describedBy = computed(() =>
  [hintId, warningId, statusId, props.error ? errorId : null].filter(Boolean).join(' '),
);

function onFileChosen(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Reset, so choosing the same file again after an error still fires a change event.
  input.value = '';
  if (file) emit('selected', file);
}

function onSampleClick(): void {
  if (!busy.value) emit('use-sample');
}

function onRemoveClick(): void {
  if (!busy.value) emit('remove');
}
</script>

<template>
  <div class="field" role="group" :aria-labelledby="labelId">
    <p :id="labelId" class="field__label">
      {{ requirement.label }}{{ requirement.required ? '（必填）' : '（選填）' }}
    </p>
    <p :id="hintId" class="field__hint field__hint--above">{{ requirement.hint }}</p>

    <template v-if="!attachment">
      <!-- A real file input stretched over the button, so keyboards and screen readers just work. -->
      <label class="btn btn--secondary file-picker" :class="{ 'file-picker--disabled': busy }">
        <input
          :id="inputId"
          type="file"
          :accept="requirement.acceptAttribute"
          :disabled="busy"
          :aria-describedby="describedBy"
          :aria-invalid="error ? 'true' : 'false'"
          @change="onFileChosen"
        />
        選擇練習附件
      </label>
      <button type="button" class="btn btn--secondary btn--small" :aria-disabled="busy" @click="onSampleClick">
        使用內建合成範例
      </button>
    </template>

    <p :id="statusId" class="attachment-status" tabindex="-1">
      <span v-if="attachment && !writing" aria-hidden="true">✓ </span>{{ statusText }}
    </p>
    <p :id="warningId" class="field__hint">{{ requirement.warning }}</p>
    <p v-if="error" :id="errorId" class="field__error"><span aria-hidden="true">⚠ </span>{{ error }}</p>

    <button
      v-if="attachment"
      type="button"
      class="btn btn--secondary btn--small"
      :aria-disabled="busy"
      @click="onRemoveClick"
    >
      刪除附件
    </button>
  </div>
</template>
