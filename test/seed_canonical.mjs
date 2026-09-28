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
 *   - the blind read runs on the canonical instance
 *   - the operator cannot close the drop during appeals (loophole 6)
 *   - (phase 2, `--reveal`) reveal and decide after the 1-hour windows
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEP, GEN, tx, view, log, logTo, waitUntil, nowS, sleep, accounts } from "./common.mjs";
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
if (!process.argv.includes("--reveal")) {
  const d = (await view(FD, "get_drop", [st.id])).drop;
  if (!d.flagged_root) { await waitUntil(st.snap, "for the snapshot"); await tx("canonOp", FD, "commit_flagged", [st.id, st.root, 2]); }
  await tx("outsider", FD, "file_appeal", [st.id, F2, st.proofs[F2], "Filing for a wallet I do not control"], GEN / 20n, "LOOPHOLE 4: a stranger files for flagged2 (must be refused)");
  await tx("canonOp", FD, "file_appeal", [st.id, F2, st.proofs[F2], "Operator on behalf"], GEN / 20n, "canonical: the operator files for flagged2 (must be refused)");
  await tx("outsider", FD, "file_appeal", [st.id, acc.outsider.address, st.proofs[F1], "Not flagged"], GEN / 20n, "LOOPHOLE 3: a non-flagged wallet appeals (must be refused)");
  if (!st.a1) {
    const r = await tx("flagged1", FD, "file_appeal", [st.id, F1, st.proofs[F1], "This is my own wallet and I appeal from it."], GEN / 20n, "flagged1 appeals FROM ITSELF");
    if (r.json?.status === "OK") { st.a1 = r.json.appeal_id; save(); }
  }
  await tx("flagged1", FD, "file_appeal", [st.id, F1, st.proofs[F1], "Again"], GEN / 20n, "LOOPHOLE 8: same wallet twice (must be refused)");
  await tx("canonOp", FD, "close_drop", [st.id], 0n, "LOOPHOLE 6: operator closes during appeals (must be refused)");
  for (let i = 0; i < 5; i++) {
    const r = await tx("trigger", FD, "read_wallet", [st.a1], 0n, "blind read on the canonical instance");
    if (r.json?.read === "READ" || r.json?.read === "INSUFFICIENT") { log(JSON.stringify(r.json)); break; }
    await sleep(20_000);
  }
} else {
  await waitUntil(st.appeal_end, "the 1-hour appeal window");
  await tx("canonOp", FD, "reveal_rules", [st.id, canonRules(RULES), st.salt]);
  await tx("trigger", FD, "decide", [st.a1]);
}
const out = { contract: FD, drop: (await view(FD, "get_drop", [st.id])).drop, appeals: (await view(FD, "get_appeals", [st.id])).appeals, config: await view(FD, "get_config") };
writeFileSync(new URL("../docs/canonical-evidence.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
log("wrote docs/canonical-evidence.json");
