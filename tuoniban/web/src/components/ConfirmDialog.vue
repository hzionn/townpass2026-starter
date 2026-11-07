<script setup lang="ts">
/**
 * A native modal <dialog>, used only for 停止協助 and 離開未儲存內容 (spec §5.1).
 * The browser traps focus and handles Esc; we put focus back on the trigger when it closes.
 */
import { ref, useId, watch } from 'vue';
import { focusPageHeading } from '../lib/focus';

const props = defineProps<{
  open: boolean;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);

/** Some browsers close a modal on a repeated Esc even when cancel is prevented. */
function onNativeClose(): void {
  if (props.open) emit('cancel');
}
const messageId = useId();
let trigger: HTMLElement | null = null;

watch(
  () => props.open,
  (open) => {
    const element = dialog.value;
    if (!element) return;
    if (open && !element.open) {
      trigger = document.activeElement as HTMLElement | null;
      element.showModal();
    } else if (!open && element.open) {
      element.close();
      if (trigger?.isConnected && trigger !== document.body) trigger.focus();
      else focusPageHeading();
      trigger = null;
    }
  },
  { flush: 'post' },
);
</script>

<template>
  <dialog ref="dialog" class="confirm-dialog" :aria-labelledby="messageId" @cancel.prevent="emit('cancel')" @close="onNativeClose">
    <p :id="messageId" class="confirm-dialog__message">{{ message }}</p>
    <div class="confirm-dialog__actions">
      <button type="button" class="btn btn--secondary" @click="emit('cancel')">{{ cancelLabel }}</button>
      <button type="button" class="btn btn--primary" @click="emit('confirm')">{{ confirmLabel }}</button>
    </div>
  </dialog>
</template>
