/**
 * Loophole 10, on chain: read the EXACT prompts the model saw (get_prompt,
 * rebuilt by the contract from storage) for every read appeal on the demo, and
 * check none contains its drop's revealed rules JSON, salt, commitment, any
 * rule line, or the words the prompt must never use. Prints JSON.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(new URL("../test/package.json", import.meta.url));
const { createClient } = require("genlayer-js");
const { studioDevnet } = require("genlayer-js/chains");
const dep = JSON.parse(readFileSync(new URL("../deployments.json", import.meta.url), "utf8")).deployments.studiodev;
const client = createClient({ chain: studioDevnet });
const FD = dep.FairDropDemo.address;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function v(fn, args) {
  for (let i = 0; i < 6; i++) {
    try { return JSON.parse(await client.readContract({ address: FD, functionName: fn, args })); } catch { await sleep(12000); }
  }
  throw new Error(fn);
}
const out = { contract: FD, checked: [], ok: true };
for (const d of (await v("get_drops", [0, 50])).drops) {
  if (!d.revealed) continue;
  const banned = [d.rules_json, d.salt, d.rules_hash, "min_hits", "threshold", "flagged", "sybil", "SYBIL", "airdrop", "appeal"];
  for (const r of d.rules.rules) banned.push(`${r.finding} ${r.condition}`, `"condition":"${r.condition}"`);
  for (const a of (await v("get_appeals", [d.drop_id])).appeals) {
    const p = await v("get_prompt", [a.appeal_id]);
    if (!p.found) continue;
    const text = p.read_prompt + "\n" + p.contest_prompt;
    const hits = banned.filter((b) => b && text.includes(b));
    out.checked.push({ drop: d.drop_id, appeal: a.appeal_id, prompt_chars: text.length, leaked: hits });
    if (hits.length) out.ok = false;
    await sleep(2500);
  }
}
console.log(JSON.stringify(out));
