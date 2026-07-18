<script lang="ts">
  import type { PlanCheck } from "../../../server/plan.ts";
  import { checkAssertion } from "../lib/detail-view.ts";

  interface Props { checks: PlanCheck[] }
  let { checks }: Props = $props();
</script>

<section class="detail-section" aria-labelledby="verification-title">
  <div class="detail-section-heading">
    <span>02</span>
    <h2 id="verification-title">Verification contract</h2>
  </div>
  <div class="detail-check-list">
    {#each checks as check}
      <article class="detail-check">
        <span class="detail-check-mark" aria-hidden="true"></span>
        <div>
          <strong>{check.type.replaceAll("_", " ")}</strong>
          <p>{checkAssertion(check)}</p>
        </div>
        <code>{String(check.target)}</code>
      </article>
    {/each}
  </div>
</section>
