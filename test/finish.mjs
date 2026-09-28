/**
 * Finishing pass for the demo: decide every READ appeal, finalize every
 * appeal whose window has passed, close every closable drop, then every role
 * claims. Idempotent - safe to run repeatedly. Writes docs/seed-evidence.json.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { DEP, tx, view, log, logTo, nowS, sleep, accounts } from "./common.mjs";
logTo("../docs/seed-run.log");
const FD = DEP.FairDropDemo.address;
const cfg = await view(FD, "get_config");
for (let pass = 0; pass < 3; pass++) {
  const drops = (await view(FD, "get_drops", [0, 50])).drops;
  for (const d of drops) {
    if (d.closed) continue;
    for (const a of (await view(FD, "get_appeals", [d.drop_id])).appeals) {
      if (a.status === "READ" && (d.revealed || nowS() >= d.reveal_end_ts)) await tx("trigger", FD, "decide", [a.appeal_id], 0n, `finish: decide #${a.appeal_id}`);
      else if (a.status === "FILED" && !d.revealed && nowS() >= d.reveal_end_ts) await tx("trigger", FD, "decide", [a.appeal_id], 0n, `finish: default win #${a.appeal_id}`);
      else if (a.status === "PROVISIONAL" && nowS() >= a.decided_at + cfg.contest_window_s) await tx("trigger", FD, "finalize_appeal", [a.appeal_id], 0n, `finish: finalize #${a.appeal_id}`);
      else if (a.status === "FILED" && d.revealed && nowS() >= d.reveal_end_ts + cfg.contest_window_s) await tx("trigger", FD, "finalize_appeal", [a.appeal_id], 0n, `finish: unread expiry #${a.appeal_id}`);
    }
    const dv = (await view(FD, "get_drop", [d.drop_id])).drop;
    if (!dv.closed && dv.open_appeals === 0 && (nowS() >= dv.reveal_end_ts || dv.phase === "VOID")) {
      const who = dv.operator.toLowerCase() === accounts().opA.address.toLowerCase() ? "opA" : "trigger";
      await tx(who, FD, "close_drop", [dv.drop_id], 0n, `finish: close drop #${dv.drop_id}`);
    }
  }
  await sleep(5000);
}
// Claims run WHILE PAUSED (pause stops create_drop only); unpause once every
// drop is closed and every balance is pulled.
const acc = accounts();
const paused = (await view(FD, "get_config")).paused;
for (const role of Object.keys(acc)) {
  const owed = await view(FD, "payout_of", [acc[role].address]);
  if (owed?.owed_wei && owed.owed_wei !== "0") await tx(role, FD, "claim_payout", [], 0n, `${role} claims ${owed.owed_gen} GEN${paused ? " (contract paused)" : ""}`);
}
const allClosed = (await view(FD, "get_drops", [0, 50])).drops.every((d) => d.closed);
if (allClosed && (await view(FD, "get_config")).paused) await tx("deployer", FD, "set_paused", [false], 0n, "owner unpauses (every drop closed, every balance claimed)");
const stats = await view(FD, "get_stats");
log("STATS", JSON.stringify(stats));
const evidence = { contract: FD, at: new Date().toISOString(), config: await view(FD, "get_config"), stats, drops: {} };
const st = existsSync(new URL("./.seed-state.json", import.meta.url)) ? JSON.parse(readFileSync(new URL("./.seed-state.json", import.meta.url), "utf8")) : {};
const letter = Object.fromEntries(Object.entries(st).filter(([, v]) => v?.id).map(([k, v]) => [v.id, k]));
for (const d of (await view(FD, "get_drops", [0, 50])).drops) {
  const key = letter[d.drop_id] ?? String(d.drop_id);
  evidence.drops[key] = { drop: (await view(FD, "get_drop", [d.drop_id])).drop, appeals: (await view(FD, "get_appeals", [d.drop_id])).appeals };
  for (const a of evidence.drops[key].appeals) a.snapshot = (await view(FD, "get_appeal", [a.appeal_id])).appeal.snapshot;
}
writeFileSync(new URL("../docs/seed-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
log("wrote docs/seed-evidence.json");
