/**
 * A supplementary demo drop, E, for the scenarios the main v6 seed could not
 * read while Blockscout's Base API was answering HTTP 500 on most requests
 * (2026-09-28, 19:00 UTC; measured 21 of 36 probes failed). Same contract,
 * same rules machinery, reads in PARALLEL (one key each) so that one flaky
 * wallet does not starve the others.
 *
 *   E  opE/trigger… three human wallets on a 1 GEN reserve at 0.4 GEN each
 *      (pro-rata), the operator contests one HUMAN outcome (contest held or
 *      flipped - recorded), and a hyperactive wallet reads INSUFFICIENT and
 *      refiles after the reveal deadline (the v6 refile window).
 *
 *   node seed_extra.mjs          (resumable through test/.seed-state.json)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEP, GEN, W, tx, view, log, logTo, waitUntil, nowS, sleep, readAttempt } from "./common.mjs";
import { canonRules, commitment, merkle, newSalt } from "./lib.mjs";

logTo("../docs/seed-run.log");
const FD = DEP.FairDropDemo.address;
const STATE = new URL("./.seed-state.json", import.meta.url);
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
const NFT = "0x3c83ef6119eb05ca44144f05b331dbee60656d5b";
const RULES_E = { min_hits: 2, rules: [
  { finding: "WALLET_AGE_DAYS", condition: "LT", threshold: 30 },
  { finding: "SCRIPTED_REPETITION", condition: "EQ", threshold: "STRONG" },
] };
const flagged = [W.human_long_tail, W.human_diverse, W.human_swapper, W.too_active];
const labels = { [W.human_long_tail]: "long", [W.human_diverse]: "diverse", [W.human_swapper]: "swapper", [W.too_active]: "active" };
const readers = { long: "uiOp", diverse: "uiFlag", swapper: "outsider", active: "trigger2", refile: "trigger2" };

async function readUntil(aid, label, role, until) {
  for (let i = 1; nowS() < until - 30; i++) {
    const r = await readAttempt(role, FD, aid, `E/${label} attempt ${i}`);
    if (r.appeal.status !== "FILED") return r.appeal;
    await sleep(25_000);
  }
  return (await view(FD, "get_appeal", [aid])).appeal;
}

log(`v6 supplementary drop E on ${FD}`);
if ((await view(FD, "get_config")).paused) throw new Error("the demo is paused; run after the main seed unpauses");
if (!state.E) {
  const salt = newSalt();
  const { root, proofs, wallets } = merkle(flagged);
  const snap = nowS() + 180;
  const r = await tx("opA", FD, "create_drop", ["Thin Reserve II — pro-rata, contest, refile", "base", commitment(RULES_E, salt), snap, 900, 480, 1500,
    (GEN * 4n) / 10n, GEN / 20n, canonRules(RULES_E).length, RULES_E.rules.length, "DemoQuest", NFT], GEN, "E: create");
  if (r.json?.status !== "OK") throw new Error(JSON.stringify(r.json));
  state.E = { id: r.json.drop_id, salt, rules: RULES_E, root, proofs, flagged: wallets, snap, appeal_end: snap + 480, reveal_end: snap + 480 + 1500, op: "opA", appeals: {} };
  save();
}
const S = state.E;
const cfg = await view(FD, "get_config");
if (!(await view(FD, "get_drop", [S.id])).drop.flagged_root) {
  await waitUntil(S.snap, "E: for the snapshot");
  await tx("opA", FD, "publish_flagged", [S.id, S.flagged.join(","), true], 0n, "E: publish the flagged list (the contract computes the root)");
}
for (const w of flagged) {
  const label = labels[w];
  if (S.appeals[label]) continue;
  // no proof passed: membership is read from the published list
  const r = await tx("opA", FD, "file_appeal", [S.id, w, "", "Demo appeal on a thin-reserve drop."], GEN / 20n, `E/${label} (no proof: read from the published list)`);
  if (r.json?.status === "OK") { S.appeals[label] = r.json.appeal_id; save(); }
}
await waitUntil(S.appeal_end, "E: appeal window");
if (!(await view(FD, "get_drop", [S.id])).drop.revealed) await tx("opA", FD, "reveal_rules", [S.id, canonRules(S.rules), S.salt], 0n, "E: the committed rules");
const readUntilTs = S.reveal_end + cfg.contest_window_s;
await Promise.all(["long", "diverse", "swapper", "active"].map((k) => readUntil(S.appeals[k], k, readers[k], readUntilTs)));
// INSUFFICIENT refiles after the reveal deadline (the v6 window: until reveal_end + one contest window)
const act = (await view(FD, "get_appeal", [S.appeals.active])).appeal;
if (act.outcome === "INSUFFICIENT_HISTORY" && !S.appeals.refile) {
  await waitUntil(S.reveal_end + 5, "E: past the reveal deadline, to refile inside the extended window");
  const r = await tx("opA", FD, "file_appeal", [S.id, W.too_active, "", "Refiled after INSUFFICIENT_HISTORY, after the reveal deadline."], GEN / 20n, "E/refile after the reveal deadline");
  if (r.json?.status === "OK") { S.appeals.refile = r.json.appeal_id; save(); }
}
if (S.appeals.refile) {
  const ra = (await view(FD, "get_appeal", [S.appeals.refile])).appeal;
  await readUntil(S.appeals.refile, "refile", "trigger2", ra.read_until);
}
for (const k of ["long", "diverse", "swapper", "refile"]) {
  const id = S.appeals[k];
  if (id && (await view(FD, "get_appeal", [id])).appeal.status === "READ") await tx("trigger", FD, "decide", [id], 0n, `E/${k}`);
}
const div = (await view(FD, "get_appeal", [S.appeals.diverse])).appeal;
if (div.status === "PROVISIONAL" && !div.contested) {
  const bond = BigInt((await view(FD, "get_drop", [S.id])).drop.contest_bond_wei);
  await tx("opA", FD, "contest", [S.appeals.diverse, "Chain analysis links this wallet's first funding source to about forty wallets created in the same week."], bond, "E/diverse contest");
}
log("E: flows done; settling (finish.mjs)");
const { execSync } = await import("node:child_process");
for (let i = 0; i < 10; i++) {
  execSync("node finish.mjs", { cwd: new URL(".", import.meta.url), stdio: "inherit" });
  if ((await view(FD, "get_drops", [0, 50])).drops.every((d) => d.closed)) break;
  await waitUntil(nowS() + 240, "for the next settle pass");
}
