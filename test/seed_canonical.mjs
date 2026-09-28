/**
 * The CANONICAL instance on chain: sender == wallet, 48-hour contest window.
 *
 * Our own keys (flagged1, flagged2) are flagged. They have no history on any
 * Blockscout chain (docs/PROBE.md), so a read of them honestly reads an EMPTY
 * history - which is exactly what a canonical appeal from them can show.
 * What this proves on chain:
 *   - the flagged wallet appeals from itself (OK)
 *   - a stranger filing FOR a flagged wallet is refused (loophole 4)
 *   - the operator filing for a flagged wallet is refused (canonical, not demo)
 *   - a non-flagged wallet is refused by the merkle proof (loophole 3)
 *   - the same wallet twice is refused (loophole 8)
 *   - a read before the reveal is refused (v4: the outcome needs the rules)
 *   - the operator cannot close the drop during appeals (loophole 6)
 *   - after the 1-hour appeal window: reveal, blind read (ticket + round),
 *     decide. The 48-hour contest window then stays open, by design.
 * Resumable (test/.canonical-state.json); waits poll the clock.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEP, GEN, tx, view, log, logTo, waitUntil, nowS, sleep, accounts, readAttempt } from "./common.mjs";
import { canonRules, commitment, merkle, newSalt } from "./lib.mjs";

logTo("../docs/canonical-run.log");
const FD = DEP.FairDrop.address;
const acc = accounts();
const F1 = acc.flagged1.address.toLowerCase();
const F2 = acc.flagged2.address.toLowerCase();
const STATE = new URL("./.canonical-state.json", import.meta.url);
const st = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(st, null, 2) + "\n");
const RULES = { min_hits: 2, rules: [
  { finding: "WALLET_AGE_DAYS", condition: "LT", threshold: 30 },
  { finding: "OUTBOUND_TX_COUNT", condition: "LT", threshold: 3 },
  { finding: "ORGANIC_DIVERSITY", condition: "EQ", threshold: "LOW" },
] };

if (!st.id) {
  st.salt = newSalt();
  const { root, proofs } = merkle([F1, F2]);
  Object.assign(st, { root, proofs, snap: nowS() + 240 });
  const r = await tx("canonOp", FD, "create_drop", ["Canonical — keys we control", "base", commitment(RULES, st.salt), st.snap, 365, 3600, 3600, GEN / 2n, GEN / 20n, "CanonProto", ""], GEN);
  if (r.json?.status !== "OK") throw new Error(JSON.stringify(r.json));
  st.id = r.json.drop_id; st.appeal_end = st.snap + 3600; st.reveal_end = st.appeal_end + 3600; save();
}
log(`canonical drop #${st.id} on ${FD}`);
const d0 = (await view(FD, "get_drop", [st.id])).drop;
if (!d0.flagged_root) { await waitUntil(st.snap, "for the snapshot"); await tx("canonOp", FD, "commit_flagged", [st.id, st.root, 2]); }
if (!st.probed) {
  await tx("outsider", FD, "file_appeal", [st.id, F2, st.proofs[F2], "Filing for a wallet I do not control"], GEN / 20n, "LOOPHOLE 4: a stranger files for flagged2 (must be refused)");
  await tx("canonOp", FD, "file_appeal", [st.id, F2, st.proofs[F2], "Operator on behalf"], GEN / 20n, "canonical: the operator files for flagged2 (must be refused)");
  await tx("outsider", FD, "file_appeal", [st.id, acc.outsider.address, st.proofs[F1], "Not flagged"], GEN / 20n, "LOOPHOLE 3: a non-flagged wallet appeals (must be refused)");
}
if (!st.a1) {
  const r = await tx("flagged1", FD, "file_appeal", [st.id, F1, st.proofs[F1], "This is my own wallet and I appeal from it."], GEN / 20n, "flagged1 appeals FROM ITSELF");
  if (r.json?.status === "OK") { st.a1 = r.json.appeal_id; save(); }
  else { const of = await view(FD, "get_appeal_of", [st.id, F1]); if (of?.found) { st.a1 = of.appeal.appeal_id; save(); } }
}
if (!st.probed) {
  await tx("flagged1", FD, "file_appeal", [st.id, F1, st.proofs[F1], "Again"], GEN / 20n, "LOOPHOLE 8: same wallet twice (must be refused)");
  await tx("canonOp", FD, "close_drop", [st.id], 0n, "LOOPHOLE 6: operator closes during appeals (must be refused)");
  await tx("canonTrigger", FD, "read_wallet", [st.a1], 0n, "v4: a read before the reveal (must be refused: the outcome needs the rules)");
  st.probed = true; save();
}
await waitUntil(st.appeal_end, "the 1-hour appeal window", async () => (await view(FD, "get_drop", [st.id])).drop.phase !== "APPEALS_OPEN");
if (!(await view(FD, "get_drop", [st.id])).drop.revealed) await tx("canonOp", FD, "reveal_rules", [st.id, canonRules(RULES), st.salt], 0n, "canonical reveal");
for (let i = 1; i <= 6; i++) {
  const { appeal } = await readAttempt("canonTrigger", FD, st.a1, `canonical #${st.a1} attempt ${i}`);
  if (appeal.status !== "FILED") break;
  await sleep(30_000);
}
const a1 = (await view(FD, "get_appeal", [st.a1])).appeal;
if (a1.status === "READ") await tx("canonTrigger", FD, "decide", [st.a1], 0n, "canonical decide (the 48-hour contest window opens)");
const out = { contract: FD, at: new Date().toISOString(), drop: (await view(FD, "get_drop", [st.id])).drop, appeals: (await view(FD, "get_appeals", [st.id])).appeals, config: await view(FD, "get_config"), stats: await view(FD, "get_stats") };
writeFileSync(new URL("../docs/canonical-evidence.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
log("wrote docs/canonical-evidence.json");
