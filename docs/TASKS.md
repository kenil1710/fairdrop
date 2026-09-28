# FairDrop v4 — checklist

Status: `[ ]` open · `[~]` in progress · `[x]` done and verified (evidence noted)

## 1. Tolerance fix
- [x] Deterministic features + snapshot hash compared exactly (unchanged) — `_agree_read`
- [x] Model findings may differ by one bucket (either direction); the rule outcome each validator computes from its OWN findings must be identical, else the round does not settle
- [x] Reads run after the reveal (outcome needs the rules); the model prompt is still snapshot-only
- [x] Contest round: same outcome-identity requirement
- [x] Attempt tickets: a round that never lands is counted when its ticket expires; 3 → UNRESOLVED (bond back, refileable until the reveal deadline, no payout, never SYBIL)
- [x] Tests (TestOutcomeIdentity, TestUnresolved, lifecycles; 717 pass): leader shading across a threshold refused; 3 undetermined attempts → UNRESOLVED; UNRESOLVED never pays or condemns

## 2. Redeploy v4
- [x] Deploy FairDrop 0xe206…f889, FairDropDemo 0x9779…1849, FairDropRegistry 0x8E3E…405c
- [x] Source byte-for-byte vs repo (verify_onchain: identical ×3) and GitHub main (identical)
- [x] deployments.json: v4 current, v3 marked superseded (with superseded_by + reason)

## 3. Reseed v4
- [x] Seed polls chain state (no long sleeps); stuck >20 min → retry or settle_stalled
- [x] HUMAN_PATTERN won and paid (A #1, 1 GEN)
- [x] SYBIL_PATTERN lost (A #5, bond to pool)
- [x] INSUFFICIENT_HISTORY refiled (A #10 → #12, both INSUFFICIENT, never SYBIL)
- [x] UNRESOLVED path (D #9: 3 expired tickets counted by settle_stalled while paused → refiled #13). Genuine split did NOT recur on chain (D #4 read SOME on all validators → SYBIL); split path proven offline
- [x] Mismatched reveal refused (×2 on A, bad_reveals=2)
- [x] No-reveal auto-win (B #3, #7)
- [x] Contest held (A #11 HUMAN → HUMAN; framing text and copied text refused)
- [x] Pro-rata when reserve is short (C: 3 × 0.333 GEN)
- [x] settle_stalled while paused (3 calls on D #9; whole demo ran paused)

## 4. Finish
- [x] Every provisional appeal settled, all 4 demo drops closed, every account claimed (demo books 0/0/0; canonical payable claimed, 1.05 GEN locked under its open 48 h window)
- [x] docs/seed-evidence.json from chain reads
- [x] Registry demo run (docs/registry-evidence.json)

## 5. Audit
- [x] Full audit: 40/40 (docs/AUDIT.md)
- [x] Every model prompt read back from chain (9, both instances): no rules, thresholds, flag reason

## 6. Docs and deploy
- [x] README addresses + seed outcome table generated (tools/readme_fill.py); audit fails on mismatch
- [x] README leads with trust problem + mechanism; required sentence; honest limits
- [x] docs/ARTICLE.md and docs/X_POST.md final numbers
- [x] Vercel env → v4, prod redeployed; live bundle (18 chunks) has all 3 v4 addresses, 0 superseded
- [x] Pushed to GitHub, no co-author trailers

## 7. Final 7-point check
- [x] 1 PASS — outcome/deterministic exact; one-bucket difference can't flip outcome
- [x] 2 PASS — truncated history never SYBIL (test + on-chain)
- [x] 3 PASS — prompt never contains rules/thresholds/flag reason
- [x] 4 PASS — mismatched reveal refused; no reveal → auto-win (on chain)
- [x] 5 PASS — books drain to 0 (canonical excluded: window open)
- [x] 6 PASS — source byte-identical; README == deployments.json
- [x] 7 PASS — no assistant name or co-author trailer in history, blobs, messages (tools/final_check.py)

---

# Binding audit (v5)

| # | item | initial | action |
|---|---|---|---|
| 1 | snapshot binding | FAIL (funder/first_seen could be post-snapshot) | [x] fixed: first_seen/funding ≤ snapshot; TestBinding.test_01_* |
| 2 | age at snapshot | PASS | [x] TestBinding.test_02_* |
| 3 | coverage vs post-snapshot activity | PASS | [x] TestBinding.test_03_* (60 post-snapshot tx → INSUFFICIENT, model never asked) |
| 4 | ticket griefing | FAIL (anyone opens; unrun ticket counts) | [x] tickets removed; settle_stalled = split round that only settles on a real outcome split; TestUnresolved griefing tests; on-chain griefing attempt in seed D |
| 5 | refile after UNRESOLVED | FAIL (refile window can close first) | [x] refile until reveal_end + contest window; per-appeal read deadline; test_refile_after_unresolved_after_the_reveal_deadline |
| 6 | first funder | FAIL (unproven funder guessed) | [x] funder_proven; UNCLEAR by code; INSUFFICIENT when rules use it; TestBinding.test_06_* |
| 7 | merkle | FAIL (no domain prefixes) | [x] 0x00 leaf / 0x01 node in contract, lib.mjs, frontend, fixtures (roots cross-checked); TestBinding.test_07_* |
| 8 | rules JSON | PASS | [x] 23 malformed documents refused at reveal (TestBinding.test_08_*) |
| 9 | commit before snapshot | PASS | [x] TestBinding.test_09_late_commit_is_refused |
| 10 | chain binding | PASS | [x] TestBinding.test_10_* (only the drop's host; no chain argument anywhere) |
| 11 | other bindings | FAIL (unreadable outbound timestamps dropped) | [x] mined+unreadable → INSUFFICIENT, pending skipped; live labels documented; TestBinding.test_11_* |
- [x] redeploy v5 (verified byte-identical), Vercel env → v5
- [x] superseded by the v6 line below

| # | item | initial | action |
|---|---|---|---|
| 12 | frontend lifecycle | FAIL (no claim_payout UI; homepage "example" seal was hardcoded) | [x] ClaimBar added; homepage shows newest revealed drop from chain · [x] headless walk of the live app (tools/ui_walk.mjs, docs/ui-walk/): every step pending→ok/refused; found + fixed a wait bug (exact-ACCEPTED match missed FINALIZED) |
| 13 | docs match code | FAIL (old tolerance/tickets/root wording) | [x] README, ARTICLE, X_POST, docs page aligned to v6, seed section from chain evidence |
| 14 | demo isolation | PASS | [x] TestEdges.test_14_* ; UI banner driven by live get_config |
| 15 | proof availability | FAIL (root only) | [x] publish_flagged: list on chain, root computed by contract; get_flagged / flagged_proof; file with no proof; app builds proof from list; TestFlagged |
| 16 | reserve lock | PASS | [x] TestEdges.test_16_* (no cancel/withdraw method; close refused until every window closes) |
| 17 | limits and edges | FAIL (rules size not declared up front) | [x] rules_bytes/rules_count at create; boundary tests appeal/reveal/contest/read ±1 s |
| 18 | bond economics | FAIL (per-drop appeal cap could be filled) | [x] per-wallet cap (3); README "Bond economics" |
- [x] v6 deployed + verified (0xecEe…1A58 / 0x4F34…c6dD / 0xA700…FBB4); Vercel env + prod on v6
- [x] v6 reseed (A–D + E, F), drain (demo 0/0/0; canonical payable claimed, 1.05 GEN locked under its open 48 h window), registry demo, UI walk, audit 51/51, README fill
- [ ] 7-point check, push
