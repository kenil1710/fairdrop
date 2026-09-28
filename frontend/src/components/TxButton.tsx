"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { waitForResult, type TransactionHash } from "@/lib/contract";
import type { WriteResult } from "@/lib/fairdrop";
import { useWallet } from "./WalletProvider";

type State = "idle" | "signing" | "waiting" | "ok" | "rejected" | "error";

/** A write from click to outcome. A contract REFUSAL is not an error: FairDrop
 *  never reverts, it returns {status: "REJECTED", reason}, shown verbatim. */
export function TxButton({ label, icon, disabled, className = "btn btn-primary", send, onDone }: {
  label: string; icon?: ReactNode; disabled?: boolean; className?: string;
  send: (account: `0x${string}`) => Promise<TransactionHash>;
  onDone?: (r: WriteResult) => void;
}) {
  const { account, onRightNetwork, connect, switchNetwork } = useWallet();
  const [state, setState] = useState<State>("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    if (!account) return void connect();
    if (!onRightNetwork) return void switchNetwork();
    setState("signing");
    setMsg("");
    try {
      const hash = await send(account);
      setState("waiting");
      const r = await waitForResult(hash);
      setState(r.status === "REJECTED" ? "rejected" : "ok");
      setMsg(r.status === "REJECTED" ? String(r.reason ?? "refused") : "");
      onDone?.(r);
    } catch (e) {
      const t = e instanceof Error ? e.message : String(e);
      setState("error");
      setMsg(/user rejected|denied/i.test(t) ? "Cancelled in the wallet." : t.slice(0, 200));
    }
  }

  const busy = state === "signing" || state === "waiting";
  return (
    <div className="flex flex-col gap-2">
      <button type="button" className={className} disabled={disabled || busy} onClick={() => void run()}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : icon}
        {!account ? "Connect wallet" : !onRightNetwork ? "Switch network" : state === "signing" ? "Confirm in wallet…" : state === "waiting" ? "Waiting for consensus…" : label}
      </button>
      {state === "ok" && <span className="flex items-center gap-1 text-xs text-human"><CheckCircle2 size={14} /> Done</span>}
      {(state === "rejected" || state === "error") && (
        <span className="flex items-start gap-1 text-xs text-sybil"><XCircle size={14} className="mt-0.5 shrink-0" /> {msg}</span>
      )}
    </div>
  );
}
