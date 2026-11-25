<script lang="ts">
  let count = $state(0);
</script>

<main>
  <h1>호봉</h1>
  <button onclick={() => (count += 1)}>눌러보기 {count}</button>
</main>
