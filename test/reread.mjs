/** Re-read one demo appeal until a round settles. `node reread.mjs <appeal_id> [role]` */
import { DEP, tx, view, log, logTo, sleep } from "./common.mjs";
logTo("../docs/seed-run.log");
const FD = DEP.FairDropDemo.address;
const aid = Number(process.argv[2]);
const role = process.argv[3] ?? "trigger2";
for (let i = 1; i <= 8; i++) {
  const r = await tx(role, FD, "read_wallet", [aid], 0n, `re-read #${aid} attempt ${i}`);
  const a = (await view(FD, "get_appeal", [aid])).appeal;
  if (a.status !== "FILED") { log(`    re-read #${aid}: ${a.status} ${a.outcome} ${JSON.stringify(a.features)} ${JSON.stringify(a.findings)} (round ${r.out?.status})`); break; }
  log(`    re-read #${aid}: round ${r.out?.status}, still FILED`);
  await sleep(15000);
}
