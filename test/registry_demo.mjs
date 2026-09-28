/** FairDropRegistry on chain: is_cleared for a winner and a loser, and attest. */
import { writeFileSync, readFileSync } from "node:fs";
const st = JSON.parse(readFileSync(new URL("./.seed-state.json", import.meta.url), "utf8"));
import { DEP, W, tx, view, log, logTo } from "./common.mjs";
logTo("../docs/registry-run.log");
const R = DEP.FairDropRegistry.address;
const out = { registry: R, reads: DEP.FairDropRegistry.reads, checks: [] };
for (const [label, wallet, drop] of [["A/human (won by the rules)", W.human_long_tail, st.A.id], ["A/farm (lost)", W.farm_minter_a, st.A.id], ["A/too_active (insufficient)", W.too_active, st.A.id], ["B/minter (default win)", W.farm_minter_b, st.B.id], ["E/diverse (won, contest held)", W.human_diverse, st.E.id], ["F/long (default win, pro-rata)", W.human_long_tail, st.F.id], ["D/swapper (griefed, then unread)", W.human_swapper, st.D.id]]) {
  const cleared = await view(R, "is_cleared", [wallet, drop]);
  log(`  is_cleared(${label}) = ${cleared}`);
  const r = await tx("outsider", R, "attest", [wallet, drop], 0n, `attest ${label}`);
  out.checks.push({ label, wallet, drop, is_cleared: cleared, attest: r.json, tx: r.hash });
}
out.config = await view(R, "get_config");
writeFileSync(new URL("../docs/registry-evidence.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
log("wrote docs/registry-evidence.json");
