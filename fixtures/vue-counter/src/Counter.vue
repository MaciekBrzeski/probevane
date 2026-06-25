<script setup lang="ts">
import { ref, computed } from 'vue';
import { increment, clamp, isEven } from './counter';

const props = withDefaults(defineProps<{ start?: number; max?: number }>(), { start: 0, max: 10 });

const count = ref(props.start);
const parity = computed(() => (isEven(count.value) ? 'even' : 'odd'));

function bump() {
  count.value = clamp(increment(count.value), 0, props.max);
}
function reset() {
  count.value = props.start;
}
</script>

<template>
  <section>
    <h2>Counter</h2>
    <p aria-label="count">{{ count }}</p>
    <p aria-label="parity">{{ parity }}</p>
    <button aria-label="increment" @click="bump">+</button>
    <button aria-label="reset" @click="reset">reset</button>
  </section>
</template>
