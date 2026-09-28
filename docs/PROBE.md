# PROBE — what was measured before (and while) building

Everything here was measured against live Blockscout hosts and GenLayer Studio
Dev (chain 61997) on 2026-09-28. Reproduce the Blockscout half with
`python3 tools/probe.py` (writes `docs/probe/results.json`); the on-chain half
is `node test/probe_read.mjs` (log in `docs/probe/`).

---

## 1. Does `?filter=from` return only outbound transactions?

`/api/v2/addresses/{a}/transactions` asked three ways for the same busy wallet
(`vitalik.eth`, active on every chain):

| host | `filter=from` | all items outbound? | no filter: all outbound? | honoured |
|---|---|---|---|---|
| eth.blockscout.com | 200, 50 items, next page | **yes** | no (mixed) | **yes** |
| base.blockscout.com | 200, 50 items, next page | **yes** | no | **yes** |
| arbitrum.blockscout.com | 200, 14 items, no next | **yes** | no | **yes** |
| polygon.blockscout.com | 200, 1 item, no next | **yes** | no | **yes** |
| eth-sepolia.blockscout.com | 200, 0 items | (vacuous) | no | **yes** |
| base-sepolia.blockscout.com | 200, 0 items | (vacuous) | no | **yes** |
| optimism / gnosis / scroll | **301** | — | — | not usable |

`filter=to` returned only inbound items on every host, which is the
cross-check that the parameter is doing real work. The three hosts that answer
301 do so to a redirect GenVM's fetcher does not follow; they are not in the
allowlist.

**The filter is not depended on anyway.** The coverage gate is measured over
every item on the page, signed by the wallet or not, so on a host that ignored
the filter a mixed page can only make a read *less* likely to count as covered,
never make a thin history look complete. Offline tests
`test_filter_ignored_mixed_page_still_gated` and
`test_filter_ignored_complete_mixed_page_counts_outbound_only` stage it.

## 2. How completeness is proven

- **Short page.** v2's page size is fixed at 50. A page with fewer than 50 items
  *and* `next_page_params: null` is the whole outbound history. Measured: every
  short page above had `next_page_params: null`; every full page had it set.
  FairDrop requires both.
- **Reach.** Otherwise the page's oldest item must be at or before the drop's
  lookback start: then every outbound transaction in the window is on it.
- **Earliest activity.** `?sort=block_number&order=asc` returns the oldest
  transactions (in and out) first — measured working on base (first item
  2024-03-21, the wallet's OKX funding transfer). A complete page is the whole
  history; a full page is used only if its timestamps are verifiably ascending,
  so a host that ignored `order=asc` is caught on the data.

Anything else is INSUFFICIENT_HISTORY. Bounded: exactly two requests per
validator per read, no pagination.

## 3. Wallets we control

Every key on disk from previous projects (`*/test/.accounts.json`) plus the two
GenLayer CLI keystores — **199 addresses** (`docs/probe/controlled-addresses.txt`)
— checked with `/api/v2/addresses/{a}/counters` on eth, base, arbitrum,
eth-sepolia and base-sepolia: **0 have any transaction**. Getting testnet ETH
onto them needs a faucet with a captcha or a mainnet balance. The studio-dev
explorer (`explorer-studio-dev.genlayer.com`) is not Blockscout (`/api/v2/*` is
404), so the keys' real studio history is not readable either.

**Consequence: a DEMO instance.** Same source, `demo_mode=True`: a drop's
operator may file on behalf of a named wallet. The demo reads these public Base
wallets (chosen from recent Base activity by `docs/probe/demo-wallets.json`;
outcomes are whatever the validators read):

| role | address | outbound page | shape |
|---|---|---|---|
| human_long_tail | `0x0f2589…d923` | 6, complete | OKX-funded 2024, bridge + swap, long gaps |
| human_diverse | `0x1c1ff5…983a` | 13, complete | 8 targets over 893 days |
| human_swapper | `0x35b4a5…63d8` | 13, complete | 10 targets over 348 days |
| farm_minter_a | `0x841011…efa9` | 5, complete | `mintNFTs` on one contract, every few days, 16 days old |
| farm_minter_b | `0x8cd35f…6cd3` | 6, complete | same contract, same method |
| farm_quester | `0xe288dd…3ac2` | 20, complete | `claimQuest` on one contract |
| too_active | `0xd5512d…0265` | 50, **next page** | oldest item 24 days back: cannot reach a 900-day lookback |

The canonical instance is still exercised on chain with our own keys (sender ==
wallet); their reads are honest reads of an empty history.

## 4. Rate limits — measured, and they changed the contract

The first on-chain read used the legacy
`/api?module=account&action=txlist&sort=asc` for earliest activity. Three
attempts, all `UNAVAILABLE: earliest activity HTTP 429`
(`docs/probe/onchain-read-legacy-429.log`, against the superseded demo
`0xb9589f…65ea`). The contract behaved exactly as designed — nothing decided,
retryable — but no read could ever settle. Measured afterwards from one IP:

| endpoint (base.blockscout.com) | `x-ratelimit-limit` | reset | 12 parallel requests |
|---|---|---|---|
| legacy `/api?module=account…` | **10** | ~341 s | 12 × 429 |
| v2 `/api/v2/addresses/…` | **150** | ~20–30 s | 12 × 200 |

Our own probe run hit the same wall: its later legacy queries returned nothing
(`first_txs: null` for six of seven wallets in `results.json`).

The contract now uses v2 only: `?filter=from` and `?sort=block_number&order=asc`.
The ascending v2 items carry the sender's public label inline (`from.name`,
`from.metadata.tags`), which removed the third request (a funder label lookup)
as well. Redeployed; the next read settled on its first attempt (§6).

## 5. `result: []` is not always "none"

`/api?module=account&action=txlistinternal&sort=asc` on Base answered:

```json
{"message":"Some internal transactions within this block range have not yet been processed","result":[],"status":"2"}
```

An empty list at HTTP 200 that is *not* an answer. FairDrop no longer reads the
legacy API or internal transactions at all; wallet age is defined as days from
the first visible normal transaction, and the vocabulary says so.

## 6. The first on-chain blind read (demo `0x7faea9…f5`, drop #1, appeal #1)

```
read_wallet(1) → ACCEPTED OK [61s]  first attempt
features  WALLET_AGE_DAYS=920, OUTBOUND_TX_COUNT=6, DISTINCT_CONTRACTS_TOUCHED=2, ACTIVE_DAYS=5
findings  FIRST_FUNDER_IS_EXCHANGE_OR_BRIDGE=YES, SCRIPTED_REPETITION=SOME,
          SINGLE_PURPOSE_FARMING=NONE, ORGANIC_DIVERSITY=MEDIUM
snapshot  sha256 775b0c03ec163f60af501785856cd454874e8739d4108619e72c01ba13c94d91
          funder=0xfd92f4…7eda funder_label=OKX_137
```

Every validator fetched the history itself, produced a byte-identical snapshot,
and the models agreed on all four buckets. The funder label (`OKX 137`, from
Blockscout's public tags) is what let the model answer YES to the exchange
question. Full log: `docs/probe/onchain-read.log`.

## 7. Payload sizes

v2 `?filter=from`: 15–58 KB for the demo wallets, 754 KB for `too_active`,
630 KB for `vitalik.eth`. Every validator pays that per read; a read that times
out is UNAVAILABLE and retryable, never a verdict.
