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
- [~] Source byte-for-byte vs repo (verify_onchain: identical ×3); GitHub after push
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
- [ ] Vercel on v4; live bundle has v4 addresses and no old ones
- [ ] Pushed to GitHub, no co-author trailers

## 7. Final 7-point check
- [ ] 1 outcome/deterministic exact; one-bucket difference can't flip outcome
- [ ] 2 truncated history never SYBIL (test + on-chain)
- [ ] 3 prompt never contains rules/thresholds/flag reason
- [ ] 4 mismatched reveal refused; no reveal → auto-win (on chain)
- [ ] 5 books drain to 0 (canonical excluded: window open)
- [ ] 6 source byte-identical; README == deployments.json
- [ ] 7 no assistant name or co-author trailer in history, blobs, messages (tools/final_check.py)
