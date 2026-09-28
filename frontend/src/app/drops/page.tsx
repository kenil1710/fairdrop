"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Lock, Unlock, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ErrorNote, Hash, Loading } from "@/components/ui";
import { useAsync } from "@/components/useAsync";
import { getDrops } from "@/lib/contract";
import { PHASE_LABEL, gen, relative } from "@/lib/fairdrop";

export default function DropsPage() {
  const { data, error, loading } = useAsync(() => getDrops());
  const drops = [...(data?.drops ?? [])].reverse();
  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-sand">Drops</h1>
          <p className="mt-1 text-sm text-muted">Every drop, its sealed or revealed rules, its escrowed reserve and its open appeals.</p>
        </div>
        <Link href="/operator" className="btn btn-primary">Create a drop</Link>
      </div>
      {loading && <Loading />}
      {error ? <ErrorNote error={error} /> : null}
      {!loading && !error && drops.length === 0 && <p className="text-muted">No drops yet.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {drops.map((d, i) => (
          <motion.div key={d.drop_id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Link href={`/drop/${d.drop_id}`} className="card block p-5 transition hover:border-coral/60">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="label">Drop #{d.drop_id} · {d.chain}</div>
                  <h2 className="mt-1 truncate text-lg font-semibold text-sand">{d.name}</h2>
                </div>
                <span className="chip shrink-0" style={{ color: d.revealed ? "var(--human)" : "var(--coral)" }}>
                  {d.revealed ? <Unlock size={12} /> : <Lock size={12} />} {d.revealed ? "Revealed" : d.phase === "REVEAL_MISSED" ? "Never revealed" : "Sealed"}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div><div className="label">Operator</div><Hash value={d.operator} n={4} /></div>
                <div><div className="label">Reserve</div><span className="text-sand">{gen(d.closed ? d.reserve_initial_wei : d.reserve_wei)} GEN</span></div>
                <div><div className="label">Appeals open</div><span className="inline-flex items-center gap-1 text-sand"><Users size={13} />{d.open_appeals} / {d.appeals}</span></div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span className="chip" style={{ color: "var(--sand-dim)" }}>{PHASE_LABEL[d.phase] ?? d.phase}</span>
                <span>snapshot {relative(d.snapshot_ts)} · sealed {Math.round(d.committed_before_snapshot_s / 60)} min before it</span>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </AppShell>
  );
}
