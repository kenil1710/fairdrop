"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Eye, FileSearch, Fingerprint, Gavel, Scale, ShieldCheck, XCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Findings } from "@/components/Findings";
import { Seal } from "@/components/Seal";
import { TxButton } from "@/components/TxButton";
import { ErrorNote, Hash, Loading, OutcomeBadge, Section } from "@/components/ui";
import { useAsync, useNow } from "@/components/useAsync";
import { getAppeal, getDrop, getPrompt, verifyAppeal, write } from "@/lib/contract";
import { COND_SYMBOL, OUTCOME_COLOR, gen, relative, when, type Trace } from "@/lib/fairdrop";

function TraceTable({ trace, title }: { trace: Trace; title: string }) {
  return (
    <div>
      <div className="label mb-2">{title}</div>
      <ol className="space-y-2">
        {trace.rules.map((r, i) => (
          <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 * i }}
            className="card-2 grid grid-cols-[auto_1fr_auto] items-center gap-3 p-3">
            <span className="mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
            <div className="min-w-0">
              <div className="mono truncate text-xs text-sand">{r.finding} {COND_SYMBOL[r.condition]} {String(r.threshold)}</div>
              <div className="mono text-[0.7rem] text-muted">found: <span className="text-sand">{r.value}</span>{r.note ? ` · ${r.note}` : ""}</div>
            </div>
            <span className="chip" style={{ color: r.fired ? "var(--sybil)" : "var(--human)" }}>{r.fired ? "fires" : "no"}</span>
          </motion.li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-muted">
        <b className="text-sand">{trace.hits}</b> of {trace.rules.length} rules fired; SYBIL_PATTERN needs at least <b className="text-sand">{trace.min_hits}</b>.
        Result: <b style={{ color: trace.hits >= trace.min_hits ? "var(--sybil)" : "var(--human)" }}>{trace.hits >= trace.min_hits ? "SYBIL_PATTERN" : "HUMAN_PATTERN"}</b>
      </p>
    </div>
  );
}

export default function AppealDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id ?? 0);
  const ap = useAsync(() => getAppeal(id), [id]);
  const a = ap.data?.appeal;
  const dr = useAsync(async () => (a ? getDrop(a.drop_id) : null), [a?.drop_id]);
  const d = dr.data?.drop;
  const verify = useAsync(() => verifyAppeal(id), [id, a?.status]);
  const [showPrompt, setShowPrompt] = useState(false);
  const prompt = useAsync(async () => (showPrompt ? getPrompt(id) : null), [showPrompt, id]);
  const [evidence, setEvidence] = useState("");
  const now = useNow();
  const reload = () => { void ap.reload(); void dr.reload(); void verify.reload(); };

  return (
    <AppShell>
      {ap.loading && <Loading />}
      {ap.error ? <ErrorNote error={ap.error} /> : null}
      {ap.data && !ap.data.found && <p className="text-muted">No appeal #{id}.</p>}
      {a && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="label"><Link className="underline" href={`/drop/${a.drop_id}`}>Drop #{a.drop_id}</Link> · appeal #{a.appeal_id}{a.refile_of ? ` · refile of #${a.refile_of}` : ""}</div>
              <h1 className="mono mt-1 break-all text-xl font-bold text-sand sm:text-2xl">{a.wallet}</h1>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                filed {when(a.filed_at)} · bond {gen(a.bond_wei)} GEN
                {a.on_behalf && <span className="chip" style={{ color: "var(--pending)" }}>DEMO · filed on behalf by the operator</span>}
              </div>
            </div>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-right">
              <div className="display text-2xl font-bold sm:text-3xl" style={{ color: OUTCOME_COLOR[a.outcome] ?? "var(--pending)" }}>
                {a.outcome || (a.status === "FILED" ? "AWAITING READ" : "READ · RULES SEALED")}
              </div>
              <div className="mt-1 flex justify-end gap-2"><OutcomeBadge outcome={a.outcome} status={a.status} /><span className="chip" style={{ color: "var(--sand-dim)" }}>{a.decided_by || a.status}</span></div>
            </motion.div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="The blind read" icon={<Fingerprint size={18} className="text-coral" />}>
              {a.snapshot_hash ? (
                <>
                  <Findings features={a.features} findings={a.findings} />
                  <div className="mt-4 text-xs text-muted">Snapshot sha256 <Hash value={a.snapshot_hash} /> · read {when(a.read_at)} after {a.read_attempts} attempt{a.read_attempts === 1 ? "" : "s"}</div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-coral">The exact history the validators fetched and agreed on</summary>
                    <pre className="snapshot mono mt-2 max-h-72 overflow-auto rounded-lg bg-[var(--bg-2)] p-3 text-[0.7rem] text-sand/80">{a.snapshot}</pre>
                  </details>
                </>
              ) : a.outcome === "INSUFFICIENT_HISTORY" ? (
                <p className="text-sm text-muted">The history could not be proven complete back to the lookback start, so nothing was read and nothing was decided against this wallet. The bond was returned; the wallet may refile until the reveal deadline.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted">Not read yet{a.last_read_status ? ` (last attempt: ${a.last_read_status})` : ""}. Anyone may trigger the read: every validator fetches the wallet&apos;s outbound history itself and they must agree on all of it.</p>
                  <TxButton label="Run the blind read" icon={<FileSearch size={16} />} send={(acct) => write(acct, "read_wallet", [a.appeal_id])} onDone={reload} />
                </div>
              )}
              {a.snapshot_hash && (
                <button type="button" className="btn btn-ghost mt-4 !py-1.5 text-xs" onClick={() => setShowPrompt(!showPrompt)}>
                  <Eye size={14} /> {showPrompt ? "Hide" : "Show"} the exact prompt the model saw
                </button>
              )}
              {showPrompt && prompt.data && (
                <pre className="snapshot mono mt-2 max-h-80 overflow-auto rounded-lg bg-[var(--bg-2)] p-3 text-[0.68rem] text-sand/80">{prompt.data.read_prompt}{prompt.data.contest_prompt ? `\n\n--- contest re-read ---\n${prompt.data.contest_prompt}` : ""}</pre>
              )}
            </Section>

            <Section title="The rules, applied by code" icon={<Scale size={18} className="text-sand" />}>
              {d && <Seal hash={d.rules_hash} rules={d.rules} revealed={d.revealed} playOnMount={false} />}
              <div className="mt-4">
                {a.trace ? (
                  <TraceTable trace={a.trace} title={a.contested ? "Original reading" : "Line by line"} />
                ) : a.decided_by === "NO_REVEAL" ? (
                  <p className="text-sm text-human">The operator never revealed its rules before the deadline, so this appeal was won by default. Operator failure cannot hurt a user.</p>
                ) : (
                  <p className="text-sm text-muted">Waiting for the reveal. The findings are already fixed on chain; the rules will be applied to them exactly as committed.</p>
                )}
                {a.contest_trace && <div className="mt-5"><TraceTable trace={a.contest_trace} title="After the contest re-read (same stored snapshot)" /></div>}
              </div>
              {a.status === "READ" && d && (d.revealed || now >= d.reveal_end_ts) && (
                <div className="mt-4"><TxButton label="Apply the rules" icon={<Gavel size={16} />} send={(acct) => write(acct, "decide", [a.appeal_id])} onDone={reload} /></div>
              )}
              {a.status === "FILED" && d && !d.revealed && now >= d.reveal_end_ts && (
                <div className="mt-4"><TxButton label="Claim default win (no reveal)" icon={<Gavel size={16} />} send={(acct) => write(acct, "decide", [a.appeal_id])} onDone={reload} /></div>
              )}
            </Section>
          </div>

          {a.status === "PROVISIONAL" && d && (
            <Section title="Contest" icon={<Gavel size={18} className="text-coral" />} right={<span className="text-xs text-muted">window closes {relative(a.contest_until)}</span>}>
              <p className="text-sm text-muted">
                Provisional for {a.contest_until - a.decided_at >= 3600 ? `${Math.round((a.contest_until - a.decided_at) / 3600)} hours` : `${Math.round((a.contest_until - a.decided_at) / 60)} minutes`}. The losing side —{" "}
                <b className="text-sand">{a.outcome === "HUMAN_PATTERN" ? "the operator" : "the appellant"}</b> — may contest once with a {gen(d.contest_bond_wei, 4)} GEN bond and NEW evidence. The contest re-reads the same stored snapshot. Describe the wallet only: the text may not name the rule vocabulary, the rules, or frame the case (flagged, sybil, airdrop, appeal).
              </p>
              <textarea className="input mt-3 min-h-24" maxLength={1000} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="New evidence - something the appeal statement did not already say." />
              <div className="mt-3 flex flex-wrap gap-3">
                <TxButton label="Contest with bond" className="btn btn-coral" disabled={evidence.trim().length < 20} send={(acct) => write(acct, "contest", [a.appeal_id, evidence], BigInt(d.contest_bond_wei))} onDone={reload} />
                <TxButton label="Finalize (after window)" className="btn btn-ghost" disabled={now < a.contest_until} send={(acct) => write(acct, "finalize_appeal", [a.appeal_id])} onDone={reload} />
              </div>
            </Section>
          )}
          {a.contested && (
            <Section title="Contest record" icon={<Gavel size={18} className="text-coral" />}>
              <div className="text-sm text-muted">By <Hash value={a.contester} /> on {when(a.contest_at)} with a {gen(a.contest_bond_wei, 4)} GEN bond. Provisional {a.provisional_outcome} → final <b style={{ color: OUTCOME_COLOR[a.outcome] }}>{a.outcome}</b>.</div>
              <blockquote className="mt-3 border-l-2 border-coral pl-3 text-sm text-sand/90">{a.contest_evidence}</blockquote>
              <div className="mt-4"><Findings features={a.features} findings={a.contest_findings} label="Findings on the contest re-read" /></div>
            </Section>
          )}

          <Section title="Verify from storage" icon={<ShieldCheck size={18} className="text-human" />}>
            {verify.data?.checks?.length ? (
              <ul className="space-y-1.5 text-sm">
                {verify.data.checks.map((c) => (
                  <li key={c.check} className="flex items-start gap-2">
                    {c.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-human" /> : <XCircle size={16} className="mt-0.5 shrink-0 text-sybil" />}
                    <span className="text-sand/90">{c.check}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Nothing to verify yet.</p>}
            {a.status === "FINAL" && a.outcome === "HUMAN_PATTERN" && (
              <p className="mt-3 text-sm text-human">Cleared. {a.payout_wei !== "0" ? `Paid ${gen(a.payout_wei, 4)} GEN at close.` : "The allocation is paid when the drop closes."} Distributors can check <span className="mono">is_cleared(wallet, {a.drop_id})</span>.</p>
            )}
            {a.in_flight && (
              <div className="mt-3"><TxButton label="Settle a stalled round" className="btn btn-ghost" send={(acct) => write(acct, "settle_stalled", [a.appeal_id])} onDone={reload} /></div>
            )}
          </Section>
          {a.statement && <p className="text-xs text-muted">Appellant&apos;s statement (the model never reads it): “{a.statement}”</p>}
        </div>
      )}
    </AppShell>
  );
}
