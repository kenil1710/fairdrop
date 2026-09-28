/** On-chain probe: one DEMO drop, one appeal on a real Base wallet, one blind read. */
import { DEP, GEN, W, as, tx, view, log, logTo, waitUntil, nowS } from "./common.mjs";
import { commitment, merkle, newSalt } from "./lib.mjs";
import { writeFileSync } from "node:fs";
logTo("../docs/probe/onchain-read.log");
const FD = DEP.FairDropDemo.address;
const rules = { min_hits: 2, rules: [{ finding: "WALLET_AGE_DAYS", condition: "LT", threshold: 60 }, { finding: "SCRIPTED_REPETITION", condition: "GTE", threshold: "SOME" }] };
const salt = newSalt();
const flagged = [W.human_long_tail, W.farm_minter_a];
const { root, proofs } = merkle(flagged);
const snap = nowS() + 300;
log(`probe drop on ${FD} snapshot=${snap}`);
const c = await tx("opD", FD, "create_drop", ["Probe: one blind read", "base", commitment(rules, salt), snap, 900, 2400, 1200, GEN / 2n, GEN / 20n, "ProbeProto", ""], GEN);
const id = c.json?.drop_id;
writeFileSync(new URL("./.probe-secret.json", import.meta.url), JSON.stringify({ id, rules, salt, root, proofs, snap }, null, 2));
await waitUntil(snap, "for the snapshot");
await tx("opD", FD, "commit_flagged", [id, root, 2]);
const f = await tx("opD", FD, "file_appeal", [id, W.human_long_tail, proofs[W.human_long_tail], "Probe appeal"], GEN / 20n);
const aid = f.json?.appeal_id;
for (let i = 0; i < 3; i++) {
  const r = await tx("trigger", FD, "read_wallet", [aid]);
  log(JSON.stringify(r.json)?.slice(0, 600));
  if (r.json?.read === "READ" || r.json?.read === "INSUFFICIENT") break;
}
const a = await view(FD, "get_appeal", [aid]);
log(JSON.stringify(a.appeal?.features), JSON.stringify(a.appeal?.findings));
log(a.appeal?.snapshot);
