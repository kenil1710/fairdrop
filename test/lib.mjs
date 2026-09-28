/**
 * FairDrop client helpers, shared by the seed scripts (and mirrored in the
 * app): canonical rules JSON, the sha256 commitment, and the flagged-list
 * merkle tree. Written to match contracts/FairDrop.py byte for byte; the
 * offline suite proves the contract's side, `node lib.mjs --self-test` this one.
 */
import { createHash, randomBytes } from "node:crypto";

export const sha256hex = (buf) => createHash("sha256").update(buf).digest("hex");

/** Canonical rules JSON: keys sorted, no whitespace, rules in order. */
export function canonRules(doc) {
  const parts = doc.rules.map((r) => `{"condition":"${r.condition}","finding":"${r.finding}","threshold":${
    typeof r.threshold === "number" ? String(r.threshold) : `"${r.threshold}"`}}`);
  return `{"min_hits":${doc.min_hits},"rules":[${parts.join(",")}]}`;
}

export const commitment = (doc, salt) => sha256hex(Buffer.from(canonRules(doc) + salt, "utf8"));
export const newSalt = () => randomBytes(32).toString("hex");

const leaf = (a) => createHash("sha256").update(Buffer.from(a.toLowerCase().slice(2), "hex")).digest();
const pair = (a, b) => createHash("sha256").update(Buffer.compare(a, b) <= 0 ? Buffer.concat([a, b]) : Buffer.concat([b, a])).digest();

/** { root, proofs: { wallet_lower: "hex,hex,..." } } - sorted pairs, odd node carried up. */
export function merkle(wallets) {
  let level = wallets.map(leaf);
  const idx = Object.fromEntries(wallets.map((w, i) => [w.toLowerCase(), i]));
  const proofs = Object.fromEntries(wallets.map((w) => [w.toLowerCase(), []]));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i]);
    for (const w of Object.keys(idx)) {
      const sib = idx[w] ^ 1;
      if (sib < level.length) proofs[w].push(level[sib].toString("hex"));
      idx[w] = Math.floor(idx[w] / 2);
    }
    level = next;
  }
  return { root: level[0].toString("hex"), proofs: Object.fromEntries(Object.entries(proofs).map(([k, v]) => [k, v.join(",")])) };
}

if (process.argv.includes("--self-test")) {
  const doc = { min_hits: 2, rules: [{ finding: "WALLET_AGE_DAYS", condition: "LT", threshold: 60 },
    { finding: "SCRIPTED_REPETITION", condition: "GTE", threshold: "SOME" }] };
  const ref = JSON.stringify({ min_hits: 2, rules: doc.rules.map((r) => ({ condition: r.condition, finding: r.finding, threshold: r.threshold })) });
  if (canonRules(doc) !== ref) throw new Error("canon mismatch");
  const { root, proofs } = merkle(["0x" + "11".repeat(20), "0x" + "22".repeat(20), "0x" + "33".repeat(20)]);
  console.log("ok", canonRules(doc), root, proofs);
}
