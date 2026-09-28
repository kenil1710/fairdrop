<p align="center"><img src="docs/brand/fairdrop-logo.png" width="96" alt="FairDrop"/></p>

# FairDrop

**Airdrop sybil appeals with hidden rules that are provably locked in advance.**

Live app: **https://fairdrop-six.vercel.app** · GenLayer Studio Dev (chain 61997)

## The trust problem

Every large airdrop flags real users as sybils. Projects keep their sybil rules
secret so farmers cannot game them — reasonable — but then nobody can prove the
rules were not changed after the snapshot to exclude people. And the appeal is
a form, decided by a team member, with no reason given and no evidence shown.

## The mechanism

1. **Sealed rules.** Before the snapshot, the operator commits
   `sha256(canonical_rules_json + salt)`. The contract refuses a snapshot time
   that is not in the future, so the seal is provably older than the snapshot.
   After the snapshot the operator commits the merkle root of the flagged list.
2. **Appeal from the wallet.** A flagged wallet appeals *from itself*
   (sender == wallet) with a merkle proof and a bond. No identity binding needed.
3. **Blind read.** Every validator fetches the wallet's outbound history from
   Blockscout. Contract code computes the deterministic findings; a model
   describes the behaviour in a fixed vocabulary of bucketed findings. The
   validators must agree exactly on the history hash and every number; on
   each model bucket they must match the leader or sit exactly one step on the
   sybil side of it — so a leader can shade a borderline reading toward the
   appellant by one step, and never against them.
4. **Reveal and apply.** The reveal is accepted only if it hashes to the seal.
   Contract code applies the revealed rules to the stored findings, line by
   line. If the operator never reveals, every pending appeal wins.

> **The model never sees the rules. It describes the wallet's behaviour; contract code applies the rules that were committed before the snapshot.**

Rules are structured, not free text: `{finding, condition, threshold}` over a
fixed vocabulary —

| finding | how it is produced |
|---|---|
| `WALLET_AGE_DAYS` | code: days from first visible transaction to the snapshot |
| `OUTBOUND_TX_COUNT` | code: transactions sent inside the lookback window |
| `DISTINCT_CONTRACTS_TOUCHED` | code: distinct contracts called in the window |
| `ACTIVE_DAYS` | code: distinct UTC days with an outbound transaction |
| `FIRST_FUNDER_IS_EXCHANGE_OR_BRIDGE` | model: NO / YES / UNCLEAR, from the funding transaction and its public label |
| `SCRIPTED_REPETITION` | model: NONE / SOME / STRONG / UNCLEAR |
| `SINGLE_PURPOSE_FARMING` | model: NONE / SOME / STRONG / UNCLEAR |
| `ORGANIC_DIVERSITY` | model: LOW / MEDIUM / HIGH / UNCLEAR |

A wallet is `SYBIL_PATTERN` only if at least `min_hits` rules fire. A rule on an
`UNCLEAR` model finding never fires.

### Outcomes

- **HUMAN_PATTERN** — appeal wins: allocation paid from the reserve, bond returned.
- **SYBIL_PATTERN** — appeal loses: bond goes to the reserve.
- **INSUFFICIENT_HISTORY** — the history could not be proven complete back to
  the lookback start: bond returned, refile allowed. It never condemns.

Outcomes are provisional for 48 hours. The losing side may contest once, with a
bond of 5% of the allocation and **new** evidence (a novelty gate refuses
repeated text). The contest re-reads the same stored snapshot, never a fresh
fetch.

### Money

The operator escrows the appeal reserve (≥ 1 GEN) at creation. It is locked
until the reveal deadline and every contest window have closed. If winners
exceed the reserve, every winner gets the same pro-rata share — never
first-come. The leftover returns to the operator. Every method that reads the
clock only books; `claim_payout` is the only transfer and reads no clock. Every
GEN drains to zero on the books.

### Integration

`FairDropRegistry.is_cleared(wallet, drop_id) → bool` — true only for a final
HUMAN_PATTERN appeal. `get_appeal(wallet, drop_id)` returns the record. No
custody, zero payable methods. Any distributor can call it before paying.

## Deployed (Studio Dev)

<!-- ADDRESSES -->

## Seeded on chain

<!-- SEED TABLE -->

## Verify it yourself

```bash
python3 test/test_fairdrop.py          # offline suite, stdlib only
python3 tools/audit.py --chain         # every safety pattern and loophole, PASS/FAIL → docs/AUDIT.md
node tools/verify_onchain.mjs          # deployed source == this repo, byte for byte
python3 tools/probe.py                 # re-measure the Blockscout assumptions → docs/probe/
```

Design notes: [`contracts/NOTES.md`](contracts/NOTES.md) · probe:
[`docs/PROBE.md`](docs/PROBE.md) · audit: [`docs/AUDIT.md`](docs/AUDIT.md) ·
seed log: [`docs/seed-run.log`](docs/seed-run.log)

## Honest limitations

- **Behaviour reading is a judgement.** The fixed vocabulary bounds it to four
  one-word answers, validators must agree on each, and the rules are applied by
  code — but a model can still describe a real person as scripted. The contest
  exists for that, and it is bounded too.
- **Blockscout completeness.** Blockscout is the only source. Pages are 50
  items; a wallet with more than 50 outbound transactions since the lookback
  start cannot be proven complete in two requests and reads as
  INSUFFICIENT_HISTORY. Labels can be missing. Internal transactions are not
  read (Base's internal endpoint answers "not yet processed" with an empty
  list), so wallet age is measured from the first visible normal transaction.
  The legacy `/api` is rate-limited to 10 requests per 6 minutes per IP and is
  not used.
- **The DEMO instance.** None of the ~199 keys we control has history on any
  Blockscout chain, so the canonical instance (sender must be the wallet) can
  only read empty histories of our own keys. A second instance of the same
  source runs with `demo_mode=True`: a drop's operator may file on behalf of a
  named *public* wallet, and windows are minutes. It says **DEMO** in
  `get_config`, in the app banner and here. Demo outcomes describe on-chain
  behaviour under demo rules; they are not claims about the people behind
  those wallets.
- **Studio Dev delivery quirks.** Studio Dev queues value transfers and may not
  execute them; `get_stats` reports the gap as `undelivered_wei`. The books
  drain to zero regardless. A consensus round that never settles rolls back
  entirely, so a genuinely stalled marker cannot be staged on chain;
  `settle_stalled` is proved offline and called on chain while paused.
- **Two commitments, not one.** The brief places the flagged-list root at drop
  creation; the list cannot exist before the snapshot it is computed from, so
  it is committed after the snapshot (the rules seal still predates it).
