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
   `sha256(canonical_rules_json + salt)`, together with the document's exact
   byte size and rule count (at most 4000 bytes and 12 rules, so the reveal
   always fits in one transaction). The contract refuses a snapshot time that
   isn't in the future, so the seal is provably older than the snapshot.
2. **Publish the flagged list.** After the snapshot, the operator publishes
   the whole flagged list on chain (ascending, in chunks). The contract
   computes the merkle root itself: `leaf = sha256(0x00‖address)`,
   `node = sha256(0x01‖min‖max)`. An operator that never publishes has no
   exclusion on chain: the drop is void and its reserve goes back.
3. **Appeal from the wallet.** A flagged wallet appeals *from itself*
   (sender == wallet) with a bond. It can build its own proof from the
   published list (the app does this), ask the contract for one
   (`flagged_proof`), or send none: the contract then checks the published
   list itself. No appeal depends on the operator handing out proofs.
4. **Reveal.** When the appeal window closes, the operator reveals the rules.
   The reveal is accepted only if it hashes to the seal exactly. If no reveal
   arrives before the deadline, every pending appeal wins by default.
5. **Blind read, ruled in code.** Every validator fetches the wallet's
   outbound history from Blockscout itself. Only transactions between the
   lookback start and the snapshot count. First activity and first funding
   also count only if they happened at or before the snapshot, so nothing the
   wallet does later changes its reading. Code computes four deterministic
   findings from that history. A model reads the history and describes the
   behaviour in four one-word findings. Its prompt is built from the history
   text alone. Each validator then applies the revealed rules **in code** to
   its **own** findings. For the round to settle:
   - the history hash, the deterministic findings and the **rule outcome** must be identical;
   - model findings may differ by at most one bucket.

   If a one-bucket difference would change the outcome, the round does not
   settle. A single leader can't move a borderline wallet across a threshold.
6. **Rounds that never settle.** A read round that doesn't settle commits
   nothing. A failed read counts only when the failure itself reaches
   consensus. In a `settle_stalled` round, validators accept only if they
   read the wallet, agreed on the evidence, and computed a **different**
   outcome from the leader's. On a wallet they agree on, nothing can be
   recorded, however often anyone calls it. Split rounds open only after
   `read_wallet` has had a priority window (1 h canonical, 10 min demo).
   After three genuine splits the appeal is **UNRESOLVED**: the bond comes
   back, and the wallet may refile until one contest window after the reveal
   deadline, with a full read window for the refile. UNRESOLVED never pays and
   never condemns.
7. **Contest.** An outcome is provisional for 48 hours (10 minutes on the
   demo instance). The losing side may
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
| `FIRST_FUNDER_IS_EXCHANGE_OR_BRIDGE` | model: NO / YES / UNCLEAR, from the first funding transaction at or before the snapshot and its public label. If that funding can't be proven (not on the first page of the wallet's history, or two senders in the same second), code sets UNCLEAR, and a drop whose rules use this finding reads INSUFFICIENT_HISTORY |
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
| **INSUFFICIENT_HISTORY** | the history can't be proven complete back to the lookback start, a mined item is unreadable, or the rules use a first funding that can't be proven | bond returned; refile allowed; never condemns |
| **UNRESOLVED** | validators genuinely split on the outcome in three committed rounds | bond returned; refile allowed; never pays, never condemns |

### Money

The operator escrows the appeal reserve (at least 1 GEN) at creation. It stays
locked until the reveal deadline has passed and every appeal is final. If the
winners exceed the reserve, every winner gets the same pro-rata share; payouts
are never first-come. The leftover returns to the operator. Methods that read
the clock only record balances. `claim_payout` is the only method that
transfers, and it reads no clock. On the books, every GEN drains to zero.

### Bond economics

- **Size.** The appeal bond is set by the operator at creation (at least
  0.001 GEN) and frozen. It only needs to make a free lottery ticket cost
  something. It is not what protects the reserve; the reads and the rules
  do. The demo uses 0.05–0.1 GEN. The contest bond is fixed at 5% of the
  allocation, so contesting costs the same share whoever you are.
- **What returns the bond.** HUMAN_PATTERN, INSUFFICIENT_HISTORY and
  UNRESOLVED return it. SYBIL_PATTERN sends it to the drop's pool, which goes
  back to the operator at close.
- **Why spam can't pay a sybil.** Only a HUMAN_PATTERN appeal is paid. That
  outcome needs every validator to compute HUMAN from its own reading of the
  wallet's snapshot-bound history (or an operator who never revealed). A
  wallet that reads SYBIL loses its bond every time it files. Refiling is
  only open after INSUFFICIENT_HISTORY or UNRESOLVED, which pay nothing. Each
  wallet may file at most 3 times per drop, and only wallets on the published
  flagged list can file at all.
- **Why spam can't crowd honest appeals out.** There is no per-drop appeal
  cap to fill: the limit is per wallet. Payouts are pro-rata over the winners,
  never first-come, so an early flood of appeals changes no honest winner's
  share unless those appeals genuinely win.

### Integration

`FairDropRegistry.is_cleared(wallet, drop_id) → bool` is true only for a final
HUMAN_PATTERN appeal. `get_appeal(wallet, drop_id)` returns the record. The
registry holds no funds and has zero payable methods. Any distributor can call
it before paying.

## Deployed (Studio Dev)

<!-- addresses:start -->
| contract | role | address |
|---|---|---|
| FairDrop | canonical — sender must be the flagged wallet; 48 h contest window | [`0xecEeb9E569720BdEd3750A4e41C574642EEF1A58`](https://explorer-studio-dev.genlayer.com/address/0xecEeb9E569720BdEd3750A4e41C574642EEF1A58) |
| FairDropDemo | demo — same source, operator may file for a public wallet; minutes-long windows | [`0x4F34B9Dd883C58C25Fb79d6d25a8936421DCc6dD`](https://explorer-studio-dev.genlayer.com/address/0x4F34B9Dd883C58C25Fb79d6d25a8936421DCc6dD) |
| FairDropRegistry | is_cleared(wallet, drop) for distributors; reads the demo; holds no funds | [`0xA700843BD323D75E70d98070533fd57B57e3FBB4`](https://explorer-studio-dev.genlayer.com/address/0xA700843BD323D75E70d98070533fd57B57e3FBB4) |

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
| FairDrop | `0xe206255a3639aFC60c77F0D8dCA42C2dac80f889` | v4 binding audit: read tickets could be opened and left to expire (an operator could force an honest appeal to UNRESOLVED), first funding could be post-snapshot or unproven, merkle had no leaf/node domain prefixes, the refile window could close before UNRESOLVED, unreadable outbound timestamps were dropped |
| FairDropDemo | `0x9779afa39051286B9a1280f78d4d8EB32e491849` | v4 binding audit: read tickets could be opened and left to expire (an operator could force an honest appeal to UNRESOLVED), first funding could be post-snapshot or unproven, merkle had no leaf/node domain prefixes, the refile window could close before UNRESOLVED, unreadable outbound timestamps were dropped |
| FairDropRegistry | `0x8E3E1c02C67FE445345D7A0Eee27019cb2D6405c` | v4 binding audit: read tickets could be opened and left to expire (an operator could force an honest appeal to UNRESOLVED), first funding could be post-snapshot or unproven, merkle had no leaf/node domain prefixes, the refile window could close before UNRESOLVED, unreadable outbound timestamps were dropped |
| FairDrop | `0x13CC3573054bC574139A7ba0A37Abcd91f81b84e` | v5 committed only the flagged-list ROOT (appeals depended on the operator handing out proofs), had a per-drop appeal cap a flagged-wallet owner could fill, and did not declare the rules document's size up front |
| FairDropDemo | `0x5F714d149CfCEd6b6Eace01F41c0862D723F49Dd` | v5 committed only the flagged-list ROOT (appeals depended on the operator handing out proofs), had a per-drop appeal cap a flagged-wallet owner could fill, and did not declare the rules document's size up front |
| FairDropRegistry | `0xfCc446d41dD178F83534c243C1A1896a02A4a459` | v5 committed only the flagged-list ROOT (appeals depended on the operator handing out proofs), had a per-drop appeal cap a flagged-wallet owner could fill, and did not declare the rules document's size up front |

</details>
<!-- addresses:end -->

## Seeded on chain (demo instance)

Every row below comes from a chain read (`docs/seed-evidence.json`); the
transactions are in [`docs/seed-run.log`](docs/seed-run.log). On chain, v6
shows:

- a HUMAN win paid by the rules (A #1), and a SYBIL loss (A #4);
- two mismatched reveals refused and counted on the drop (A);
- a read attempted before the reveal, refused (B);
- automatic wins when the operator never revealed (B, F);
- a pro-rata payout: two winners owed 0.6 GEN each from a 1 GEN reserve,
  paid 0.5 GEN each (F);
- contests where the outcome held (E #13, and the UI walk's #17), a contest
  text framing the case refused, and a copied contest text refused;
- INSUFFICIENT_HISTORY for a truncated history, refiled after the reveal
  deadline inside the extended window and INSUFFICIENT again, never SYBIL
  (E #15 → #16);
- griefing: a stranger and the operator called `settle_stalled` on an appeal
  the validators agreed on. Both rounds were UNDETERMINED and recorded 0
  splits (D);
- every drop run while the contract was paused, with only `create_drop`
  refused.

What it could not show: a genuine validator split. The borderline wallet's
three split rounds all ended UNDETERMINED because the validators agreed, so
there is no UNRESOLVED on chain. That path is proven offline (`TestUnresolved`,
and 96 UNRESOLVED outcomes in the randomized lifecycles). Blockscout's Base API
answered HTTP 500 on most requests from about 18:10 to 21:10 UTC during the
seed. Six appeals could not be read before their deadlines and expired as
INSUFFICIENT_HISTORY (`UNREAD_AT_DEADLINE`): bond returned, nobody condemned.

<!-- outcomes:start -->
| drop | appeal | wallet | outcome | decided by | payout (GEN) | note |
|---|---|---|---|---|---|---|
| UI walk #10 | #17 | `0x07239437…` | HUMAN_PATTERN | CONTEST | 0.5 | contested: HUMAN_PATTERN → HUMAN_PATTERN |
| UI walk #6 | — | — | CLOSED (no appeals; reserve returned) | — | 0 | an abandoned walk attempt |
| UI walk #7 | — | — | CLOSED (no appeals; reserve returned) | — | 0 | an abandoned walk attempt |
| UI walk #8 | — | — | CLOSED (no appeals; reserve returned) | — | 0 | an abandoned walk attempt |
| UI walk #9 | — | — | CLOSED (no appeals; reserve returned) | — | 0 | an abandoned walk attempt |
| A #1 | #1 | `0x0F258954…` | HUMAN_PATTERN | RULES | 1 |  |
| A #1 | #4 | `0x8410115B…` | SYBIL_PATTERN | RULES | 0 |  |
| A #1 | #8 | `0xD5512d13…` | INSUFFICIENT_HISTORY | COVERAGE | 0 |  |
| A #1 | #10 | `0x1c1fF5A7…` | INSUFFICIENT_HISTORY | UNREAD_AT_DEADLINE | 0 |  |
| B #2 | #3 | `0x8CD35fc0…` | HUMAN_PATTERN | NO_REVEAL | 0.4 |  |
| B #2 | #7 | `0x35B4A50f…` | HUMAN_PATTERN | NO_REVEAL | 0.4 |  |
| C #3 | #5 | `0x0F258954…` | INSUFFICIENT_HISTORY | UNREAD_AT_DEADLINE | 0 |  |
| C #3 | #9 | `0x1c1fF5A7…` | HUMAN_PATTERN | RULES | 0.6 |  |
| C #3 | #11 | `0x35B4A50f…` | INSUFFICIENT_HISTORY | UNREAD_AT_DEADLINE | 0 |  |
| D #4 | #2 | `0x35B4A50f…` | INSUFFICIENT_HISTORY | UNREAD_AT_DEADLINE | 0 |  |
| D #4 | #6 | `0x1c1fF5A7…` | INSUFFICIENT_HISTORY | UNREAD_AT_DEADLINE | 0 |  |
| E #5 | #12 | `0x0F258954…` | HUMAN_PATTERN | RULES | 0.4 |  |
| E #5 | #13 | `0x1c1fF5A7…` | HUMAN_PATTERN | CONTEST | 0.4 | contested: HUMAN_PATTERN → HUMAN_PATTERN |
| E #5 | #14 | `0x35B4A50f…` | INSUFFICIENT_HISTORY | UNREAD_AT_DEADLINE | 0 |  |
| E #5 | #15 | `0xD5512d13…` | INSUFFICIENT_HISTORY | COVERAGE | 0 |  |
| E #5 | #16 | `0xD5512d13…` | INSUFFICIENT_HISTORY | COVERAGE | 0 | refile of #15 |
| F #11 | #18 | `0x0F258954…` | HUMAN_PATTERN | NO_REVEAL | 0.5 |  |
| F #11 | #19 | `0x1c1fF5A7…` | HUMAN_PATTERN | NO_REVEAL | 0.5 |  |

Contract `0x4F34B9Dd883C58C25Fb79d6d25a8936421DCc6dD` after every drop closed and every account claimed: balance 0 wei, locked 0, payable 0.
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
  items, newest first. A wallet with more than 50 outbound transactions
  between the lookback start and *now* (later activity also fills the page)
  can't be proven complete in two requests, and reads as
  INSUFFICIENT_HISTORY, never as a verdict. Labels can be missing. Internal transactions aren't
  read: Base's internal endpoint answers "not yet processed" with an empty
  list. Wallet age is therefore measured from the first visible normal
  transaction. The legacy `/api` allows 10 requests per 6 minutes per IP, so
  it isn't used. The API also fails for hours at a time: on 2026-09-28 it
  answered HTTP 500 to most requests for about three hours. Every validator
  fetches independently, so one failure makes the read UNAVAILABLE. That
  decides nothing, but an appeal still unread at its deadline expires as
  INSUFFICIENT_HISTORY, with the bond returned.
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
- **UNRESOLVED needs a genuine split, and a dishonest leader can help one.**
  A split round settles only if the validators' own outcomes differ from the
  leader's. That can only happen on a wallet sitting one bucket from a
  threshold. There, a dishonest leader could shade across it and honest
  validators would record a split, three times over. The result is
  UNRESOLVED: no payout, bond back, refile allowed. No money moves on the
  leader's say-so. A wallet the validators agree on can never be made
  UNRESOLVED.
- **Explorer labels are read live, not as of the snapshot.** Transactions,
  timestamps, first activity and first funding are all bound to the
  snapshot. The *labels* Blockscout attaches (contract names, exchange tags,
  `is_contract`) are today's, and could have changed since. Validators agree
  on them (they are in the hashed record), and they only reach the model as
  descriptive text, never a rule.
- **The app's reads can be up to 8 seconds old.** The app reaches Studio
  through its own relay (`/api/rpc`), which caches identical *view* calls for
  8 seconds to survive Studio's rate limit. Writes and transaction lookups are
  never cached. Every page reads the contract; none shows hardcoded or sample
  data.
- **Studio Dev delivery quirk.** Studio Dev queues value transfers and may not
  execute them; `get_stats` reports the gap as `undelivered_wei`. The books
  drain to zero regardless. An UNDETERMINED round commits nothing, not even a
  counter. That is why a failed read is recorded by a separate consensus
  round (`settle_stalled`) that can only settle on a real split. The public
  RPC allows 500 views and sends per hour per IP, shared by every script on
  one machine. The v4 seed hit that limit mid-run and resumed from saved
  state when the window reset.
- **Two commitments, not one.** The brief places the flagged-list root at drop
  creation. The list can't exist before the snapshot it's computed from, so
  it's published after the snapshot. The rules seal still predates the
  snapshot.
- **A published flagged list is public.** Anyone can read which wallets were
  flagged. That is the price of appeals that don't depend on the operator.
  The list holds at most 5000 wallets per drop.
