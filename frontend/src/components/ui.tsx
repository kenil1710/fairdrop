"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { OUTCOME_COLOR, gen, short } from "@/lib/fairdrop";

/** A number that counts up once it scrolls into view. */
export function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const c = animate(0, value, { duration: 1.2, ease: "easeOut", onUpdate: (v) => setShown(v) });
    return () => c.stop();
  }, [inView, value]);
  return <span ref={ref}>{shown.toFixed(decimals)}{suffix}</span>;
}

/** A hash or address in mono, truncated, with copy. */
export function Hash({ value, n = 6, full = false }: { value: string; n?: number; full?: boolean }) {
  const [done, setDone] = useState(false);
  if (!value) return <span className="mono text-muted">—</span>;
  return (
    <button
      type="button"
      title={value}
      onClick={() => { void navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }}
      className="mono inline-flex max-w-full items-center gap-1 break-all text-left text-[0.8rem] text-sand/90 hover:text-sand"
    >
      <span className={full ? "break-all" : ""}>{full ? value : short(value, n)}</span>
      {done ? <Check size={12} className="shrink-0 text-human" /> : <Copy size={12} className="shrink-0 opacity-50" />}
    </button>
  );
}

export function OutcomeBadge({ outcome, status }: { outcome: string; status?: string }) {
  const label = outcome ? outcome.replace("_", " ") : status === "FILED" ? "AWAITING READ" : status === "READ" ? "READ · SEALED RULES" : "PENDING";
  const color = OUTCOME_COLOR[outcome] ?? OUTCOME_COLOR[""];
  return (
    <span className="chip" style={{ color }}>
      {label}{status === "PROVISIONAL" ? " · provisional" : ""}
    </span>
  );
}

export function ReserveBar({ initial, current, paid, winners, alloc }: { initial: string; current: string; paid: string; winners: number; alloc: string }) {
  const base = BigInt(initial || "0");
  const cur = BigInt(current || "0");
  const want = BigInt(alloc || "0") * BigInt(winners);
  const denom = base > 0n ? base : 1n;
  const pct = (x: bigint) => Math.min(100, Number((x * 10000n) / denom) / 100);
  const claimed = BigInt(paid || "0");
  return (
    <div>
      <div className="relative h-3 overflow-hidden rounded-full bg-[var(--bg-2)] ring-1 ring-[var(--line)]">
        <motion.div className="absolute inset-y-0 left-0 rounded-full bg-sand/80" initial={{ width: 0 }} animate={{ width: `${pct(cur > 0n ? cur : claimed)}%` }} transition={{ duration: 1 }} />
        {want > 0n && (
          <div className="absolute inset-y-0 border-r-2 border-coral" style={{ left: `${pct(want)}%` }} title="owed to winners at full allocation" />
        )}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted">
        <span>reserve <b className="text-sand">{gen(cur > 0n ? cur : claimed)}</b> / {gen(base)} GEN</span>
        <span>{winners} winner{winners === 1 ? "" : "s"} × {gen(alloc)} GEN{want > base ? " → pro-rata" : ""}</span>
      </div>
    </div>
  );
}

export function Section({ title, icon, children, right }: { title: string; icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-sand">{icon}{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Loading({ what = "Reading the contract" }: { what?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-muted">
      <motion.span className="h-2 w-2 rounded-full bg-coral" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.2 }} />
      {what}…
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const text = error instanceof Error ? error.message : String(error);
  return <div className="card-2 border-sybil/40 p-4 text-sm text-sybil">Could not read the contract: {text.slice(0, 200)}</div>;
}
