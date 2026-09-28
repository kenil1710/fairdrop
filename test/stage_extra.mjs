/** Decide the late-read appeals and stage the novelty-gate refusal on chain. */
import { DEP, tx, view, log, logTo } from "./common.mjs";
logTo("../docs/seed-run.log");
const FD = DEP.FairDropDemo.address;
for (const id of [3, 6]) {
  const a = (await view(FD, "get_appeal", [id])).appeal;
  if (a.status === "READ") await tx("trigger", FD, "decide", [id], 0n, `late decide #${id}`);
}
const farm = (await view(FD, "get_appeal", [3])).appeal;
log(`  #3 now ${farm.status} ${farm.outcome} trace hits ${farm.trace?.hits}/${farm.trace?.min_hits}`);
const d = (await view(FD, "get_drop", [farm.drop_id])).drop;
if (farm.status === "PROVISIONAL" && !farm.contested) {
  await tx("opA", FD, "contest", [3, farm.statement], BigInt(d.contest_bond_wei), "A/farm contest that COPIES the statement (novelty gate must refuse)");
  await tx("opA", FD, "contest", [3, farm.statement.toUpperCase() + " " + farm.statement], BigInt(d.contest_bond_wei), "A/farm contest that re-cases and repeats the statement (novelty gate must refuse)");
}
