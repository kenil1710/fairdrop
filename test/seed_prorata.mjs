/**
 * Drop F: pro-rata when the reserve is short, independent of the explorer.
 *
 * The v6 seed's pro-rata drops (C, E) could not read enough wallets while
 * Blockscout's Base API answered HTTP 500 on most requests. Pro-rata does not
 * depend on HOW appeals won, so F uses the one path that needs no read: the
 * operator never reveals, every pending appeal wins by default, and two
 * winners at 0.6 GEN on a 1 GEN reserve must each get the same 0.5 GEN.
 *
 *   node seed_prorata.mjs      (resumable through test/.seed-state.json)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEP, GEN, W, tx, view, log, logTo, waitUntil, nowS } from "./common.mjs";
import { commitment, merkle, newSalt, canonRules } from "./lib.mjs";

logTo("../docs/seed-run.log");
const FD = DEP.FairDropDemo.address;
const STATE = new URL("./.seed-state.json", import.meta.url);
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
const RULES_F = { min_hits: 1, rules: [{ finding: "OUTBOUND_TX_COUNT", condition: "LT", threshold: 1000 }] };
const flagged = [W.human_long_tail, W.human_diverse];

if (!state.F) {
  const salt = newSalt();
  const { root, wallets } = merkle(flagged);
  const snap = nowS() + 90;
  const r = await tx("opB", FD, "create_drop", ["Short Reserve — pro-rata by default wins", "base", commitment(RULES_F, salt), snap, 900, 90, 90,
    (GEN * 6n) / 10n, GEN / 20n, canonRules(RULES_F).length, 1, "DemoQuest", ""], GEN, "F: create (1 GEN reserve, 0.6 GEN allocation)");
  if (r.json?.status !== "OK") throw new Error(JSON.stringify(r.json));
  state.F = { id: r.json.drop_id, salt, rules: RULES_F, root, flagged: wallets, snap, appeal_end: snap + 90, reveal_end: snap + 180, op: "opB", appeals: {} };
  save();
}
const S = state.F;
if (!(await view(FD, "get_drop", [S.id])).drop.flagged_root) {
  await waitUntil(S.snap, "F: for the snapshot");
  await tx("opB", FD, "publish_flagged", [S.id, S.flagged.join(","), true], 0n, "F: publish the flagged list");
}
for (const w of flagged) {
  const k = w === W.human_long_tail ? "long" : "diverse";
  if (S.appeals[k]) continue;
  const r = await tx("opB", FD, "file_appeal", [S.id, w, "", "Demo appeal on a drop whose operator will not reveal."], GEN / 20n, `F/${k}`);
  if (r.json?.status === "OK") { S.appeals[k] = r.json.appeal_id; save(); }
}
await waitUntil(S.reveal_end, "F: past the reveal deadline with no reveal");
for (const k of ["long", "diverse"]) {
  const a = (await view(FD, "get_appeal", [S.appeals[k]])).appeal;
  if (a.status === "FILED") await tx("trigger4", FD, "decide", [S.appeals[k]], 0n, `F/${k}: operator missed the reveal → default win`);
}
const d = (await view(FD, "get_drop", [S.id])).drop;
if (!d.closed) {
  const r = await tx("trigger4", FD, "close_drop", [S.id], 0n, "F: close — two winners at 0.6 GEN on a 1 GEN reserve");
  log(`    F: winners ${r.json?.winners} per_winner_wei ${r.json?.per_winner_wei} pro_rata ${r.json?.pro_rata} leftover ${r.json?.leftover_wei}`);
}
const { execSync } = await import("node:child_process");
execSync("node finish.mjs", { cwd: new URL(".", import.meta.url), stdio: "inherit" });
