<script setup lang="ts">
/**
 * One S04 field, drawn from the service config. Every field has a real label, states whether it
 * is required in text, and ties its hint and error to the control with aria-describedby.
 */
import { computed } from 'vue';
import type { ServiceField } from '../../../shared/contract';
import { groupOptions } from '../lib/serviceConfig';

const props = defineProps<{
  field: ServiceField;
  modelValue: string | boolean | null;
  error?: string;
  min?: string;
  max?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string | boolean | null] }>();

const inputId = computed(() => `field-${props.field.id}`);
const hintId = computed(() => `${inputId.value}-hint`);
const errorId = computed(() => `${inputId.value}-error`);
const detailId = computed(() => `${inputId.value}-detail`);
const legendId = computed(() => `${inputId.value}-legend`);

const options = computed(() => props.field.options ?? []);
const groups = computed(() => groupOptions(options.value));
const selectedDetail = computed(() => options.value.find((option) => option.value === props.modelValue)?.detail);

const describedBy = computed(() => {
  const ids: string[] = [];
  if (selectedDetail.value) ids.push(detailId.value);
  if (props.field.hint) ids.push(hintId.value);
  if (props.error) ids.push(errorId.value);
  return ids.length > 0 ? ids.join(' ') : undefined;
});

/** v-model on text controls also waits for IME composition to finish, which Chinese input needs. */
const text = computed({
  get: () => (typeof props.modelValue === 'string' ? props.modelValue : ''),
  set: (value: string) => emit('update:modelValue', value),
});

const requiredText = computed(() => (props.field.required ? '（必填）' : '（選填）'));
</script>

<template>
  <!-- A yes/no answer starts unselected: null is "not answered", never "no" (spec §6.2). -->
  <fieldset
    v-if="field.type === 'boolean'"
    class="field field--group"
    role="radiogroup"
    :aria-labelledby="legendId"
    :aria-required="field.required"
    :aria-invalid="error ? 'true' : 'false'"
    :aria-describedby="describedBy"
  >
    <legend :id="legendId" class="field__label">{{ field.label }}{{ requiredText }}</legend>
    <div class="choice-box" :class="{ 'choice-box--invalid': error }">
      <label class="choice">
        <input
          :id="inputId"
          type="radio"
          :name="field.id"
          :checked="modelValue === true"
          @change="emit('update:modelValue', true)"
        />
        是
      </label>
      <label class="choice">
        <input
          type="radio"
          :name="field.id"
          :checked="modelValue === false"
          @change="emit('update:modelValue', false)"
        />
        否
      </label>
    </div>
    <p v-if="field.hint" :id="hintId" class="field__hint">{{ field.hint }}</p>
    <p v-if="error" :id="errorId" class="field__error"><span aria-hidden="true">⚠ </span>{{ error }}</p>
  </fieldset>

  <div v-else class="field">
    <label :for="inputId" class="field__label">{{ field.label }}{{ requiredText }}</label>

    <select
      v-if="field.type === 'select'"
      :id="inputId"
      v-model="text"
      class="control control--select"
      :aria-required="field.required"
      :aria-invalid="error ? 'true' : 'false'"
      :aria-describedby="describedBy"
    >
      <option value="">{{ field.placeholder ?? '請選擇' }}</option>
      <template v-for="group in groups" :key="group.label ?? ''">
        <optgroup v-if="group.label" :label="group.label">
          <option v-for="option in group.options" :key="option.value" :value="option.value">{{ option.label }}</option>
        </optgroup>
        <template v-else>
          <option v-for="option in group.options" :key="option.value" :value="option.value">{{ option.label }}</option>
        </template>
      </template>
    </select>

    <textarea
      v-else-if="field.type === 'textarea'"
      :id="inputId"
      v-model="text"
      class="control control--textarea"
      rows="3"
      :maxlength="field.maxLength"
      :placeholder="field.placeholder"
      :aria-required="field.required"
      :aria-invalid="error ? 'true' : 'false'"
      :aria-describedby="describedBy"
    ></textarea>

    <input
      v-else-if="field.type === 'date'"
      :id="inputId"
      v-model="text"
      class="control"
      type="date"
      :min="min"
      :max="max"
      :aria-required="field.required"
      :aria-invalid="error ? 'true' : 'false'"
      :aria-describedby="describedBy"
    />

    <input
      v-else
      :id="inputId"
      v-model="text"
      class="control"
      :type="field.type === 'tel' ? 'tel' : 'text'"
      :inputmode="field.type === 'tel' ? 'numeric' : undefined"
      autocomplete="off"
      :maxlength="field.maxLength"
      :placeholder="field.placeholder"
      :aria-required="field.required"
      :aria-invalid="error ? 'true' : 'false'"
      :aria-describedby="describedBy"
    />

    <p v-if="selectedDetail" :id="detailId" class="field__detail">{{ selectedDetail }}</p>
    <slot name="after-control"></slot>
    <p v-if="field.hint" :id="hintId" class="field__hint">{{ field.hint }}</p>
    <p v-if="error" :id="errorId" class="field__error"><span aria-hidden="true">⚠ </span>{{ error }}</p>
  </div>
</template>
