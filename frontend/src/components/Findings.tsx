"use client";

import { motion } from "framer-motion";
import { Cpu, Fingerprint } from "lucide-react";
import { DET_FINDINGS, FINDING_TEXT, MODEL_FINDINGS } from "@/lib/fairdrop";

const tone = (v: string) =>
  v === "UNCLEAR" ? "var(--insufficient)" : ["STRONG", "LOW", "NO"].includes(v) ? "var(--coral)" : ["NONE", "HIGH", "YES"].includes(v) ? "var(--human)" : "var(--pending)";

/** The blind findings, appearing one by one. */
export function Findings({ features, findings, label = "Blind findings" }: {
  features: Record<string, string>; findings: Record<string, string>; label?: string;
}) {
  const rows = [
    ...DET_FINDINGS.map((f) => ({ f, v: features[f], kind: "code" as const })),
    ...MODEL_FINDINGS.map((f) => ({ f, v: findings[f], kind: "model" as const })),
  ];
  return (
    <div>
      <div className="label mb-3">{label}</div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((r, i) => (
          <motion.li
            key={r.f}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 * i }}
            className="card-2 flex items-center justify-between gap-3 p-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[0.7rem] text-muted">
                {r.kind === "code" ? <Cpu size={12} /> : <Fingerprint size={12} />}
                {r.kind === "code" ? "computed in code" : "model description"}
              </div>
              <div className="mono truncate text-xs text-sand" title={FINDING_TEXT[r.f]}>{r.f}</div>
            </div>
            <span className="mono shrink-0 text-sm font-semibold" style={{ color: r.kind === "code" ? "var(--sand)" : tone(r.v ?? "") }}>
              {r.v ?? "—"}
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
