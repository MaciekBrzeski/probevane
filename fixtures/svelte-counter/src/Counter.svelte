<script lang="ts">
  import { increment, clamp, isEven } from './counter';
  export let start = 0;
  export let max = 10;
  let count = start;
  $: parity = isEven(count) ? 'even' : 'odd';
  function bump() { count = clamp(increment(count), 0, max); }
  function reset() { count = start; }
</script>
<h2>Counter</h2>
<p aria-label="count">{count}</p>
<p aria-label="parity">{parity}</p>
<button aria-label="increment" on:click={bump}>+</button>
<button aria-label="reset" on:click={reset}>reset</button>
