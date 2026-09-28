"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Fingerprint, Hash, Lock, Scale, ShieldCheck, Unlock } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Seal } from "@/components/Seal";
import { CountUp } from "@/components/ui";
import { useAsync } from "@/components/useAsync";
import { getDrops, getStats } from "@/lib/contract";
import { gen } from "@/lib/fairdrop";

const STEPS = [
  { icon: Hash, title: "Seal the rules", body: "Before the snapshot, the operator commits sha256(rules + salt). The contract refuses a snapshot that is not in the future, so the seal is provably older than the list it produces." },
  { icon: Fingerprint, title: "Appeal from the wallet", body: "The flagged list is published on chain. A flagged wallet appeals from itself with a bond, building its own proof from that list. No forms, no identity - the signature is the identity." },
  { icon: Unlock, title: "Reveal the rules", body: "The reveal must hash to the seal or it is refused. Miss the reveal and every pending appeal wins by default." },
  { icon: Scale, title: "Read blind, rule in code", body: "Validators fetch the wallet's history, code computes the hard numbers, and a model describes the behaviour in a fixed vocabulary. It never sees the rules. Code applies them, and every validator must reach the same outcome." },
];

export default function Home() {
  const stats = useAsync(getStats);
  const s = stats.data;
  // The newest REVEALED drop, read from the contract - never a hardcoded example.
  const drops = useAsync(() => getDrops());
  const shown = [...(drops.data?.drops ?? [])].reverse().find((d) => d.revealed && d.rules);
  return (
    <AppShell>
      <section className="grid items-center gap-10 py-6 lg:grid-cols-[1.1fr_1fr] lg:py-14">
        <div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="chip mb-5" style={{ color: "var(--coral)" }}>
            <ShieldCheck size={12} /> Sybil appeals on GenLayer
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="text-4xl font-bold leading-[1.05] text-sand sm:text-6xl">
            Hidden rules.<br />Locked in advance.<br /><span className="text-coral">Appealed in the open.</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            Every big airdrop flags real people as sybils, keeps its rules secret, and answers appeals with a form. FairDrop keeps the rules secret too - but seals them before the snapshot, and lets independent validators read a flagged wallet blind.
          </motion.p>
          <p className="mt-4 max-w-xl text-sm text-sand/80">
            The model never sees the rules. It describes the wallet&apos;s behaviour; contract code applies the rules that were committed before the snapshot.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/drops" className="btn btn-primary">Browse drops <ArrowRight size={16} /></Link>
            <Link href="/appeal" className="btn btn-coral">Appeal a flag</Link>
            <Link href="/docs" className="btn btn-ghost">How it works</Link>
          </div>
        </div>
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 }} className="card p-4 sm:p-6">
          {shown ? (
            <>
              <div className="label mb-3 flex items-center gap-2"><Lock size={12} /> On chain now: drop #{shown.drop_id}, sealed then revealed</div>
              <Seal hash={shown.rules_hash} rules={shown.rules} revealed playOnMount />
              <Link href={`/drop/${shown.drop_id}`} className="mt-3 inline-block text-xs text-coral underline">{shown.name}</Link>
            </>
          ) : (
            <div className="label flex items-center gap-2"><Lock size={12} /> {drops.loading ? "Reading the contract…" : "No drop has revealed its rules yet."}</div>
          )}
        </motion.div>
      </section>

      <section className="grid grid-cols-2 gap-3 py-6 sm:grid-cols-4">
        {[
          { k: "Drops", v: s?.drops ?? 0 },
          { k: "Appeals", v: s?.appeals ?? 0 },
          { k: "Human, cleared", v: s?.outcomes?.HUMAN_PATTERN ?? 0 },
          { k: "Read rounds", v: s?.reads ?? 0 },
        ].map((x) => (
          <div key={x.k} className="card p-4">
            <div className="display text-3xl font-bold text-sand"><CountUp value={x.v} /></div>
            <div className="label mt-1">{x.k}</div>
          </div>
        ))}
      </section>
      {s && (
        <p className="text-xs text-muted">
          Live from the contract. Books: {gen(s.ledger.balance_wei)} GEN held ={" "}
          {gen(s.ledger.locked_wei)} locked + {gen(s.ledger.payable_wei)} claimable
          {s.ledger.identity_holds ? " ✓" : " ✗"}.
        </p>
      )}

      <section className="py-12">
        <h2 className="mb-6 text-2xl font-bold text-sand sm:text-3xl">Four steps, none of them trust</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((st, i) => (
            <motion.div key={st.title} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.08 }} className="card p-5">
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-coral/15 text-coral"><st.icon size={20} /></div>
              <h3 className="font-semibold text-sand">{st.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{st.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 pb-8 md:grid-cols-2 xl:grid-cols-4">
        {[
          { c: "var(--human)", t: "HUMAN_PATTERN", b: "The appeal wins: the allocation is paid from the operator's escrowed reserve and the bond comes back." },
          { c: "var(--sybil)", t: "SYBIL_PATTERN", b: "The committed rules say so, given the findings. The bond goes to the reserve. Either side may contest once, with new evidence." },
          { c: "var(--insufficient)", t: "INSUFFICIENT_HISTORY", b: "The history could not be proven complete back to the lookback start. It never condemns: bond returned, refile allowed." },
          { c: "var(--pending)", t: "UNRESOLVED", b: "Three read rounds never settled - the validators could not agree on the outcome. It never pays and never condemns: bond returned, refile allowed." },
        ].map((o) => (
          <div key={o.t} className="card p-5" style={{ borderColor: o.c }}>
            <div className="mono text-sm font-bold" style={{ color: o.c }}>{o.t}</div>
            <p className="mt-2 text-sm text-muted">{o.b}</p>
          </div>
        ))}
      </section>
    </AppShell>
  );
}
