<script setup lang="ts">
// eslint-disable-next-line ts/prefer-ts-expect-error
// @ts-ignore tsconfig
import { NuxtLink } from '#components'

withDefaults(defineProps<{
  to?: string
  icon?: string
  border?: boolean
  disabled?: boolean
}>(), {
  border: true,
})
</script>

<template>
  <Component
    :is="to ? NuxtLink : 'button'"
    :to="to"
    v-bind="$attrs"
    :class="[
      { 'n-button-base active:n-button-active focus-visible:n-focus-base hover:n-button-hover': border },
      { 'n-icon-button': !$slots.default },
    ]"
    class="n-button n-transition n-disabled:n-disabled"
  >
    <slot name="icon">
      <NIcon v-if="icon" :icon="icon" :class="{ 'n-button-icon': $slots.default }" />
    </slot>
    <slot />
  </Component>
</template>
