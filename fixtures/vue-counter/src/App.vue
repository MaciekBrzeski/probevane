<script setup lang="ts">
import Counter from './Counter.vue';
</script>

<template>
  <main>
    <h1>Vue Counter</h1>
    <Counter :start="0" :max="5" />
  </main>
</template>
