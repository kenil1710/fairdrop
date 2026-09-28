"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, Hash as HashIcon, KeyRound, ListChecks, Lock, Plus, Trash2, Unlock, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TxButton } from "@/components/TxButton";
import { useWallet } from "@/components/WalletProvider";
import { Hash, Section } from "@/components/ui";
import { useAsync } from "@/components/useAsync";
import { getDrops, write } from "@/lib/contract";
import {
  CONDITIONS, COND_SYMBOL, DET_FINDINGS, FINDING_TEXT, MODEL_FINDINGS, SCALES, canonRules,
  commitment, gen, isModelFinding, merkle, newSalt, toWei, type Rule, type WriteResult,
} from "@/lib/fairdrop";

const STEPS = ["Rules", "Seal", "Drop", "Flagged list", "Reveal"];

export default function OperatorPage() {
  const { account } = useWallet();
  const [step, setStep] = useState(0);
  const [rules, setRules] = useState<Rule[]>([
    { finding: "WALLET_AGE_DAYS", condition: "LT", threshold: 60 },
    { finding: "SCRIPTED_REPETITION", condition: "GTE", threshold: "SOME" },
    { finding: "SINGLE_PURPOSE_FARMING", condition: "EQ", threshold: "STRONG" },
  ]);
  const [minHits, setMinHits] = useState(2);
  const [salt, setSalt] = useState(() => newSalt());
  const [hash, setHash] = useState("");
  const [form, setForm] = useState({ name: "", chain: "base", protocol: "", contracts: "", snapIn: 60, lookback: 365, appealH: 24, revealH: 24, alloc: "0.5", bond: "0.05", reserve: "1" });
  const [flaggedText, setFlaggedText] = useState("");
  const [tree, setTree] = useState<{ root: string; proofs: Record<string, string> } | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const [revealDrop, setRevealDrop] = useState(0);
  const [revealJson, setRevealJson] = useState("");
  const [revealSalt, setRevealSalt] = useState("");
  const mine = useAsync(() => getDrops(), [account, created]);
  const myDrops = (mine.data?.drops ?? []).filter((d) => account && d.operator.toLowerCase() === account.toLowerCase());

  const doc = useMemo(() => ({ min_hits: Math.min(minHits, rules.length), rules }), [minHits, rules]);
  const canon = canonRules(doc);
  const wallets = flaggedText.split(/[\s,;]+/).filter((w) => /^0x[0-9a-fA-F]{40}$/.test(w));

  function setRule(i: number, patch: Partial<Rule>) {
    setRules(rules.map((r, j) => {
      if (j !== i) return r;
      const next = { ...r, ...patch };
      if (patch.finding) next.threshold = isModelFinding(patch.finding) ? SCALES[patch.finding][SCALES[patch.finding].length - 1] : 30;
      return next;
    }));
  }

  function downloadSecret() {
    const blob = new Blob([JSON.stringify({ rules_json: canon, salt, rules_hash: hash }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fairdrop-rules-${hash.slice(0, 8)}.json`;
    a.click();
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-sand">Operator</h1>
        <p className="mt-1 text-sm text-muted">Seal your sybil rules before the snapshot, escrow an appeal reserve, publish the flagged list, reveal. Rules and salt are hashed in this browser and never sent anywhere until you reveal.</p>
      </div>
      <ol className="mb-6 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" onClick={() => setStep(i)} className="chip" style={{ color: i === step ? "var(--coral)" : i < step ? "var(--human)" : "var(--muted)" }}>
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Section title="Build the rules" icon={<ListChecks size={18} className="text-coral" />}>
          <p className="mb-4 text-sm text-muted">Rules use a fixed vocabulary. Deterministic findings are computed by contract code; model findings are the model&apos;s bucketed description. A rule on an UNCLEAR model finding never fires.</p>
          <div className="space-y-3">
            {rules.map((r, i) => (
              <motion.div key={i} layout className="card-2 grid gap-2 p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                <select className="input mono text-xs" value={r.finding} onChange={(e) => setRule(i, { finding: e.target.value })}>
                  <optgroup label="Computed in code">{DET_FINDINGS.map((f) => <option key={f}>{f}</option>)}</optgroup>
                  <optgroup label="Model description">{MODEL_FINDINGS.map((f) => <option key={f}>{f}</option>)}</optgroup>
                </select>
                <select className="input text-xs sm:w-20" value={r.condition} onChange={(e) => setRule(i, { condition: e.target.value })}>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{COND_SYMBOL[c]} {c}</option>)}
                </select>
                {isModelFinding(r.finding) ? (
                  <select className="input text-xs sm:w-28" value={String(r.threshold)} onChange={(e) => setRule(i, { threshold: e.target.value })}>
                    {SCALES[r.finding].map((v) => <option key={v}>{v}</option>)}
                  </select>
                ) : (
                  <input className="input text-xs sm:w-28" type="number" min={0} max={100000} value={Number(r.threshold)} onChange={(e) => setRule(i, { threshold: Math.max(0, Math.min(100000, Number(e.target.value) || 0)) })} />
                )}
                <button type="button" className="btn btn-ghost !p-2" aria-label="Remove rule" onClick={() => setRules(rules.filter((_, j) => j !== i))} disabled={rules.length <= 1}><Trash2 size={14} /></button>
                <p className="text-[0.7rem] text-muted sm:col-span-4">{FINDING_TEXT[r.finding]}</p>
              </motion.div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-ghost" disabled={rules.length >= 12} onClick={() => setRules([...rules, { finding: "ACTIVE_DAYS", condition: "LT", threshold: 3 }])}><Plus size={14} /> Add rule</button>
            <label className="flex items-center gap-2 text-sm text-muted">SYBIL if at least
              <input className="input w-16" type="number" min={1} max={rules.length} value={minHits} onChange={(e) => setMinHits(Math.max(1, Number(e.target.value) || 1))} /> rules fire
            </label>
          </div>
          <div className="mt-4"><div className="label mb-1">Canonical JSON (exactly what is hashed)</div><pre className="snapshot mono rounded-lg bg-[var(--bg-2)] p-3 text-[0.7rem] text-sand/80">{canon}</pre></div>
          <button type="button" className="btn btn-primary mt-4" onClick={() => setStep(1)}>Next: seal</button>
        </Section>
      )}

      {step === 1 && (
        <Section title="Seal: sha256(rules + salt)" icon={<Lock size={18} className="text-coral" />}>
          <label className="label" htmlFor="salt">Salt (32 random bytes, generated here)</label>
          <div className="mt-1 flex gap-2"><input id="salt" className="input mono text-xs" value={salt} onChange={(e) => setSalt(e.target.value.trim())} /><button type="button" className="btn btn-ghost" onClick={() => setSalt(newSalt())}><KeyRound size={14} /></button></div>
          <p className="mt-2 text-xs text-muted">The salt stops anyone brute-forcing a small rule space from the hash. The contract requires at least 32 hex characters at reveal.</p>
          <button type="button" className="btn btn-primary mt-4" onClick={async () => setHash(await commitment(doc, salt))}><HashIcon size={14} /> Compute commitment</button>
          {hash && (
            <div className="mt-4 space-y-3">
              <div className="card-2 p-3"><div className="label">rules_hash</div><div className="mono break-all text-sm text-sand">{hash}</div></div>
              <button type="button" className="btn btn-coral" onClick={downloadSecret}><Download size={14} /> Save rules + salt (you need both to reveal)</button>
              <p className="text-xs text-sybil">Lose them and you cannot reveal — and every pending appeal is then won by default.</p>
              <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>Next: create the drop</button>
            </div>
          )}
        </Section>
      )}

      {step === 2 && (
        <Section title="Create the drop and escrow the reserve" icon={<Users size={18} className="text-sand" />}>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["name", "Drop name", "text"], ["protocol", "Protocol name", "text"],
              ["contracts", "Protocol contracts (comma separated)", "text"], ["snapIn", "Snapshot in (minutes, must be future)", "number"],
              ["lookback", "Lookback (days)", "number"], ["appealH", "Appeal window (hours)", "number"],
              ["revealH", "Reveal window (hours)", "number"], ["alloc", "Allocation per wallet (GEN)", "text"],
              ["bond", "Appeal bond (GEN)", "text"], ["reserve", "Appeal reserve (GEN, ≥ 1)", "text"],
            ] as const).map(([k, label, type]) => (
              <label key={k} className="block"><span className="label">{label}</span>
                <input className="input mt-1" type={type} value={String(form[k])} onChange={(e) => setForm({ ...form, [k]: type === "number" ? Number(e.target.value) : e.target.value })} />
              </label>
            ))}
            <label className="block"><span className="label">Chain</span>
              <select className="input mt-1" value={form.chain} onChange={(e) => setForm({ ...form, chain: e.target.value })}>
                {["ethereum", "base", "arbitrum", "polygon", "sepolia", "base-sepolia"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 text-xs text-muted">Commitment <Hash value={hash} /> — frozen with every parameter above. There is no setter.</div>
          <div className="mt-4">
            <TxButton
              label={`Create drop and escrow ${form.reserve} GEN`}
              disabled={!hash}
              send={(acct) => write(acct, "create_drop", [form.name, form.chain, hash, Math.floor(Date.now() / 1000) + form.snapIn * 60, form.lookback, form.appealH * 3600, form.revealH * 3600, toWei(form.alloc), toWei(form.bond), form.protocol, form.contracts], toWei(form.reserve))}
              onDone={(r: WriteResult) => { if (r.status === "OK" && typeof r.drop_id === "number") { setCreated(r.drop_id); setStep(3); } }}
            />
          </div>
        </Section>
      )}

      {step === 3 && (
        <Section title="Commit the flagged list (after the snapshot)" icon={<Users size={18} className="text-sand" />}>
          <label className="label" htmlFor="dropSel">Drop</label>
          <select id="dropSel" className="input mt-1" value={created ?? 0} onChange={(e) => setCreated(Number(e.target.value))}>
            <option value={0}>Choose…</option>
            {myDrops.map((d) => <option key={d.drop_id} value={d.drop_id}>#{d.drop_id} {d.name} — {d.phase}</option>)}
          </select>
          <textarea className="input mono mt-3 min-h-32 text-xs" value={flaggedText} onChange={(e) => { setFlaggedText(e.target.value); setTree(null); }} placeholder="Flagged wallets, one per line" />
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className="btn btn-ghost" disabled={!wallets.length} onClick={async () => setTree(await merkle(wallets))}>Build merkle tree ({wallets.length})</button>
            {tree && <TxButton label="Commit root" send={(acct) => write(acct, "commit_flagged", [created, tree.root, wallets.length])} />}
          </div>
          {tree && (
            <div className="mt-4 space-y-2">
              <div className="text-xs text-muted">root <Hash value={tree.root} /> — publish every wallet&apos;s proof:</div>
              <pre className="snapshot mono max-h-64 overflow-auto rounded-lg bg-[var(--bg-2)] p-3 text-[0.65rem] text-sand/80">{JSON.stringify(tree.proofs, null, 1)}</pre>
            </div>
          )}
        </Section>
      )}

      {step === 4 && (
        <Section title="Reveal" icon={<Unlock size={18} className="text-human" />}>
          <p className="mb-3 text-sm text-muted">Between the end of the appeal window and the reveal deadline. The contract recomputes sha256(rules_json + salt) and refuses anything that does not match the seal exactly.</p>
          <select className="input" value={revealDrop} onChange={(e) => setRevealDrop(Number(e.target.value))}>
            <option value={0}>Choose a drop…</option>
            {myDrops.filter((d) => !d.revealed).map((d) => <option key={d.drop_id} value={d.drop_id}>#{d.drop_id} {d.name} — {d.phase}</option>)}
          </select>
          <textarea className="input mono mt-3 min-h-20 text-xs" value={revealJson} onChange={(e) => setRevealJson(e.target.value)} placeholder='{"min_hits":2,"rules":[…]}' />
          <input className="input mono mt-2 text-xs" value={revealSalt} onChange={(e) => setRevealSalt(e.target.value)} placeholder="salt" />
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className="btn btn-ghost" onClick={() => { setRevealJson(canon); setRevealSalt(salt); }}>Use this session&apos;s rules</button>
            <TxButton label="Reveal rules" className="btn btn-primary" disabled={!revealDrop || !revealJson} send={(acct) => write(acct, "reveal_rules", [revealDrop, revealJson, revealSalt])} onDone={() => void mine.reload()} />
          </div>
          {myDrops.length > 0 && (
            <div className="mt-6">
              <div className="label mb-2">Your drops</div>
              <ul className="space-y-1 text-sm">{myDrops.map((d) => <li key={d.drop_id} className="flex justify-between"><span className="text-sand">#{d.drop_id} {d.name}</span><span className="text-muted">{d.revealed ? "revealed" : "sealed"} · {gen(d.reserve_wei)} GEN</span></li>)}</ul>
            </div>
          )}
        </Section>
      )}
    </AppShell>
  );
}
