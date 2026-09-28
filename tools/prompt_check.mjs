/**
 * Loophole 10, on chain: read back the EXACT prompts the model saw (get_prompt,
 * rebuilt by the contract from storage with the same function the validators
 * ran) for every read appeal on BOTH instances, and check that none contains:
 *   - the drop's revealed rules JSON, salt or commitment, or any rule line
 *     (finding + condition, or the canonical "condition" key);
 *   - a threshold word (threshold, min_hits, rule/rules);
 *   - the flag or its reason: "flag", the appellant's statement, the drop's
 *     name, or case framing (sybil, airdrop, appeal).
 * Case-insensitive for words. Prints JSON.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(new URL("../test/package.json", import.meta.url));
const { createClient } = require("genlayer-js");
const { studioDevnet } = require("genlayer-js/chains");
const dep = JSON.parse(readFileSync(new URL("../deployments.json", import.meta.url), "utf8")).deployments.studiodev;
const client = createClient({ chain: studioDevnet });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Studio meters views at 30/min and 500/hour per IP: wait a rate limit out
// (up to ~30 min) rather than report "0 prompts checked".
async function v(address, fn, args) {
  for (let i = 0; i < 40; i++) {
    try { return JSON.parse(await client.readContract({ address, functionName: fn, args })); }
    catch (e) { await sleep(/per hour/i.test(String(e?.message)) ? 60000 : 12000); }
  }
  throw new Error(fn);
}
const WORDS = ["threshold", "min_hits", "rule", "flag", "sybil", "airdrop", "appeal"];
const out = { contracts: [dep.FairDropDemo.address, dep.FairDrop.address], checked: [], ok: true };
for (const FD of out.contracts) {
  for (const d of (await v(FD, "get_drops", [0, 50])).drops) {
    const exact = [d.rules_hash, d.name];
    if (d.revealed) {
      exact.push(d.rules_json, d.salt);
      for (const r of d.rules.rules) exact.push(`${r.finding} ${r.condition}`, `"condition":"${r.condition}"`, `${r.finding}=${r.threshold}`);
    }
    for (const a of (await v(FD, "get_appeals", [d.drop_id])).appeals) {
      const p = await v(FD, "get_prompt", [a.appeal_id]);
      if (!p.found) continue;
      const text = p.read_prompt + "\n" + p.contest_prompt;
      const lower = text.toLowerCase();
      const banned = [...exact, a.statement].filter(Boolean);
      const leaked = [...banned.filter((b) => text.includes(b)), ...WORDS.filter((w) => lower.includes(w))];
      out.checked.push({ contract: FD, drop: d.drop_id, appeal: a.appeal_id, outcome: a.outcome, prompt_chars: text.length,
        has_contest_prompt: Boolean(p.contest_prompt), revealed: d.revealed, leaked });
      if (leaked.length) out.ok = false;
      await sleep(2500);
    }
  }
}
console.log(JSON.stringify(out));
