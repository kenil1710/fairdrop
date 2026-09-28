# The rules were secret. Now they're sealed.

*How FairDrop lets a flagged airdrop wallet appeal to validators who read it blind — and why the operator can't move the goalposts after the snapshot.*

---

## The email nobody answers

You used a protocol for a year. You bridged in from an exchange, swapped, lent, voted once, forgot about it for three months, came back. Then the airdrop lands and your wallet isn't on it. There's a line in the announcement: *"Wallets exhibiting sybil behaviour have been excluded. Appeals: [Google Form]."*

You fill in the form. Nobody replies, or somebody replies "the decision is final." You never learn which rule you tripped, because the rules are secret — and the secrecy is not unreasonable. The moment a project publishes "wallets younger than 60 days are excluded", every farm on earth ages its wallets to 61 days.

So airdrops are stuck between two bad options. Publish the rules and get farmed, or hide them and ask users to trust that the rules used after the snapshot are the same ones that existed before it. Nobody can check. Nobody can prove a wallet wasn't excluded by a rule written specifically to exclude it.

FairDrop is an attempt to get out of that corner.

## Sealed, not secret

The operator still keeps the rules hidden. But before the snapshot, they publish a **seal**: `sha256(rules + salt)`. The contract refuses to accept a snapshot time that is not in the future, so the seal is provably older than the snapshot. The salt is 32 random bytes, so nobody can brute-force a small rule space from the hash.

The rules themselves aren't prose. They're structured: `{finding, condition, threshold}`, over a fixed vocabulary of eight findings — four computed by code (wallet age, outbound transaction count, distinct contracts touched, active days) and four described by a model (was the first funder an exchange or bridge, is the activity scripted repetition, is it single-purpose farming, does it look organically diverse). A wallet is a sybil only if at least `min_hits` rules fire.

After appeals close, the operator reveals. The contract recomputes the hash and refuses anything that doesn't match — change one threshold, add one space, swap the salt, and the reveal bounces. On chain, in the seed, the operator of the main demo drop tried twice before the real reveal: once with a more lenient `min_hits`, once with the right rules and a different salt. Both were refused and counted publicly on the drop.

And if the operator never reveals? Every pending appeal wins. Operator failure cannot hurt a user.

## The blind read

A flagged wallet appeals *from itself* — the transaction sender is the wallet, so nobody can appeal for a wallet they don't control and there's no identity to bind. It posts a small bond. The flagged list itself is published on chain and the contract computed its root, so the wallet builds its own merkle proof from that list (the app does it), asks the contract for one, or sends none and lets the contract check the published list. No appeal waits on the operator.

Once the rules are revealed, anyone can trigger the read. This is the part only GenLayer can do. Every validator fetches the wallet's outbound history from Blockscout on its own. The history inside the drop's window becomes one fixed-shape line per transaction: date, target, whether the target is a contract, its public label, method and value. That text is hashed, and validators must produce the **same hash**. Code computes the four deterministic findings from the text, and validators must agree on them exactly. Then a model reads the text and answers the four model questions with one word each, where validators may differ by one bucket. Last, each validator applies the revealed rules **in code to its own findings**. The outcome it gets must be identical to the leader's, or the round doesn't settle. ("What went wrong" explains why that last check exists.)

The model never sees the rules. Not the thresholds, not the flag, not even the word "airdrop". The prompt function takes two arguments — the snapshot and, on a contest, the contester's text — and the contract publishes the exact prompt for every appeal so anyone can read what the model saw. The model describes the wallet's behaviour; contract code applies the rules that were committed before the snapshot.

The first real read settled on the first attempt, in 61 seconds. The wallet had been funded in March 2024 by an address Blockscout labels `OKX 137`, bridged through Orbiter twice, swapped once on Uniswap, then gone quiet for two years. The validators agreed: funder an exchange, some repetition, no single-purpose farming, medium organic diversity. A single-contract NFT minter, eleven days old, came back `SCRIPTED_REPETITION=STRONG, SINGLE_PURPOSE_FARMING=STRONG, ORGANIC_DIVERSITY=LOW`.

## What went wrong

**The first on-chain read could never have settled.** I fetched the wallet's earliest activity from Blockscout's legacy `/api` endpoint. Every attempt came back `UNAVAILABLE: HTTP 429`. The contract did the right thing — decided nothing, allowed a retry — but the retry would 429 too. Measured afterwards: the legacy endpoint on Base allows **10 requests per six minutes per IP**. The v2 API allows 150 per thirty seconds. A consensus round fires every validator's requests from roughly one place at once. I rewrote the read to use v2 only (`?sort=block_number&order=asc` for earliest activity, which also carries the funder's public label inline — one fewer request), redeployed, and the next read settled first time.

**An empty list that isn't an answer.** Base's internal-transaction endpoint answered `{"status":"2","message":"...not yet processed","result":[]}` at HTTP 200. `result == []` looks exactly like "this wallet has no internal transactions." FairDrop no longer reads internal transactions at all, and says so in the vocabulary: wallet age is measured from the first *visible normal* transaction.

**Exact agreement starved a real person.** The first version compared the model's words exactly. One public wallet (bridged in from OKX, a couple of swaps, long quiet gaps) read `SCRIPTED_REPETITION=SOME` in two rounds and `NONE` in another. Every round on it ended UNDETERMINED. Nothing wrong was ever stored, so the design held. But a borderline human would never get a verdict.

**Then my fix let a leader move money.** Version two let a validator accept the leader's word if it matched its own *or sat one step toward the human end*. It sounded safe: a leader could shade a reading toward the appellant but never against them. Then I followed the shade to where it lands. A borderline sybil sits one bucket from a threshold. The leader reads it one step more human, the tolerance accepts that, the rules no longer fire, and the wallet is paid from the operator's reserve. One leader moved money across a threshold.

Version four separates the evidence from the decision. Findings may still differ by one bucket, because model readings of a borderline wallet genuinely wobble. But once the rules are revealed, every validator applies them in code to its **own** findings, and the outcome must be identical. A shade that changes nothing is accepted. A shade that crosses a threshold stops the round. So reads now happen after the reveal. The model is exactly as blind as before: the rules go to `_evaluate`, never to the prompt.

That raised a new problem. On GenLayer, an UNDETERMINED transaction commits *nothing*, so a round can't count its own failure. My first answer was tickets: a committed write before each round, counted when it expired unrun. A binding review killed it in one line: anyone could open a ticket and never run it, so the count proved nothing, and an operator could push an honest appeal to UNRESOLVED by neglect.

The fix records a failure only when the failure itself reaches consensus. `settle_stalled` is a second consensus round, and a validator accepts it only if it read the wallet, agreed with the leader on the evidence, and computed a **different** outcome. On a wallet the validators agree on, that round can't settle, however many times anyone calls it. Three genuine splits make the appeal **UNRESOLVED**: the bond comes back, the wallet may refile until the drop's read deadline, nothing is paid and nobody is condemned.

**The word "flagged" reached the model.** I wrote a checker that reads back every live prompt through the contract's `get_prompt` and looks for anything that should never be there. It found one: an operator's contest text said the wallet "shares a funding source with several flagged wallets." No rule had leaked — but the promise is that the model never sees the flag either. The contest-text screen now also refuses framing words (flag, sybil, airdrop, appeal, allocation, verdict), the contract was redeployed, and the checker runs as part of the audit.

**The brief's two commitments can't happen at the same moment.** The rules must be sealed before the snapshot. The flagged list is the *output* of those rules applied to the snapshot — it cannot exist before it. So the seal is committed at creation, and the flagged list is published on chain after the snapshot, with the contract computing its root.

**None of my keys have a history.** The canonical instance requires the flagged wallet to send its own appeal. I checked all 199 keys I control across five Blockscout chains: zero transactions. So there are two instances of the same source. The canonical one runs on my own keys and honestly reads empty histories. The DEMO one lets a drop's operator file on behalf of a named public wallet — real Base histories, labelled DEMO everywhere.

**A binding review found six more gaps.** The question it asked: is every stored result tied to the drop, the snapshot, the wallet and the committed rules?
- *The first funding could come from after the snapshot, or be a guess.* It now must be at or before the snapshot. It must also be provably the first: on the first page of the wallet's history, with no second sender in the same second. Otherwise code sets the funder finding to UNCLEAR, and a drop whose rules use it reads INSUFFICIENT_HISTORY.
- *Appeals depended on the operator handing out proofs.* The operator only committed a root. Now the operator publishes the whole list and the contract computes the root.
- *Merkle leaves and nodes shared a hash domain.* They now carry `0x00` and `0x01` prefixes.
- *A per-drop cap of 100 appeals* could be filled by whoever controls many flagged wallets. The cap is now 3 filings per wallet.
- *An UNRESOLVED appeal's refile window could close before it was UNRESOLVED.* Refiles now run to one contest window after the reveal deadline, and each refile gets its own full read window.
- *A mined transaction with an unreadable timestamp was silently dropped.* Now it makes the read INSUFFICIENT.

## What the final version did on chain

The v6 demo ran eleven drops while the owner had the contract paused. Pause
stops new drops and nothing else. Nineteen appeals were filed: nine won
(HUMAN_PATTERN), one lost (SYBIL_PATTERN) and nine came back
INSUFFICIENT_HISTORY. After every drop closed and every account claimed, the
books read 0 balance, 0 locked, 0 payable.

- **The rules held both ways.** A 920-day-old wallet, funded from an exchange,
  won by the rules. A 15-day-old, single-contract minter lost. Two reveals that
  didn't match the seal were refused and counted on the drop.
- **Griefing did nothing.** A stranger and the operator each called
  `settle_stalled` on an appeal the validators agreed on. Both rounds were
  UNDETERMINED, and zero splits were recorded.
- **No reveal meant everyone won.** On two drops the operator never revealed,
  and every pending appeal won by default. On one of them, two winners were
  owed 0.6 GEN each from a 1 GEN reserve, and each was paid exactly 0.5 GEN.
- **Contests held.** A contest text that framed the case was refused before
  it could reach a model. Real contests re-read the stored snapshot, and the
  outcome held.
- **A truncated history was never condemned.** It came back
  INSUFFICIENT_HISTORY, was refiled after the reveal deadline inside the
  extended window, and came back INSUFFICIENT_HISTORY again.
- **The whole lifecycle ran through the live app.** A headless browser used
  real contract calls for every step: create, publish the list, build a proof
  from that list, file, a refused duplicate, a refused bad reveal, the real
  reveal, read, verdict, contest, close and both claims.

The walk found a real bug. The app waited for a transaction to be exactly
ACCEPTED, and Studio sometimes finalises between two polls, so a successful
write could spin for ten minutes. Now any decided state counts.

Two things did not happen. First, the borderline wallet's three split rounds
all ended UNDETERMINED because the validators agreed, so there is no
UNRESOLVED on chain; that path is proven offline. Second, Blockscout's Base
API answered HTTP 500 to most requests for about three hours. Six appeals
could not be read in time and expired as INSUFFICIENT_HISTORY. The bond came
back and nobody was condemned. An infrastructure failure costs a verdict, not
a user.

## The coverage gate

The mistake I've made before, and designed against here: proving a negative from evidence that couldn't have contained the counterexample. Blockscout returns 50 transactions a page. If a wallet sent 80 transactions between the lookback start and now (activity after the snapshot fills the page too), the page doesn't reach back far enough, and "no sign of organic behaviour on this page" says nothing about the wallet.

So a read counts only if the outbound page is complete (fewer than 50 items *and* no next page) or its oldest item reaches back to the lookback start, and the earliest-activity page is complete or verifiably ascending. Otherwise the outcome is `INSUFFICIENT_HISTORY`: bond returned, refile allowed. It never condemns. In the seed, a wallet with 50 outbound transactions in 24 days hit exactly that — read, refused to judge, refiled, refused again. Honest both times.

The gate is measured over every item on the page, not just the ones the wallet signed, so it holds even if a host silently ignores `filter=from`.

## Contests, and the novelty gate

Outcomes are provisional for 48 hours. The losing side — the operator if the wallet won, the appellant if it lost — can contest once, with a 5% bond and *new* evidence. The contest re-reads the same stored snapshot (no fresh fetch; the history is evidence, not a moving target) with the new text as context. Text that repeats the appeal statement is refused by the novelty gate carried over from GrantJudge. Text that names the rule vocabulary or contains the salt is refused too, because it's the one caller-written string that reaches a prompt.

## Money

The operator escrows an appeal reserve at creation. Nothing is paid until every appeal is final and the reveal deadline has passed; then every winner gets the same share — full allocation if the reserve covers it, pro-rata if it doesn't. First-come never matters. The leftover goes back to the operator. Clock-reading methods only book; the one method that transfers reads no clock. On the demo, after every drop closed and everyone claimed, the books read zero.

## Honest limits

- Reading behaviour is a judgement. Four one-word answers, validator agreement on each, rules applied by code, a contest — all of that bounds the judgement. None of it makes a model infallible.
- Blockscout is the only source. Labels can be missing; replicas lag by minutes; 50-item pages mean very active wallets read as INSUFFICIENT.
- Studio Dev queues value transfers and may not deliver them. The contract reports the gap as `undelivered_wei`; the books still close at zero.
- A split needs the validators' own outcomes to differ from the leader's, which only happens one bucket from a threshold. There a dishonest leader can help record splits; the worst it buys is UNRESOLVED, which neither pays nor condemns.
- Explorer labels are today's, not the snapshot's. Transactions, first activity and first funding are bound to the snapshot; the labels aren't, and they reach the model only as descriptive text.
- The canonical instance's 48-hour contest window is still open, so its drop can't close yet. That's the design, not a gap.

## The point

A hidden rule that can be checked afterwards is a different thing from a secret. FairDrop doesn't ask users to trust the operator's rules, or the operator's reviewer, or a model's opinion. It asks them to check one hash, read one prompt, and follow one line-by-line table from findings to outcome.

*Code, tests, probe logs and the full audit: github.com/kenil1710/fairdrop · Live: fairdrop-six.vercel.app*
