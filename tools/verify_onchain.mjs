/**
 * Reads each deployed contract's source BACK OFF THE CHAIN (gen_getContractCode)
 * and compares it byte for byte with the file in this repository, and with the
 * sha256 recorded at deploy time. `node tools/verify_onchain.mjs [--json]`
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../test/package.json", import.meta.url));
const { studioDevnet } = require("genlayer-js/chains");
const root = new URL("../", import.meta.url);
const dep = JSON.parse(readFileSync(new URL("deployments.json", root), "utf8")).deployments.studiodev;
const url = studioDevnet.rpcUrls.default.http[0];
const sha = (b) => createHash("sha256").update(b).digest("hex");

async function codeOf(address) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_getContractCode", params: [address] }) });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return Buffer.from(String(json.result), "base64");
}

const rows = [];
let failures = 0;
for (const [name, src] of [["FairDrop", "contracts/FairDrop.py"], ["FairDropDemo", "contracts/FairDrop.py"], ["FairDropRegistry", "contracts/FairDropRegistry.py"]]) {
  if (!dep[name]) continue;
  const local = readFileSync(new URL(src, root));
  let onchain = Buffer.alloc(0);
  let err = "";
  try { onchain = await codeOf(dep[name].address); } catch (e) { err = String(e.message); }
  const identical = Buffer.compare(local, onchain) === 0;
  const recorded = dep[name].source_sha256 === sha(local);
  if (!identical || !recorded) failures++;
  rows.push({ name, address: dep[name].address, chain_bytes: onchain.length, chain_sha256: sha(onchain), repo_bytes: local.length, repo_sha256: sha(local), identical, recorded_sha_matches: recorded, error: err });
  console.log(`  ${identical && recorded ? "ok  " : "FAIL"} ${name.padEnd(17)} ${dep[name].address} chain ${onchain.length}B ${sha(onchain).slice(0, 16)}… repo ${local.length}B ${sha(local).slice(0, 16)}… identical=${identical}${err ? " " + err : ""}`);
}
if (process.argv.includes("--json")) console.log(JSON.stringify(rows));
process.exit(failures ? 1 : 0);
