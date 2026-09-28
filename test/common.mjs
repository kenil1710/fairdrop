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

/** Wait until chain time (≈ wall clock) passes `ts` + margin. */
export async function waitUntil(ts, label = "") {
  const ms = ts * 1000 - Date.now() + 5000;
  if (ms > 0) { log(`  … waiting ${(ms / 1000).toFixed(0)}s ${label}`); await sleep(ms); }
}

export const nowS = () => Math.floor(Date.now() / 1000);
export { accounts, sleep };
