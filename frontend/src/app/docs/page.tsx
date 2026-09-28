"use client";

import { BookOpen, Code2, Fingerprint, Hash, HelpCircle, Lock, Scale, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Hash as HashChip, Section } from "@/components/ui";
import { CANONICAL_ADDRESS, CONTRACT_ADDRESS, REGISTRY_ADDRESS } from "@/lib/genlayer";
import { DET_FINDINGS, FINDING_TEXT, MODEL_FINDINGS, SCALES } from "@/lib/fairdrop";

const FAQ = [
  ["Can the operator change the rules after seeing who got flagged?", "No. The commitment is written when the drop is created, and the contract refuses a snapshot time that is not in the future. The reveal must hash to that commitment exactly or it is refused."],
  ["What if the operator just never reveals?", "Then every pending appeal is won by default once the reveal deadline passes. The reserve pays the winners. Operator failure cannot hurt a user."],
  ["Can the model be talked into a verdict?", "The model never gives a verdict. It answers four fixed questions with one word each, over a history snapshot in which every third-party string (contract names, tags, method names) is reduced to a safe character set. The verdict is computed by contract code from the revealed rules."],
  ["Does the model see the rules?", "No, by construction: the prompt function takes the stored snapshot and (on a contest) the contest text, nothing else. Contest text that names the rule vocabulary, talks about rules, frames the case (flagged, sybil, airdrop, appeal) or contains the drop's salt is refused. Every appeal page shows the exact prompt, rebuilt from storage."],
  ["What if Blockscout only returns part of the history?", "Then the outcome is INSUFFICIENT_HISTORY: the bond comes back and the wallet may refile. A partial history can never condemn anyone."],
  ["What if more people win than the reserve can pay?", "Every winner gets the same pro-rata share at close. Nothing is paid first-come; payouts wait until every appeal is final."],
  ["Can the operator withdraw the reserve during appeals?", "There is no withdraw method. The only way reserve leaves is close_drop, which refuses until the reveal deadline has passed and every appeal is final, then pays winners and returns the leftover."],
  ["Can the owner freeze funds?", "Pause stops new drops and nothing else. Appeals, reads, decisions, contests, settlement, settle_stalled and claim_payout all work while paused. The owner has no withdraw method."],
];

export default function DocsPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-3xl font-bold text-sand">How FairDrop works</h1>
          <p className="mt-2 text-muted">The model never sees the rules. It describes the wallet&apos;s behaviour; contract code applies the rules that were committed before the snapshot.</p>
        </div>

        <Section title="Commit-reveal" icon={<Hash size={18} className="text-coral" />}>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-sand/90">
            <li><b>Seal.</b> The operator writes rules in a fixed vocabulary, serialises them canonically, and commits <span className="mono">sha256(rules_json + salt)</span> in <span className="mono">create_drop</span>, together with the allocation, bond, windows, chain and lookback. The snapshot time must be in the future, so the seal is provably older than the snapshot.</li>
            <li><b>Flag.</b> After the snapshot, the operator publishes the whole flagged list on chain and the contract computes its merkle root (leaf = sha256(0x00‖address), node = sha256(0x01‖min‖max)). Any flagged wallet can build its own proof from that list, or file with none. (The list cannot exist before the snapshot, so this is the one step that comes after it.)</li>
            <li><b>Reveal.</b> After the appeal window, <span className="mono">reveal_rules</span> is accepted only if the text and salt hash to the seal exactly. A mismatch is refused and counted publicly. After the reveal deadline, unrevealed drops lose every pending appeal.</li>
          </ol>
          <pre className="snapshot mono mt-4 rounded-lg bg-[var(--bg-2)] p-3 text-[0.72rem] text-sand/80">{`{"min_hits":2,"rules":[{"condition":"LT","finding":"WALLET_AGE_DAYS","threshold":60},{"condition":"GTE","finding":"SCRIPTED_REPETITION","threshold":"SOME"}]}`}</pre>
          <p className="mt-2 text-xs text-muted">Canonical form: keys sorted, no whitespace, rules in order. A revealed string that is not already canonical is refused, so one commitment can only ever mean one document.</p>
        </Section>

        <Section title="The vocabulary" icon={<BookOpen size={18} className="text-sand" />}>
          <ul className="space-y-2 text-sm">
            {DET_FINDINGS.map((f) => <li key={f}><span className="mono text-sand">{f}</span> <span className="text-muted">— deterministic. {FINDING_TEXT[f]}.</span></li>)}
            {MODEL_FINDINGS.map((f) => <li key={f}><span className="mono text-coral">{f}</span> <span className="text-muted">— model: {SCALES[f].join(" / ")} / UNCLEAR. {FINDING_TEXT[f]}</span></li>)}
          </ul>
          <p className="mt-3 text-xs text-muted">A rule is {"{finding, condition, threshold}"} with condition LT, LTE, GT, GTE, EQ or NEQ. A wallet is SYBIL_PATTERN only if at least min_hits rules fire. A rule on an UNCLEAR model finding never fires.</p>
        </Section>

        <Section title="Blind validation" icon={<Fingerprint size={18} className="text-coral" />}>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-sand/90">
            <li>Each validator fetches <span className="mono break-all">/api/v2/addresses/&#123;wallet&#125;/transactions?filter=from</span> (outbound only) and <span className="mono break-all">?sort=block_number&amp;order=asc</span> (earliest activity and first funding) from Blockscout. Two requests, no pagination.</li>
            <li>The outbound transactions inside [lookback start, snapshot] are reduced to one fixed-shape line each. That snapshot is hashed; validators must produce the identical hash.</li>
            <li>Code computes the four deterministic findings from the snapshot text; validators must agree exactly.</li>
            <li>The model reads the snapshot and answers the four model findings with one word each. It never sees the rules, the flag or any threshold. Each finding may differ from the leader&apos;s by one bucket.</li>
            <li>Reads run only after the reveal, because each validator applies the revealed rules in code to its <b>own</b> findings, and the outcome must be <b>identical</b> to the leader&apos;s. A one-bucket difference that would flip the outcome means the round does not settle.</li>
            <li>A read that doesn&apos;t settle commits nothing. A failure is recorded only by <span className="mono">settle_stalled</span>, a consensus round validators accept only if they read the wallet, agreed on the evidence and computed a <b>different</b> outcome from the leader&apos;s. Three genuine splits make the appeal <b>UNRESOLVED</b>: bond returned, refile allowed, never paid, never condemned.</li>
            <li>Everything read is bound to the snapshot: transactions after it, first activity after it and funding after it never count. A first funding that can&apos;t be proven is UNCLEAR, and a drop whose rules use it reads INSUFFICIENT_HISTORY.</li>
            <li><span className="mono">decide</span> then books the agreed outcome, line by line. It is provisional for the contest window.</li>
          </ol>
        </Section>

        <Section title="The coverage gate" icon={<ShieldCheck size={18} className="text-human" />}>
          <p className="text-sm text-sand/90">A negative claim needs evidence that could have contained the counterexample. The outbound page counts only if it is complete (fewer than 50 items and no next page) or its oldest item reaches back to the lookback start. The earliest-activity page counts only if it is complete or verifiably ascending. Otherwise: <b className="text-insufficient">INSUFFICIENT_HISTORY</b>, bond returned, refile allowed.</p>
          <p className="mt-2 text-sm text-muted">The coverage test is measured over every item on the page, so it holds even on a host that silently ignored <span className="mono">filter=from</span>. The filter makes reads useful; the gate makes them safe.</p>
        </Section>

        <Section title="Contests" icon={<Scale size={18} className="text-sand" />}>
          <p className="text-sm text-sand/90">For 48 hours (canonical) the losing side — the operator for a HUMAN outcome, the appellant for a SYBIL one — may contest once, with a bond of 5% of the allocation and new evidence. Text that repeats the appeal statement is refused by the novelty gate. The contest re-reads the same stored snapshot (no fresh fetch) with the evidence as context, and the rules are applied again. A flip returns the contester&apos;s bond; a failed appellant contest forfeits to the reserve, a failed operator contest pays the appellant.</p>
        </Section>

        <Section title="Integrate: is_cleared" icon={<Code2 size={18} className="text-coral" />}>
          <p className="text-sm text-sand/90">Any airdrop distributor can ask before paying a flagged wallet. <span className="mono">FairDropRegistry</span> holds no funds and has no payable method.</p>
          <pre className="snapshot mono mt-3 rounded-lg bg-[var(--bg-2)] p-3 text-[0.72rem] text-sand/80">{`@gl.contract.interface
class IFairDropRegistry:
    class View:
        def is_cleared(self, wallet: str, drop_id: int) -> bool: ...
        def get_appeal(self, wallet: str, drop_id: int) -> str: ...

if IFairDropRegistry(REGISTRY).view().is_cleared(wallet, drop_id):
    pay(wallet)   # final HUMAN_PATTERN: by the rules, a contest, or a missed reveal`}</pre>
          <div className="mt-3 space-y-1 text-xs text-muted">
            <div>FairDrop (demo, used by this app) <HashChip value={CONTRACT_ADDRESS} n={8} /></div>
            {CANONICAL_ADDRESS && <div>FairDrop (canonical) <HashChip value={CANONICAL_ADDRESS} n={8} /></div>}
            {REGISTRY_ADDRESS && <div>FairDropRegistry <HashChip value={REGISTRY_ADDRESS} n={8} /></div>}
          </div>
        </Section>

        <section id="demo">
          <Section title="Why there is a DEMO instance" icon={<Lock size={18} className="text-pending" />}>
            <p className="text-sm text-sand/90">The canonical contract requires the flagged wallet to send its own appeal. None of the keys we control has any history on a Blockscout-indexed chain, so a canonical appeal from them can only ever read an empty history. The DEMO instance runs the same source with one difference: a drop&apos;s operator may file on behalf of a named public wallet, so real Base histories — a long-lived user, a single-contract minter, a hyperactive account — can be read blind. Its windows are minutes instead of days. It says DEMO in <span className="mono">get_config</span>, in this app and in the README.</p>
          </Section>
        </section>

        <Section title="FAQ" icon={<HelpCircle size={18} className="text-sand" />}>
          <dl className="space-y-4">
            {FAQ.map(([q, a]) => (
              <div key={q}><dt className="font-semibold text-sand">{q}</dt><dd className="mt-1 text-sm text-muted">{a}</dd></div>
            ))}
          </dl>
        </Section>

        <Section title="Honest limits" icon={<HelpCircle size={18} className="text-pending" />}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
            <li>Reading behaviour is a judgement. The vocabulary bounds it to four one-word answers and validators must agree on each, but a model can still describe a real person as scripted.</li>
            <li>Blockscout is the only source. Its labels can be missing, its replicas lag by minutes, and internal transactions are not read (on Base the internal endpoint answers &quot;not yet processed&quot;). Wallet age is measured from the first visible normal transaction.</li>
            <li>Studio Dev queues value transfers and may not deliver them; the contract publishes the gap as <span className="mono">undelivered_wei</span>. Its books still drain to zero.</li>
            <li>A split round needs the validators&apos; own outcomes to differ from the leader&apos;s, which only happens one bucket from a threshold. There, a dishonest leader could help record splits; the worst result is UNRESOLVED, which neither pays nor condemns. A wallet the validators agree on can never be made UNRESOLVED.</li>
            <li>Explorer labels (contract names, exchange tags) are today&apos;s, not the snapshot&apos;s. Validators agree on them, and they reach the model only as descriptive text.</li>
          </ul>
        </Section>
      </div>
    </AppShell>
  );
}
