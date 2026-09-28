/**
 * Patient reader: every FILED appeal on the demo, one read at a time, spaced
 * out so the validators' shared Blockscout budget can recover (measured: 150
 * v2 requests per ~5 min per IP). Stops when nothing readable is left.
 */
import { DEP, tx, view, log, logTo, sleep, nowS } from "./common.mjs";
logTo("../docs/seed-run.log");
const FD = DEP.FairDropDemo.address;
const until = nowS() + Number(process.argv[2] ?? 2400);
while (nowS() < until) {
  const drops = (await view(FD, "get_drops", [0, 50])).drops;
  const todo = [];
  for (const d of drops) {
    if (d.closed || d.phase === "REVEAL_MISSED") continue;
    for (const a of (await view(FD, "get_appeals", [d.drop_id])).appeals) if (a.status === "FILED" && !a.in_flight) todo.push(a.appeal_id);
  }
  if (!todo.length) { log("  patient reader: nothing left to read"); break; }
  for (const aid of todo) {
    const r = await tx("trigger2", FD, "read_wallet", [aid], 0n, `patient read #${aid}`);
    const a = (await view(FD, "get_appeal", [aid])).appeal;
    log(`    patient #${aid}: round ${r.out?.status} → ${a.status} ${a.outcome} ${a.status === "FILED" ? "(" + (r.json?.why ?? "not applied") + ")" : JSON.stringify(a.findings)}`);
    await sleep(75_000);
  }
}
