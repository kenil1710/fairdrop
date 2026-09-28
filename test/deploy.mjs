/**
 * Deploys FairDrop (canonical + demo) and FairDropRegistry to Studio Dev.
 *
 *   node deploy.mjs --all        canonical, demo and the registry
 *   node deploy.mjs --canonical  | --demo | --registry
 *
 * CANONICAL: FairDrop(False) - the brief exactly: sender must be the wallet,
 * 48-hour contest window, 1-hour read-round ticket, windows of at least an hour.
 * DEMO: FairDrop(True, 600, 600, 30) - same source; the operator may file on
 * behalf of a named public wallet, windows are minutes. get_config says DEMO.
 * The registry reads the DEMO instance, the one with settled outcomes.
 *
 * The source sha256 is recorded so "source == deployed" is checkable with one
 * command (tools/verify_source.mjs compares against the chain's own copy).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient, createAccount } from "genlayer-js";
import { CHAINS, accounts, fundOnStudio, deploy, gen, argOf } from "./harness.mjs";

const chain = CHAINS.studiodev;
const all = process.argv.includes("--all");
const want = (f) => all || process.argv.includes(f);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const acc = accounts();
const account = createAccount(acc.deployer.key);
const wallet = createClient({ chain, account });
const read = createClient({ chain });
await fundOnStudio(chain, account.address, 1000n * 10n ** 18n);
console.log(`deployer ${account.address} balance ${gen(await read.getBalance({ address: account.address }))} GEN`);

const path = new URL("../deployments.json", import.meta.url);
const doc = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
doc.deployments ??= {};
const rec = doc.deployments.studiodev ?? { network: "studiodev", chain_id: chain.id };
const persist = () => { rec.explorer = "https://explorer-studio-dev.genlayer.com/"; doc.deployments.studiodev = rec; writeFileSync(path, JSON.stringify(doc, null, 2) + "\n"); };

const code = readFileSync(new URL("../contracts/FairDrop.py", import.meta.url));
const regCode = readFileSync(new URL("../contracts/FairDropRegistry.py", import.meta.url));
const version = String(code).match(/^RUBRIC_VERSION = "([^"]+)"/m)[1];

async function one(name, source, args, extra) {
  console.log(`\n${name}  args=${JSON.stringify(args)}  ${source.length} bytes`);
  const res = await deploy({ chain, wallet, read, code: source, args, label: name });
  if (!res.ok) {
    console.error(`${name} FAILED`, res.out?.status, res.reason ?? "", res.out?.stderr?.slice(-2000) ?? "");
    persist();
    process.exit(1);
  }
  console.log(`  address ${res.address}`);
  const prev = rec[name];
  if (prev?.address && prev.address !== res.address) {
    rec.superseded ??= [];
    rec.superseded.push({ ...prev, name, superseded_by: res.address,
      superseded_because: argOf("reason", "replaced by a redeploy") });
  }
  rec[name] = { address: res.address, deploy_tx: res.hash, source_bytes: source.length,
    source_sha256: sha256(source), owner: account.address, constructor_args: args,
    deployed_at: new Date().toISOString(), ...extra };
  persist();
}

if (want("--canonical")) await one("FairDrop", code, [false], { mode: "CANONICAL", rubric_version: version, contest_window_s: 172800, stall_ttl_s: 3600 });
if (want("--demo")) await one("FairDropDemo", code, [true, 600, 600, 30], { mode: "DEMO", rubric_version: version, contest_window_s: 600, stall_ttl_s: 600 });
if (want("--registry")) {
  const target = rec.FairDropDemo?.address;
  if (rec.FairDropRegistry?.reads === target) { console.log("registry already reads the current demo"); process.exit(0); }
  if (!target) throw new Error("deploy the demo first");
  await one("FairDropRegistry", regCode, [target], { reads: target, custody: false, payable_methods: 0 });
}
console.log("\nwrote deployments.json");
