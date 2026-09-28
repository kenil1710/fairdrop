"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Hash as HashIcon, Lock, Unlock } from "lucide-react";
import { useEffect, useState } from "react";
import { COND_SYMBOL, type RulesDoc, isModelFinding } from "@/lib/fairdrop";

/**
 * The sealed rules. While sealed: a lock over the commitment hash. On reveal:
 * the lock springs open and the rules unfold line by line - the one animation
 * in the app that carries meaning, because it is the moment the drop's
 * promise is checked.
 */
export function Seal({ hash, rules, revealed, playOnMount = true }: {
  hash: string; rules: RulesDoc | null; revealed: boolean; playOnMount?: boolean;
}) {
  const [open, setOpen] = useState(!playOnMount && revealed);
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setOpen(true), playOnMount ? 700 : 0);
    return () => clearTimeout(t);
  }, [revealed, playOnMount]);

  return (
    <div className="card-2 relative overflow-hidden p-5">
      <div className="flex items-center gap-4">
        <motion.div
          className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl"
          animate={{ backgroundColor: open ? "rgba(61,220,151,0.12)" : "rgba(255,111,97,0.12)", rotate: open ? [0, -12, 8, 0] : 0 }}
          transition={{ duration: 0.6 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {open ? (
              <motion.span key="u" initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}>
                <Unlock className="text-human" size={26} />
              </motion.span>
            ) : (
              <motion.span key="l" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }}>
                <Lock className="text-coral" size={26} />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
        <div className="min-w-0">
          <div className="label flex items-center gap-1"><HashIcon size={12} /> {open ? "Revealed — matches the commitment" : "Sealed commitment · sha256(rules + salt)"}</div>
          <div className="mono mt-1 break-all text-[0.78rem] text-sand/90">{hash}</div>
        </div>
      </div>
      <AnimatePresence>
        {open && rules && (
          <motion.ol initial={{ height: 0 }} animate={{ height: "auto" }} className="mt-4 space-y-2 overflow-hidden">
            {rules.rules.map((r, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + i * 0.15 }}
                className="mono flex flex-wrap items-center gap-2 rounded-lg bg-[var(--bg-2)] px-3 py-2 text-xs"
              >
                <span className="text-muted">{String(i + 1).padStart(2, "0")}</span>
                <span className={isModelFinding(r.finding) ? "text-coral" : "text-sand"}>{r.finding}</span>
                <span className="text-muted">{COND_SYMBOL[r.condition] ?? r.condition}</span>
                <span className="text-sand">{String(r.threshold)}</span>
              </motion.li>
            ))}
            <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + rules.rules.length * 0.15 }} className="px-1 pt-1 text-xs text-muted">
              SYBIL_PATTERN only if at least <b className="text-sand">{rules.min_hits}</b> of {rules.rules.length} rules fire. A rule on an UNCLEAR model finding never fires.
            </motion.li>
          </motion.ol>
        )}
      </AnimatePresence>
      {!revealed && (
        <p className="mt-4 text-xs text-muted">The rules stay secret until the reveal phase. Anyone can check the reveal against this hash; a mismatch is refused, and a missed reveal wins every pending appeal.</p>
      )}
    </div>
  );
}
