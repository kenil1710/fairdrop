<p align="center"><img src="docs/brand/fairdrop-logo.png" width="96" alt="FairDrop"/></p>

# FairDrop

**Airdrop sybil appeals with hidden rules that are provably locked in advance.**

Live app: **https://fairdrop-six.vercel.app** · GenLayer Studio Dev (chain 61997)

## The trust problem

Every large airdrop flags real users as sybils. Projects keep their sybil rules
secret so farmers can't game them, which is reasonable. The cost is that nobody
can prove the rules weren't changed after the snapshot to exclude people. The
appeal is a form read by a team member, with no reason given and no evidence
shown.

FairDrop keeps the rules secret and still makes them accountable. They are
sealed before the snapshot. They are applied by code, never by a person or a
model. Every step can be checked from chain storage.

## The mechanism

> **The model never sees the rules. It describes the wallet's behaviour; contract code applies the rules that were committed before the snapshot.**

1. **Seal.** Before the snapshot, the operator commits
   `sha256(canonical_rules_json + salt)`. The contract refuses a snapshot time
   that isn't in the future, so the seal is provably older than the snapshot.
   After the snapshot, the operator commits the merkle root of the flagged list.
2. **Appeal from the wallet.** A flagged wallet appeals *from itself*
   (sender == wallet), with a merkle proof and a bond. No identity binding is
   needed.
3. **Reveal.** When the appeal window closes, the operator reveals the rules.
   The reveal is accepted only if it hashes to the seal exactly. If no reveal
   arrives before the deadline, every pending appeal wins by default.
4. **Blind read, ruled in code.** Every validator fetches the wallet's
   outbound history from Blockscout itself. Code computes four deterministic
   findings from that history. A model reads the history and describes the
   behaviour in four one-word findings. Its prompt is built from the history
   text alone. Each validator then applies the revealed rules **in code** to
   its **own** findings. For the round to settle:
   - the history hash, the deterministic findings and the **rule outcome** must be identical;
   - model findings may differ by at most one bucket.

   If a one-bucket difference would change the outcome, the round does not
   settle. A single leader can't move a borderline wallet across a threshold.
5. **Rounds that never settle.** Each read attempt first opens a committed
   ticket, so a failed round is still counted. After three unsettled rounds,
   the appeal is **UNRESOLVED**: the bond comes back and the wallet may refile.
   UNRESOLVED never pays and never condemns.
6. **Contest.** An outcome is provisional for 48 hours. The losing side may
   contest once, with a bond of 5% of the allocation and **new** evidence. A
   novelty gate refuses repeated text, and a screen refuses text that names
   rules or frames the case. The contest re-reads the same stored snapshot,
   under the same outcome-identity rule.

Rules are structured, not free text. Each rule is
`{finding, condition, threshold}` over a fixed vocabulary:

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

A wallet is `SYBIL_PATTERN` only if at least `min_hits` rules fire. A rule on
an `UNCLEAR` model finding never fires.

### Outcomes

| outcome | when | money |
|---|---|---|
| **HUMAN_PATTERN** | the committed rules don't condemn the agreed findings, or the operator never revealed | allocation paid at close; bond returned |
| **SYBIL_PATTERN** | the committed rules fire on the agreed findings of a *complete* history | bond goes to the drop's pool |
| **INSUFFICIENT_HISTORY** | the history can't be proven complete back to the lookback start | bond returned; refile allowed; never condemns |
| **UNRESOLVED** | three read rounds never settled | bond returned; refile allowed; never pays, never condemns |

### Money

The operator escrows the appeal reserve (at least 1 GEN) at creation. It stays
locked until the reveal deadline has passed and every appeal is final. If the
winners exceed the reserve, every winner gets the same pro-rata share; payouts
are never first-come. The leftover returns to the operator. Methods that read
the clock only record balances. `claim_payout` is the only method that
transfers, and it reads no clock. On the books, every GEN drains to zero.

### Integration

`FairDropRegistry.is_cleared(wallet, drop_id) → bool` is true only for a final
HUMAN_PATTERN appeal. `get_appeal(wallet, drop_id)` returns the record. The
registry holds no funds and has zero payable methods. Any distributor can call
it before paying.

## Deployed (Studio Dev)

<!-- addresses:start -->
| contract | role | address |
|---|---|---|
| FairDrop | canonical — sender must be the flagged wallet; 48 h contest window | [`0xe206255a3639aFC60c77F0D8dCA42C2dac80f889`](https://explorer-studio-dev.genlayer.com/address/0xe206255a3639aFC60c77F0D8dCA42C2dac80f889) |
| FairDropDemo | demo — same source, operator may file for a public wallet; minutes-long windows | [`0x9779afa39051286B9a1280f78d4d8EB32e491849`](https://explorer-studio-dev.genlayer.com/address/0x9779afa39051286B9a1280f78d4d8EB32e491849) |
| FairDropRegistry | is_cleared(wallet, drop) for distributors; reads the demo; holds no funds | [`0x8E3E1c02C67FE445345D7A0Eee27019cb2D6405c`](https://explorer-studio-dev.genlayer.com/address/0x8E3E1c02C67FE445345D7A0Eee27019cb2D6405c) |

<details><summary>Superseded deployments (not used by the app)</summary>

| contract | address | why it was replaced |
|---|---|---|
| FairDropDemo | `0xb9589f3e0a10dD62D0034932D81216dA659765ea` | read used the legacy /api (10 req / 6 min per IP); the first on-chain read was HTTP 429 on every attempt |
| FairDrop | `0xa152a563017803F64259A71007E1f257966DE422` | exact model-bucket comparison left a borderline wallet UNDETERMINED on every round (docs/superseded/seed-run-v1-exact-buckets.log); replaced by one-step-toward-human tolerance |
| FairDropDemo | `0x7faea99DeC1974411BF615b7d360D5476270d9f5` | exact model-bucket comparison left a borderline wallet UNDETERMINED on every round (docs/superseded/seed-run-v1-exact-buckets.log); replaced by one-step-toward-human tolerance |
| FairDropRegistry | `0x10A3c9Da0BB8e7616a039f93c91A8E111588455B` | exact model-bucket comparison left a borderline wallet UNDETERMINED on every round (docs/superseded/seed-run-v1-exact-buckets.log); replaced by one-step-toward-human tolerance |
| FairDrop | `0xBa426A78B0F953E5c13931553dCA95E90Bd302AE` | an operator contest text carried the word "flagged" into an on-chain prompt (docs/superseded/v2/prompt-check.json); the contest-text screen now refuses case-framing words |
| FairDropDemo | `0x532D02383eb1Ac2Fa10F00288F75D14F7d39641a` | an operator contest text carried the word "flagged" into an on-chain prompt (docs/superseded/v2/prompt-check.json); the contest-text screen now refuses case-framing words |
| FairDropRegistry | `0x0CF59Bf0460A0eB6e5D0e12cf5e17D70e02eA0F9` | an operator contest text carried the word "flagged" into an on-chain prompt (docs/superseded/v2/prompt-check.json); the contest-text screen now refuses case-framing words |
| FairDrop | `0xeADc6ccb80761E9b98d9947A3Bb31dd125C09095` | v3 let the leader shade a model finding one step toward HUMAN with no outcome check, so a borderline sybil could be moved across a rule threshold and paid from the reserve; v4 compares the rule outcome exactly and makes 3 unsettled rounds UNRESOLVED |
| FairDropDemo | `0x2b1e1D88000c4b409866B2fAB2D4339404B2CCe3` | v3 let the leader shade a model finding one step toward HUMAN with no outcome check, so a borderline sybil could be moved across a rule threshold and paid from the reserve; v4 compares the rule outcome exactly and makes 3 unsettled rounds UNRESOLVED |
| FairDropRegistry | `0xC55C7be2732f503516348e8De15011033fFad36b` | v3 let the leader shade a model finding one step toward HUMAN with no outcome check, so a borderline sybil could be moved across a rule threshold and paid from the reserve; v4 compares the rule outcome exactly and makes 3 unsettled rounds UNRESOLVED |

</details>
<!-- addresses:end -->

## Seeded on chain (demo instance)

Every row below comes from a chain read (`docs/seed-evidence.json`); the
transactions are in [`docs/seed-run.log`](docs/seed-run.log). The demo covers:

- a HUMAN win that was paid;
- a SYBIL loss;
- an INSUFFICIENT_HISTORY appeal that was refiled;
- an UNRESOLVED appeal after three unsettled rounds, which was then refiled;
- two mismatched reveals, both refused;
- an automatic win when the operator never revealed;
- a contest where the outcome held;
- a pro-rata payout when the reserve ran short;
- `settle_stalled`, with every drop run while the contract was paused.

<!-- outcomes:start -->
| drop | appeal | wallet | outcome | decided by | payout (GEN) | note |
|---|---|---|---|---|---|---|
| A #1 | #1 | `0x0F258954…` | HUMAN_PATTERN | RULES | 1 |  |
| A #1 | #5 | `0x8410115B…` | SYBIL_PATTERN | RULES | 0 |  |
| A #1 | #10 | `0xD5512d13…` | INSUFFICIENT_HISTORY | COVERAGE | 0 |  |
| A #1 | #11 | `0x1c1fF5A7…` | HUMAN_PATTERN | CONTEST | 1 | contested: HUMAN_PATTERN → HUMAN_PATTERN |
| A #1 | #12 | `0xD5512d13…` | INSUFFICIENT_HISTORY | COVERAGE | 0 | refile of #10 |
| B #2 | #3 | `0x8CD35fc0…` | HUMAN_PATTERN | NO_REVEAL | 0.4 |  |
| B #2 | #7 | `0x35B4A50f…` | HUMAN_PATTERN | NO_REVEAL | 0.4 |  |
| C #3 | #2 | `0x0F258954…` | HUMAN_PATTERN | RULES | 0.333333 |  |
| C #3 | #6 | `0x1c1fF5A7…` | HUMAN_PATTERN | RULES | 0.333333 |  |
| C #3 | #8 | `0x35B4A50f…` | HUMAN_PATTERN | RULES | 0.333333 |  |
| D #4 | #4 | `0x1c1fF5A7…` | SYBIL_PATTERN | RULES | 0 |  |
| D #4 | #9 | `0xE288dDAd…` | UNRESOLVED | ROUNDS_NEVER_SETTLED | 0 | 3 unsettled round(s) |
| D #4 | #13 | `0xE288dDAd…` | SYBIL_PATTERN | RULES | 0 | refile of #9 |

Contract `0x9779afa39051286B9a1280f78d4d8EB32e491849` after every drop closed and every account claimed: balance 0 wei, locked 0, payable 0.
<!-- outcomes:end -->

## Verify it yourself

```bash
python3 test/test_fairdrop.py          # offline suite, stdlib only
python3 tools/audit.py --chain         # every safety pattern and loophole, PASS/FAIL → docs/AUDIT.md
node tools/verify_onchain.mjs          # deployed source == this repo, byte for byte
node tools/prompt_check.mjs            # every live prompt read back from chain: no rules, thresholds or flag
python3 tools/readme_fill.py --check   # this README == deployments.json + seed evidence
```

Design notes: [`contracts/NOTES.md`](contracts/NOTES.md) · probe:
[`docs/PROBE.md`](docs/PROBE.md) · audit: [`docs/AUDIT.md`](docs/AUDIT.md)

## Honest limitations

- **Reading behaviour is a bounded judgement.** The vocabulary limits the
  model to four one-word answers. Validators must agree to within one bucket
  on each, and exactly on the outcome. Code applies the rules. A model can
  still describe a real person as scripted, and every validator might agree.
  The contest exists for that case, and it is bounded too.
- **Blockscout completeness.** Blockscout is the only source. A page holds 50
  items, so a wallet with more than 50 outbound transactions since the
  lookback start can't be proven complete in two requests and reads as
  INSUFFICIENT_HISTORY. Labels can be missing. Internal transactions aren't
  read: Base's internal endpoint answers "not yet processed" with an empty
  list. Wallet age is therefore measured from the first visible normal
  transaction. The legacy `/api` allows 10 requests per 6 minutes per IP, so
  it isn't used.
- **The demo instance.** None of the ~199 keys we control has history on any
  Blockscout chain. The canonical instance (sender must be the wallet) can
  therefore only read our own keys' empty histories. A second instance of the
  same source runs with `demo_mode=True`: a drop's operator may file on behalf
  of a named *public* wallet, and windows last minutes. It says **DEMO** in
  `get_config`, in the app banner and here. Demo outcomes describe on-chain
  behaviour under demo rules. They aren't claims about the people behind those
  wallets.
- **The canonical contest window is still open.** The canonical appeal was
  decided on chain, but its 48-hour contest window hasn't closed. Its drop
  can't close yet, so its books aren't at zero. That is the contract working
  as designed.
- **UNRESOLVED can be forced by neglect.** Anyone may open a read ticket, and
  a ticket nobody runs expires and counts as unsettled. A party that wants an
  appeal UNRESOLVED could open tickets and wait. Anyone can defeat that by
  running the round within the ticket's life (10 min on the demo, 1 h
  canonical). UNRESOLVED can neither pay nor condemn, so the worst case sends
  the wallet back to refile.
- **Studio Dev delivery quirk.** Studio Dev queues value transfers and may not
  execute them; `get_stats` reports the gap as `undelivered_wei`. The books
  drain to zero regardless. An UNDETERMINED round commits nothing, not even a
  counter. That is why read attempts are tickets. The public RPC allows 500
  views and sends per hour per IP, shared across every script on one machine.
  The v4 seed hit that limit mid-run and resumed from saved state when the
  window reset.
- **Two commitments, not one.** The brief places the flagged-list root at drop
  creation. The list can't exist before the snapshot it's computed from, so
  it's committed after the snapshot. The rules seal still predates the
  snapshot.
