/**
 * Creates test/.accounts.json - a stable pool of signing keys for Studio Dev.
 *
 * Keys are generated here with randomBytes and persisted, never read back off
 * createAccount() (which does not expose the key). Existing roles are
 * preserved unless --force is passed, so a funded address is never replaced.
 *
 *   deployer    deploys and owns both FairDrop instances (pause switch only)
 *   opA..opD    drop operators on the DEMO instance, one per seeded drop so
 *               their transactions never race one nonce
 *   canonOp     the operator of the canonical drop
 *   flagged1/2  keys we control that are flagged on the canonical drop and
 *               appeal from themselves (sender == wallet)
 *   trigger     calls the permissionless methods (read, decide, finalize,
 *               close) and earns nothing for it
 *   outsider    only ever probes access control
 *   trigger2    runs every demo read (one serialized queue)
 *   trigger3/4/5  drive drops C, B and D; canonTrigger the canonical drop;
 *               prober the pause probe - one key per concurrent actor
 *
 * Usage: node accounts.mjs [--force]
 */
import { createAccount } from "genlayer-js";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const target = new URL("./.accounts.json", import.meta.url);
const force = process.argv.includes("--force");
const ROLES = ["deployer", "opA", "opB", "opC", "opD", "canonOp", "flagged1",
  "flagged2", "trigger", "trigger2", "trigger3", "outsider", "trigger4",
  "trigger5", "canonTrigger", "prober"];
const existing = existsSync(target) && !force ? JSON.parse(readFileSync(target, "utf8")) : {};
const out = {};
for (const role of ROLES) {
  if (existing[role]?.key) { out[role] = existing[role]; continue; }
  const key = `0x${randomBytes(32).toString("hex")}`;
  const account = createAccount(key);
  if (createAccount(key).address !== account.address) throw new Error(`unstable key for ${role}`);
  out[role] = { key, address: account.address };
}
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
for (const role of ROLES) console.log(`  ${role.padEnd(10)} ${out[role].address}`);
