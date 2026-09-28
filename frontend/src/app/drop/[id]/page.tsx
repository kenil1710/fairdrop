"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { CalendarClock, Coins, Hash as HashIcon, Lock, Scale, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Seal } from "@/components/Seal";
import { TxButton } from "@/components/TxButton";
import { ErrorNote, Hash, Loading, OutcomeBadge, ReserveBar, Section } from "@/components/ui";
import { useAsync, useNow } from "@/components/useAsync";
import { getAppeals, getDrop, write } from "@/lib/contract";
import { PHASE_LABEL, gen, relative, when } from "@/lib/fairdrop";

export default function DropPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id ?? 0);
  const drop = useAsync(() => getDrop(id), [id]);
  const appeals = useAsync(() => getAppeals(id), [id]);
  const d = drop.data?.drop;
  const list = appeals.data?.appeals ?? [];
  const now = useNow();

  return (
    <AppShell>
      {drop.loading && <Loading />}
      {drop.error ? <ErrorNote error={drop.error} /> : null}
      {drop.data && !drop.data.found && <p className="text-muted">No drop #{id}.</p>}
      {d && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="label">Drop #{d.drop_id} · {d.chain} · {d.protocol}</div>
              <h1 className="mt-1 break-words text-3xl font-bold text-sand">{d.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">operator <Hash value={d.operator} /></div>
            </div>
            <span className="chip" style={{ color: "var(--pending)" }}>{PHASE_LABEL[d.phase] ?? d.phase}</span>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
            <Section title="The rules" icon={<Lock size={18} className="text-coral" />}>
              <Seal hash={d.rules_hash} rules={d.rules} revealed={d.revealed} />
              <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
                <div>Sealed <b className="text-sand">{when(d.created_at)}</b></div>
                <div>Snapshot <b className="text-sand">{when(d.snapshot_ts)}</b></div>
                <div className="sm:col-span-2 text-human">Commitment is {Math.round(d.committed_before_snapshot_s / 60)} minutes older than the snapshot — enforced by the contract.</div>
                {d.bad_reveals > 0 && <div className="sm:col-span-2 text-sybil">{d.bad_reveals} reveal attempt{d.bad_reveals > 1 ? "s" : ""} refused: the text did not hash to the commitment.</div>}
                {d.revealed && <div className="sm:col-span-2">salt <span className="mono break-all text-sand/80">{d.salt}</span></div>}
              </div>
            </Section>

            <div className="space-y-5">
              <Section title="Reserve" icon={<Coins size={18} className="text-sand" />}>
                <ReserveBar initial={d.reserve_initial_wei} current={d.reserve_wei} paid={d.paid_winners_wei} winners={d.winners} alloc={d.allocation_wei} />
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="label">Allocation</dt><dd className="text-sand">{gen(d.allocation_wei)} GEN</dd></div>
                  <div><dt className="label">Appeal bond</dt><dd className="text-sand">{gen(d.bond_wei)} GEN</dd></div>
                  <div><dt className="label">Contest bond (5%)</dt><dd className="text-sand">{gen(d.contest_bond_wei, 4)} GEN</dd></div>
                  <div><dt className="label">Bonds held</dt><dd className="text-sand">{gen(d.held_bonds_wei)} GEN</dd></div>
                  {d.closed && (
                    <>
                      <div><dt className="label">Per winner</dt><dd className="text-human">{gen(d.per_winner_wei, 4)} GEN{d.pro_rata ? " (pro-rata)" : ""}</dd></div>
                      <div><dt className="label">Leftover → operator</dt><dd className="text-sand">{gen(d.leftover_wei, 4)} GEN</dd></div>
                    </>
                  )}
                </dl>
                {!d.closed && (
                  <div className="mt-4">
                    <TxButton
                      label="Close drop and pay out"
                      className="btn btn-ghost w-full"
                      disabled={now < d.reveal_end_ts && d.phase !== "VOID"}
                      send={(acct) => write(acct, "close_drop", [d.drop_id])}
                      onDone={() => { void drop.reload(); void appeals.reload(); }}
                    />
                    <p className="mt-2 text-xs text-muted">Permissionless. Only after the reveal deadline and once every appeal is final; the reserve cannot leave earlier.</p>
                  </div>
                )}
              </Section>

              <Section title="Timeline" icon={<CalendarClock size={18} className="text-sand" />}>
                <ol className="space-y-2 text-sm">
                  {[
                    ["Rules sealed", d.created_at],
                    ["Snapshot", d.snapshot_ts],
                    ["Flagged list committed", d.flagged_at],
                    ["Appeals close", d.appeal_end_ts],
                    ["Reveal deadline", d.reveal_end_ts],
                    ["Closed", d.closed_at],
                  ].map(([k, t]) => (
                    <li key={String(k)} className="flex justify-between gap-3">
                      <span className={Number(t) && Number(t) <= now ? "text-sand" : "text-muted"}>{k}</span>
                      <span className="text-right text-xs text-muted">{Number(t) ? `${when(Number(t))} · ${relative(Number(t))}` : "—"}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-3 text-xs text-muted">
                  Lookback from {when(d.lookback_start)} ({d.lookback_days} days). Flagged root <Hash value={d.flagged_root} /> ({d.flagged_count} wallets).
                </div>
              </Section>
            </div>
          </div>

          <Section title={`Appeals (${list.length})`} icon={<Users size={18} className="text-sand" />} right={<Link className="btn btn-coral !py-1.5 text-sm" href={`/appeal?drop=${d.drop_id}`}><Scale size={14} /> Appeal</Link>}>
            {appeals.loading && <Loading what="Reading appeals" />}
            {list.length === 0 && !appeals.loading && <p className="text-sm text-muted">No appeals yet.</p>}
            <ul className="divide-y divide-[var(--line)]">
              {list.map((a, i) => (
                <motion.li key={a.appeal_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}>
                  <Link href={`/appeal/${a.appeal_id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-[var(--card-2)]/40">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="mono text-xs text-muted">#{a.appeal_id}</span>
                      <span className="mono truncate text-sm text-sand">{a.wallet}</span>
                      {a.on_behalf && <span className="chip" style={{ color: "var(--pending)" }}>DEMO · on behalf</span>}
                      {a.refile_of > 0 && <span className="chip" style={{ color: "var(--sand-dim)" }}>refile of #{a.refile_of}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {a.contested && <span className="chip" style={{ color: "var(--coral)" }}>contested</span>}
                      <OutcomeBadge outcome={a.outcome} status={a.status} />
                    </div>
                  </Link>
                </motion.li>
              ))}
            </ul>
          </Section>
          <p className="flex items-center gap-1 text-xs text-muted"><HashIcon size={12} /> Every figure on this page is read live from the contract.</p>
        </div>
      )}
    </AppShell>
  );
}
