/**
 * Seeds the DEMO instance with every outcome the brief asks to see on chain,
 * and drives the canonical instance through the part of its lifecycle that
 * fits in a session. Writes docs/seed-run.log and docs/seed-evidence.json.
 *
 *   node seed.mjs            run everything (resumable: test/.seed-state.json)
 *
 * Three demo drops run CONCURRENTLY, each on its own operator key so their
 * transactions never race one nonce:
 *
 *   A  opA  main drop: HUMAN won and paid, SYBIL lost (bond to reserve),
 *           INSUFFICIENT then refiled, reveal mismatch refused, contest held
 *   B  opB  the operator never reveals: pending appeals auto-won
 *   C  opC  three winners on a 1 GEN reserve at 0.6 each: pro-rata; run while
 *           the owner has PAUSED the contract (appeals, reads, payouts and
 *           settle_stalled all keep working; only create_drop is refused)
 *
 * The flagged wallets are PUBLIC Base wallets (docs/probe/demo-wallets.json),
 * filed on behalf by each drop's operator - which only the DEMO instance
 * allows. Outcomes are whatever the validators read; nothing is mocked.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEP, GEN, W, tx, view, log, logTo, waitUntil, nowS, sleep } from "./common.mjs";
import { canonRules, commitment, merkle, newSalt } from "./lib.mjs";

logTo("../docs/seed-run.log");
const FD = DEP.FairDropDemo.address;
const STATE = new URL("./.seed-state.json", import.meta.url);
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
const NFT = "0x3c83ef6119eb05ca44144f05b331dbee60656d5b";
const QUEST = "0xdc2d2a919df4f31dd407415d65bcbb74d36aac70";

const RULES_A = { min_hits: 2, rules: [
  { finding: "WALLET_AGE_DAYS", condition: "LT", threshold: 60 },
  { finding: "DISTINCT_CONTRACTS_TOUCHED", condition: "LTE", threshold: 1 },
  { finding: "SCRIPTED_REPETITION", condition: "GTE", threshold: "SOME" },
  { finding: "SINGLE_PURPOSE_FARMING", condition: "GTE", threshold: "SOME" },
] };
const RULES_B = { min_hits: 1, rules: [{ finding: "OUTBOUND_TX_COUNT", condition: "LT", threshold: 1000 }] };
const RULES_C = { min_hits: 2, rules: [
  { finding: "WALLET_AGE_DAYS", condition: "LT", threshold: 30 },
  { finding: "SCRIPTED_REPETITION", condition: "EQ", threshold: "STRONG" },
] };

/**
 * Reads are SERIALIZED across all drops and spaced out. Measured: Blockscout
 * v2 allows ~150 requests per ~5 min per IP, a read costs two requests per
 * validator, and every validator fetches from one place. A round that did not
 * settle (UNDETERMINED) applied nothing, so success is judged from STATE, never
 * from the leader's return value.
 */
let readChain = Promise.resolve();
const READ_GAP_MS = 30_000;
function read(role, aid, label) {
  const run = readChain.then(async () => {
    let result = null;
    for (let i = 1; i <= 10; i++) {
      const r = await tx(role, FD, "read_wallet", [aid], 0n, `${label} read attempt ${i}`);
      const a = (await view(FD, "get_appeal", [aid]))?.appeal;
      if (a && a.status !== "FILED") {
        log(`    ${label}: ${a.status === "READ" ? "READ" : a.outcome} ${JSON.stringify(a.features)} ${JSON.stringify(a.findings)} (round ${r.out?.status})`);
        result = a;
        break;
      }
      log(`    ${label}: round ${r.out?.status}, still FILED (${r.json?.why ?? r.json?.reason ?? "round not applied"})`);
      await sleep(i < 3 ? 45_000 : 90_000);
    }
    await sleep(READ_GAP_MS);
    return result;
  });
  readChain = run.catch(() => null);
  return run;
}

async function makeDrop(key, op, name, rules, flagged, contracts, win, reserve, alloc, bond) {
  if (!state[key]) {
    const salt = newSalt();
    const { root, proofs } = merkle(flagged);
    const snap = nowS() + 240;
    const r = await tx(op, FD, "create_drop", [name, "base", commitment(rules, salt), snap, 900, win.appeal, win.reveal, alloc, bond, "DemoQuest", contracts], reserve);
    if (r.json?.status !== "OK") throw new Error(`${key} create failed: ${JSON.stringify(r.json)}`);
    state[key] = { id: r.json.drop_id, salt, rules, root, proofs, snap, appeal_end: snap + win.appeal, reveal_end: snap + win.appeal + win.reveal, op, appeals: {} };
    save();
  }
  const S = state[key];
  const d = (await view(FD, "get_drop", [S.id])).drop;
  if (!d.flagged_root) {
    await waitUntil(S.snap, `${key}: for the snapshot`);
    await tx(op, FD, "commit_flagged", [S.id, S.root, flagged.length]);
  }
  return S;
}

async function file(S, key, wallet, label, statement) {
  if (S.appeals[label]) return S.appeals[label];
  const d = (await view(FD, "get_drop", [S.id])).drop;
  const r = await tx(S.op, FD, "file_appeal", [S.id, wallet, S.proofs[wallet], statement], BigInt(d.bond_wei), `${key}/${label}`);
  if (r.json?.status === "OK") { S.appeals[label] = r.json.appeal_id; save(); }
  else {
    const of = (await view(FD, "get_appeal_of", [S.id, wallet]));
    if (of?.found) { S.appeals[label] = of.appeal.appeal_id; save(); }
  }
  return S.appeals[label];
}

async function dropA() {
  const flagged = [W.human_long_tail, W.farm_minter_a, W.too_active, W.human_diverse];
  const S = await makeDrop("A", "opA", "Base Quest Season 1 — main", RULES_A, flagged, `${NFT},${QUEST}`,
    { appeal: 1800, reveal: 2400 }, 3n * GEN, GEN, GEN / 10n);
  log(`A: drop #${S.id}`);
  const ids = {};
  ids.human = await file(S, "A", W.human_long_tail, "human", "I have used this wallet since 2024 for swaps and transfers.");
  ids.farm = await file(S, "A", W.farm_minter_a, "farm", "Demo appeal filed on behalf of a public wallet.");
  ids.active = await file(S, "A", W.too_active, "active", "Demo appeal filed on behalf of a public wallet.");
  ids.diverse = await file(S, "A", W.human_diverse, "diverse", "Demo appeal: a long-lived wallet with varied activity.");
  for (const k of ["human", "farm", "active", "diverse"]) await read("trigger", ids[k], `A/${k}`);
  // INSUFFICIENT_HISTORY never condemns: the wallet refiles.
  const act = (await view(FD, "get_appeal", [ids.active])).appeal;
  if (act.outcome === "INSUFFICIENT_HISTORY" && !S.appeals.active_refile) {
    const r = await tx("opA", FD, "file_appeal", [S.id, W.too_active, S.proofs[W.too_active], "Refiled after an INSUFFICIENT_HISTORY outcome."], GEN / 10n, "A/refile");
    if (r.json?.status === "OK") { S.appeals.active_refile = r.json.appeal_id; save(); }
  }
  if (S.appeals.active_refile) await read("trigger", S.appeals.active_refile, "A/refile");
  // reveal: a mismatch first (refused), then the real one
  await waitUntil(S.appeal_end, "A: for the appeal window to close");
  const dv = (await view(FD, "get_drop", [S.id])).drop;
  if (!dv.revealed) {
    const lenient = { ...S.rules, min_hits: 4 };
    await tx("opA", FD, "reveal_rules", [S.id, canonRules(lenient), S.salt], 0n, "A: DIFFERENT rules than committed (must be refused)");
    await tx("opA", FD, "reveal_rules", [S.id, canonRules(S.rules), newSalt()], 0n, "A: right rules, wrong salt (must be refused)");
    await tx("opA", FD, "reveal_rules", [S.id, canonRules(S.rules), S.salt], 0n, "A: the committed rules");
  }
  for (const k of ["human", "farm", "diverse"]) {
    const a = (await view(FD, "get_appeal", [ids[k]])).appeal;
    if (a.status === "READ") await tx("trigger", FD, "decide", [ids[k]], 0n, `A/${k}`);
  }
  // Contest: the losing side contests once with new evidence.
  const dvv = (await view(FD, "get_drop", [S.id])).drop;
  const target = (await view(FD, "get_appeal", [ids.diverse])).appeal;
  if (target.status === "PROVISIONAL" && !target.contested) {
    const loser = target.outcome === "HUMAN_PATTERN" ? "opA" : "opA"; // DEMO: the operator filed, so it is both sides
    await tx(loser, FD, "contest", [ids.diverse, "Our cluster analysis found this wallet shares a funding source with several flagged wallets."], BigInt(dvv.contest_bond_wei), "A/diverse contest text that FRAMES the case (must be refused: the model may not learn the wallet was flagged)");
    await tx(loser, FD, "contest", [ids.diverse, "Chain analysis links this wallet's first funding source to about forty wallets created in the same week."], BigInt(dvv.contest_bond_wei), "A/diverse contest");
    // and the novelty gate: repeating the statement is refused
  }
  const farm = (await view(FD, "get_appeal", [ids.farm])).appeal;
  if (farm.status === "PROVISIONAL" && !farm.contested) {
    await tx("opA", FD, "contest", [ids.farm, "Demo appeal filed on behalf of a public wallet."], BigInt(dvv.contest_bond_wei), "A/farm contest that COPIES the statement (novelty gate must refuse)");
  }
  return S;
}

async function dropB() {
  const flagged = [W.farm_minter_b, W.human_swapper];
  const S = await makeDrop("B", "opB", "Silent Operator — never reveals", RULES_B, flagged, NFT,
    { appeal: 900, reveal: 1500 }, GEN, (GEN * 4n) / 10n, GEN / 20n);
  log(`B: drop #${S.id}`);
  const a1 = await file(S, "B", W.farm_minter_b, "minter", "Demo appeal on a drop whose operator will never reveal.");
  const a2 = await file(S, "B", W.human_swapper, "swapper", "Demo appeal on a drop whose operator will never reveal.");
  await read("trigger2", a1, "B/minter");
  await waitUntil(S.reveal_end, "B: past the reveal deadline with no reveal");
  for (const aid of [a1, a2]) await tx("trigger", FD, "decide", [aid], 0n, "B: operator missed the reveal → default win");
  return S;
}

async function dropC() {
  const flagged = [W.human_long_tail, W.human_diverse, W.human_swapper];
  // Pause the contract for this drop's whole life (after creating it - create is the one thing pause stops).
  const S = await makeDrop("C", "opC", "Thin Reserve — pro-rata payout", RULES_C, flagged, NFT,
    { appeal: 1500, reveal: 2400 }, GEN, (GEN * 6n) / 10n, GEN / 20n);
  log(`C: drop #${S.id}`);
  const cfg = await view(FD, "get_config");
  if (!cfg.paused && !state.pausedOnce) {
    await tx("deployer", FD, "set_paused", [true], 0n, "owner PAUSES the contract");
    state.pausedOnce = true; save();
    await tx("outsider", FD, "create_drop", ["Paused?", "base", "00".repeat(32), nowS() + 600, 10, 3600, 3600, GEN, GEN / 10n, "", ""], GEN, "create_drop while paused (must be refused)");
  }
  const ids = [];
  for (const [label, w] of [["long", W.human_long_tail], ["diverse", W.human_diverse], ["swapper", W.human_swapper]]) {
    ids.push(await file(S, "C", w, label, "Demo appeal on a thin-reserve drop, filed while the contract is paused."));
  }
  await tx("trigger3", FD, "settle_stalled", [ids[0]], 0n, "settle_stalled while paused (reaches its own check, not a pause refusal)");
  for (const aid of ids) await read("trigger3", aid, `C/${aid}`);
  await waitUntil(S.appeal_end, "C: appeal window");
  const dv = (await view(FD, "get_drop", [S.id])).drop;
  if (!dv.revealed) await tx("opC", FD, "reveal_rules", [S.id, canonRules(S.rules), S.salt]);
  for (const aid of ids) {
    const a = (await view(FD, "get_appeal", [aid])).appeal;
    if (a.status === "READ") await tx("trigger3", FD, "decide", [aid]);
  }
  return S;
}

async function settleAll(S, key) {
  // finalize provisional appeals after the contest window, then close, then claim
  const cw = (await view(FD, "get_config")).contest_window_s;
  const list = (await view(FD, "get_appeals", [S.id])).appeals;
  const latest = Math.max(0, ...list.filter((a) => a.status === "PROVISIONAL").map((a) => a.decided_at + cw));
  await waitUntil(Math.max(latest, S.reveal_end), `${key}: contest windows and reveal deadline`);
  for (const a of list) {
    if (a.status === "PROVISIONAL" || a.status === "FILED") await tx("trigger", FD, "finalize_appeal", [a.appeal_id], 0n, `${key}/${a.appeal_id}`);
    if (a.status === "READ") await tx("trigger", FD, "decide", [a.appeal_id], 0n, `${key}/${a.appeal_id}`);
  }
  const d = (await view(FD, "get_drop", [S.id])).drop;
  if (!d.closed) {
    if (key === "A") await tx(S.op, FD, "close_drop", [S.id], 0n, "A: operator closes");
    else await tx("trigger", FD, "close_drop", [S.id], 0n, `${key}: anyone closes`);
  }
}

const [A, B, C] = await Promise.all([dropA(), dropB(), dropC()]);
// Settlement is the idempotent finishing pass (finish.mjs): decide, finalize
// once contest windows close, close every drop, everyone claims, evidence.
const cw = (await view(FD, "get_config")).contest_window_s;
await waitUntil(Math.max(A.reveal_end, B.reveal_end, C.reveal_end) + cw + 20, "every reveal deadline and contest window");
const { execSync } = await import("node:child_process");
for (let i = 0; i < 3; i++) {
  execSync("node finish.mjs", { cwd: new URL(".", import.meta.url), stdio: "inherit" });
  const drops = (await view(FD, "get_drops", [0, 50])).drops;
  if (drops.every((d) => d.closed)) break;
  await sleep(120_000);
}
