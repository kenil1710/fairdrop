/**
 * Seeds the v4 DEMO instance with every outcome the brief asks to see on
 * chain. Writes docs/seed-run.log; finish.mjs then settles, closes, claims and
 * writes docs/seed-evidence.json.
 *
 *   node seed.mjs            run everything (resumable: test/.seed-state.json)
 *
 * Four demo drops run CONCURRENTLY, each on its own operator and trigger key so
 * their transactions never race one nonce. All four are created first; then
 * the owner PAUSES the contract for the rest of the run, so everything below
 * (appeals, reveals, reads, contests, settle_stalled, payouts) is shown working
 * while paused - only create_drop is refused.
 *
 *   A  opA/trigger   HUMAN won and paid, SYBIL lost (bond to the pool),
 *                    INSUFFICIENT then refiled, a mismatched reveal refused
 *                    twice, a framing contest refused, a contest that holds
 *   B  opB/trigger4  the operator never reveals: pending appeals auto-won
 *   C  opC/trigger3  three winners on a 1 GEN reserve at 0.6 each: pro-rata
 *   D  opD/trigger5/prober  UNRESOLVED: (stall) three round tickets expire unrun and
 *                    settle_stalled counts them while paused; (split) a
 *                    borderline wallet under a one-rule threshold on
 *                    SCRIPTED_REPETITION, where validators that read SOME and
 *                    NONE compute different outcomes - whatever the chain does
 *                    with it is recorded
 *
 * v4 ORDER: reads run only after the reveal (every validator computes the
 * rule outcome from its own findings), and each read attempt is a ticket
 * (committed) plus a round (which may not settle). All reads go through ONE
 * queue on one key (trigger2), spaced for Blockscout's per-IP limit.
 *
 * The flagged wallets are PUBLIC Base wallets (docs/probe/demo-wallets.json),
 * filed on behalf by each drop's operator - which only the DEMO instance
 * allows. Outcomes are whatever the validators read; nothing is mocked.
 * Every wait polls the clock (common.waitUntil), so a sleeping machine cannot
 * stretch it; a write that never settles is given up on at 15 min and retried.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEP, GEN, W, tx, view, log, logTo, waitUntil, nowS, sleep, readAttempt } from "./common.mjs";
import { canonRules, commitment, merkle, newSalt } from "./lib.mjs";

logTo("../docs/seed-run.log");
const FD = DEP.FairDropDemo.address;
const STATE = new URL("./.seed-state.json", import.meta.url);
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
const NFT = "0x3c83ef6119eb05ca44144f05b331dbee60656d5b";
const QUEST = "0xdc2d2a919df4f31dd407415d65bcbb74d36aac70";
const CFG = await view(FD, "get_config");
const TTL = CFG.round_ttl_s;
log(`v4 demo seed on ${FD} (round ticket TTL ${TTL}s, contest window ${CFG.contest_window_s}s)`);

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
// One rule, on the one finding that split across validators in v1: a reading
// of SOME condemns, NONE clears. Exactly the threshold v3 let a leader cross.
const RULES_D = { min_hits: 1, rules: [{ finding: "SCRIPTED_REPETITION", condition: "GTE", threshold: "SOME" }] };

/** Reads are SERIALIZED across all drops on one key and spaced out: Blockscout
 *  v2 allows ~150 requests per ~5 min per IP and every validator fetches from
 *  one place. */
let readChain = Promise.resolve();
const READ_GAP_MS = 30_000;
function queued(fn) {
  const run = readChain.then(async () => { try { return await fn(); } finally { await sleep(READ_GAP_MS); } });
  readChain = run.catch(() => null);
  return run;
}
/** Read until the appeal leaves FILED; retries inside a live ticket. */
async function read(aid, label, tries = 8) {
  let a = null;
  for (let i = 1; i <= tries; i++) {
    const r = await queued(() => readAttempt("trigger2", FD, aid, `${label} attempt ${i}`));
    a = r.appeal;
    if (a.status !== "FILED") return a;
  }
  return a;
}

async function makeDrop(key, op, name, rules, flagged, contracts, win, reserve, alloc, bond) {
  if (!state[key]) {
    const salt = newSalt();
    const { root, proofs } = merkle(flagged);
    const snap = nowS() + 240;
    const r = await tx(op, FD, "create_drop", [name, "base", commitment(rules, salt), snap, 900, win.appeal, win.reveal, alloc, bond, "DemoQuest", contracts], reserve, `${key}: create`);
    if (r.json?.status !== "OK") throw new Error(`${key} create failed: ${JSON.stringify(r.json)}`);
    state[key] = { id: r.json.drop_id, salt, rules, root, proofs, flagged, snap, appeal_end: snap + win.appeal, reveal_end: snap + win.appeal + win.reveal, op, appeals: {} };
    save();
  }
  return state[key];
}

async function commitFlagged(S, key) {
  const d = (await view(FD, "get_drop", [S.id])).drop;
  if (!d.flagged_root) {
    await waitUntil(S.snap, `${key}: for the snapshot`);
    await tx(S.op, FD, "commit_flagged", [S.id, S.root, S.flagged.length], 0n, `${key}: commit the flagged list`);
  }
}

async function file(S, key, wallet, label, statement) {
  if (S.appeals[label]) return S.appeals[label];
  const d = (await view(FD, "get_drop", [S.id])).drop;
  const r = await tx(S.op, FD, "file_appeal", [S.id, wallet, S.proofs[wallet], statement], BigInt(d.bond_wei), `${key}/${label}`);
  if (r.json?.status === "OK") { S.appeals[label] = r.json.appeal_id; save(); }
  else {
    const of = await view(FD, "get_appeal_of", [S.id, wallet]);
    if (of?.found) { S.appeals[label] = of.appeal.appeal_id; save(); }
  }
  return S.appeals[label];
}

const appealsClosed = (S) => async () => (await view(FD, "get_drop", [S.id])).drop.phase !== "APPEALS_OPEN";

async function reveal(S, key) {
  await waitUntil(S.appeal_end, `${key}: for the appeal window to close`, appealsClosed(S));
  const dv = (await view(FD, "get_drop", [S.id])).drop;
  if (!dv.revealed) await tx(S.op, FD, "reveal_rules", [S.id, canonRules(S.rules), S.salt], 0n, `${key}: the committed rules`);
}

async function decide(role, aid, label) {
  const a = (await view(FD, "get_appeal", [aid])).appeal;
  if (a.status === "READ") await tx(role, FD, "decide", [aid], 0n, label);
}

async function dropA(S) {
  const ids = {};
  ids.human = await file(S, "A", W.human_long_tail, "human", "I have used this wallet since 2024 for swaps and transfers.");
  ids.farm = await file(S, "A", W.farm_minter_a, "farm", "Demo appeal filed on behalf of a public wallet.");
  ids.active = await file(S, "A", W.too_active, "active", "Demo appeal filed on behalf of a public wallet.");
  ids.diverse = await file(S, "A", W.human_diverse, "diverse", "Demo appeal: a long-lived wallet with varied activity.");
  await waitUntil(S.appeal_end, "A: for the appeal window to close", appealsClosed(S));
  const dv = (await view(FD, "get_drop", [S.id])).drop;
  if (!dv.revealed) {
    await tx("opA", FD, "reveal_rules", [S.id, canonRules({ ...S.rules, min_hits: 4 }), S.salt], 0n, "A: DIFFERENT rules than committed (must be refused)");
    await tx("opA", FD, "reveal_rules", [S.id, canonRules(S.rules), newSalt()], 0n, "A: right rules, wrong salt (must be refused)");
    await tx("opA", FD, "reveal_rules", [S.id, canonRules(S.rules), S.salt], 0n, "A: the committed rules");
  }
  for (const k of ["human", "farm", "active", "diverse"]) await read(ids[k], `A/${k}`);
  // INSUFFICIENT_HISTORY never condemns: the wallet refiles (until the reveal deadline).
  const act = (await view(FD, "get_appeal", [ids.active])).appeal;
  if (act.outcome === "INSUFFICIENT_HISTORY" && !S.appeals.active_refile) {
    const r = await tx("opA", FD, "file_appeal", [S.id, W.too_active, S.proofs[W.too_active], "Refiled after an INSUFFICIENT_HISTORY outcome."], GEN / 10n, "A/refile");
    if (r.json?.status === "OK") { S.appeals.active_refile = r.json.appeal_id; save(); }
  }
  if (S.appeals.active_refile) await read(S.appeals.active_refile, "A/refile");
  for (const k of ["human", "farm", "diverse"]) await decide("trigger", ids[k], `A/${k}`);
  const bondC = BigInt((await view(FD, "get_drop", [S.id])).drop.contest_bond_wei);
  const target = (await view(FD, "get_appeal", [ids.diverse])).appeal;
  if (target.status === "PROVISIONAL" && !target.contested) {
    // DEMO: the operator filed, so it is the losing side either way.
    await tx("opA", FD, "contest", [ids.diverse, "Our cluster analysis found this wallet shares a funding source with several flagged wallets."], bondC, "A/diverse contest text that FRAMES the case (must be refused: the model may not learn the wallet was flagged)");
    await tx("opA", FD, "contest", [ids.diverse, "Chain analysis links this wallet's first funding source to about forty wallets created in the same week."], bondC, "A/diverse contest");
  }
  const farm = (await view(FD, "get_appeal", [ids.farm])).appeal;
  if (farm.status === "PROVISIONAL" && !farm.contested) {
    await tx("opA", FD, "contest", [ids.farm, "Demo appeal filed on behalf of a public wallet."], bondC, "A/farm contest that COPIES the statement (novelty gate must refuse)");
  }
}

async function dropB(S) {
  const a1 = await file(S, "B", W.farm_minter_b, "minter", "Demo appeal on a drop whose operator will never reveal.");
  const a2 = await file(S, "B", W.human_swapper, "swapper", "Demo appeal on a drop whose operator will never reveal.");
  await waitUntil(S.appeal_end, "B: for the appeal window to close", appealsClosed(S));
  await tx("trigger4", FD, "read_wallet", [a1], 0n, "B: a read with the rules still sealed (must be refused)");
  await waitUntil(S.reveal_end, "B: past the reveal deadline with no reveal",
    async () => (await view(FD, "get_drop", [S.id])).drop.phase === "REVEAL_MISSED");
  for (const aid of [a1, a2]) {
    const a = (await view(FD, "get_appeal", [aid])).appeal;
    if (a.status === "FILED") await tx("trigger4", FD, "decide", [aid], 0n, "B: operator missed the reveal → default win");
  }
}

async function dropC(S) {
  const ids = [];
  for (const [label, w] of [["long", W.human_long_tail], ["diverse", W.human_diverse], ["swapper", W.human_swapper]]) {
    ids.push(await file(S, "C", w, label, "Demo appeal on a thin-reserve drop, filed while the contract is paused."));
  }
  await reveal(S, "C");
  for (const aid of ids) await read(aid, `C/${aid}`);
  for (const aid of ids) await decide("trigger3", aid, `C/${aid}`);
}

/** Wait out a live ticket, then count it: settle_stalled (permissionless,
 *  works while paused). */
async function expire(aid, label, role) {
  const a = (await view(FD, "get_appeal", [aid])).appeal;
  if (a.status !== "FILED" || !a.round_open_at) return a;
  await waitUntil(a.round_open_at + TTL, `${label}: ticket #${a.rounds_opened} to expire`);
  const r = await tx(role, FD, "settle_stalled", [aid], 0n, `${label}: settle_stalled while paused counts the unsettled round`);
  const b = (await view(FD, "get_appeal", [aid])).appeal;
  log(`    ${label}: ${b.status} ${b.outcome} unsettled ${b.unsettled_rounds}/${CFG.max_unsettled_rounds} (${r.json?.status})`);
  return b;
}

async function dropD(S) {
  const split = await file(S, "D", W.human_diverse, "split", "Demo appeal: a borderline wallet under a one-rule threshold.");
  const stall = await file(S, "D", W.farm_quester, "stall", "Demo appeal whose read rounds never land.");
  await reveal(S, "D");
  // STALL: three tickets opened and never run - rounds that never land.
  const stallRun = (async () => {
    for (let i = 0; i < 6; i++) {
      let a = (await view(FD, "get_appeal", [stall])).appeal;
      if (a.status !== "FILED") break;
      if (!a.round_open_at) await tx("trigger5", FD, "read_wallet", [stall], 0n, `D/stall: open round ticket ${a.rounds_opened + 1} (it will never be run)`);
      await expire(stall, "D/stall", "trigger5");
    }
    const a = (await view(FD, "get_appeal", [stall])).appeal;
    if (a.outcome === "UNRESOLVED" && !S.appeals.stall_refile) {
      const r = await tx("opD", FD, "file_appeal", [S.id, W.farm_quester, S.proofs[W.farm_quester], "Refiled after UNRESOLVED."], BigInt((await view(FD, "get_drop", [S.id])).drop.bond_wei), "D/stall: UNRESOLVED is refileable");
      if (r.json?.status === "OK") { S.appeals.stall_refile = r.json.appeal_id; save(); }
    }
    if (S.appeals.stall_refile) await read(S.appeals.stall_refile, "D/stall-refile");
  })();
  // SPLIT: one round per ticket on the borderline wallet.
  const splitRun = (async () => {
    for (let t = 1; t <= 4; t++) {
      let a = (await view(FD, "get_appeal", [split])).appeal;
      if (a.status !== "FILED") break;
      const r = await queued(() => readAttempt("trigger2", FD, split, `D/split ticket ${a.rounds_opened + (a.round_open_at ? 0 : 1)}`));
      if (r.appeal.status !== "FILED") break;
      if (r.round === "UNDETERMINED" || r.round === "UNSETTLED") { await expire(split, "D/split", "prober"); continue; }
      // landed but UNAVAILABLE: the ticket closed; try again.
    }
    await decide("prober", split, "D/split");
  })();
  await Promise.all([stallRun, splitRun]);
}

// ---- run ----
const S = {};
S.A = await makeDrop("A", "opA", "Base Quest Season 1 — main", RULES_A, [W.human_long_tail, W.farm_minter_a, W.too_active, W.human_diverse], `${NFT},${QUEST}`, { appeal: 600, reveal: 3000 }, 3n * GEN, GEN, GEN / 10n);
S.B = await makeDrop("B", "opB", "Silent Operator — never reveals", RULES_B, [W.farm_minter_b, W.human_swapper], NFT, { appeal: 600, reveal: 900 }, GEN, (GEN * 4n) / 10n, GEN / 20n);
S.C = await makeDrop("C", "opC", "Thin Reserve — pro-rata payout", RULES_C, [W.human_long_tail, W.human_diverse, W.human_swapper], NFT, { appeal: 600, reveal: 3000 }, GEN, (GEN * 6n) / 10n, GEN / 20n);
S.D = await makeDrop("D", "opD", "Borderline — rounds that never settle", RULES_D, [W.human_diverse, W.farm_quester], NFT, { appeal: 600, reveal: 3600 }, GEN, GEN / 2n, GEN / 20n);
for (const k of ["A", "B", "C", "D"]) log(`${k}: drop #${S[k].id} snapshot ${new Date(S[k].snap * 1000).toISOString()} appeals until ${new Date(S[k].appeal_end * 1000).toISOString()} reveal by ${new Date(S[k].reveal_end * 1000).toISOString()}`);
if (!state.pausedOnce) {
  await tx("deployer", FD, "set_paused", [true], 0n, "owner PAUSES the contract for the rest of the run");
  state.pausedOnce = true; save();
  await tx("prober", FD, "create_drop", ["Paused?", "base", "00".repeat(32), nowS() + 600, 10, 3600, 3600, GEN, GEN / 10n, "", ""], GEN, "create_drop while paused (must be refused)");
}
for (const k of ["A", "B", "C", "D"]) await commitFlagged(S[k], k);
await Promise.all([dropA(S.A), dropB(S.B), dropC(S.C), dropD(S.D)]);
log("all drop flows done; settling (finish.mjs)");
const { execSync } = await import("node:child_process");
const lastEnd = Math.max(...Object.values(S).map((s) => s.reveal_end));
for (let i = 0; i < 12; i++) {
  execSync("node finish.mjs", { cwd: new URL(".", import.meta.url), stdio: "inherit" });
  const drops = (await view(FD, "get_drops", [0, 50])).drops;
  if (drops.every((d) => d.closed)) break;
  await waitUntil(Math.max(nowS() + 120, Math.min(lastEnd + CFG.contest_window_s, nowS() + 600)), "for the next settle pass");
}
