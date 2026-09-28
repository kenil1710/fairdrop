/** Seed-script plumbing: role clients, a logged `tx`, and waiting on chain time. */
import { readFileSync, appendFileSync } from "node:fs";
import { connect, fundOnStudio, returnedJson, sleep, CHAINS, accounts } from "./harness.mjs";

export const DEP = JSON.parse(readFileSync(new URL("../deployments.json", import.meta.url), "utf8")).deployments.studiodev;
export const GEN = 10n ** 18n;
export const WALLETS = JSON.parse(readFileSync(new URL("../docs/probe/demo-wallets.json", import.meta.url), "utf8"));
export const W = Object.fromEntries(Object.entries(WALLETS).map(([k, v]) => [k, v.address.toLowerCase()]));

let LOG = null;
export function logTo(path) { LOG = new URL(path, import.meta.url); }
export function log(...a) {
  const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  console.log(line);
  if (LOG) appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`);
}

const clients = {};
export async function as(role, address) {
  const k = `${role}@${address}`;
  if (!clients[k]) {
    clients[k] = connect({ address, role });
    await fundOnStudio(CHAINS.studiodev, clients[k].account.address, 200n * GEN);
  }
  return clients[k];
}

/** Send a write, log it, return { json, out }. Never throws. */
export async function tx(role, address, fn, args = [], value = 0n, note = "") {
  const c = await as(role, address);
  const t0 = Date.now();
  const out = await c.send(fn, args, value);
  const json = returnedJson(out);
  log(`  ${role.padEnd(8)} ${fn}(${args.map((x) => String(x).slice(0, 18)).join(", ")})${value ? ` +${Number(value) / 1e18} GEN` : ""}`,
    `→ ${out.status} ${json?.status ?? "(unreadable)"} ${json?.reason ?? ""}`.trim(), `[${((Date.now() - t0) / 1000).toFixed(0)}s] ${note}`, `tx=${out.hash ?? "-"}`);
  return { json, out, hash: out.hash };
}

export async function view(address, fn, args = []) {
  const c = await as("trigger", address);
  const raw = await c.view(fn, args);
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return raw; }
}

/**
 * Wait until chain time (≈ wall clock on Studio) passes `ts` + margin.
 *
 * POLLS in short steps instead of one long sleep. A timer does not run while
 * the machine is asleep, so a single 40-minute sleep started before a laptop
 * lid closes can end 40 minutes after it reopens; a 15 s poll re-reads the
 * clock the moment the machine wakes. `check` (optional) reads chain state and
 * ends the wait early once the chain already agrees.
 */
export async function waitUntil(ts, label = "", check = null) {
  const target = ts + 5;
  if (nowS() >= target) return;
  log(`  … waiting until ${new Date(target * 1000).toISOString()} (${target - nowS()}s) ${label}`);
  let lastNote = Date.now();
  let lastCheck = 0;
  while (nowS() < target) {
    // The clock is re-read every 15 s (local, free); the chain at most every
    // 5 minutes. MEASURED: Studio puts views (gen_call), sends and fee
    // estimates in one 500-per-hour bucket per IP, and a run that checked the
    // chain every 15 s from five actors exhausted it mid-seed.
    if (check && Date.now() - lastCheck > 300_000) {
      lastCheck = Date.now();
      try { if (await check()) return; } catch { /* a blind poll is not an answer */ }
    }
    await sleep(Math.min(15_000, Math.max(1_000, (target - nowS()) * 1000)));
    if (Date.now() - lastNote > 300_000) { log(`  … still waiting ${target - nowS()}s ${label}`); lastNote = Date.now(); }
  }
}

/**
 * One read attempt: a single read_wallet round. Success is judged from STATE,
 * never from the leader's return value (an UNDETERMINED round can still carry
 * a leader payload in its receipt).
 */
export async function readAttempt(role, FD, aid, label) {
  let a = (await view(FD, "get_appeal", [aid])).appeal;
  if (a.status !== "FILED") return { appeal: a, round: "ALREADY" };
  const r = await tx(role, FD, "read_wallet", [aid], 0n, `${label}: read round`);
  a = (await view(FD, "get_appeal", [aid])).appeal;
  const agreed = r.json?.agreed_outcome ? ` agreed_outcome=${r.json.agreed_outcome}` : "";
  log(`    ${label}: round ${r.out?.status} → ${a.status}${a.outcome ? " " + a.outcome : ""} ${JSON.stringify(a.features)} ${JSON.stringify(a.findings)}${agreed} (landed ${a.read_attempts}, splits ${a.split_rounds}${a.last_read_status ? ", last " + a.last_read_status : ""})`);
  return { appeal: a, round: r.out?.status, hash: r.hash };
}

export const nowS = () => Math.floor(Date.now() / 1000);
export { accounts, sleep };
