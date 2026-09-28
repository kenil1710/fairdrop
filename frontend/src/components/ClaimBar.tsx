"use client";

import { Coins } from "lucide-react";
import { TxButton } from "./TxButton";
import { useWallet } from "./WalletProvider";
import { useAsync } from "./useAsync";
import { payoutOf, write } from "@/lib/contract";

/** Whatever the contract owes the connected wallet - bonds, allocations,
 *  leftover reserve - read from `payout_of` and pulled with `claim_payout`,
 *  the only method that transfers. Hidden when nothing is owed. */
export function ClaimBar() {
  const { account } = useWallet();
  const owed = useAsync(async () => (account ? payoutOf(account) : null), [account]);
  if (!account || !owed.data || owed.data.owed_wei === "0") return null;
  return (
    <div className="border-b border-[var(--line)] bg-[var(--bg-2)] px-4 py-2 text-sm" data-testid="claim-bar">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sand"><Coins size={14} /> The contract owes this wallet <b>{owed.data.owed_gen} GEN</b>.</span>
        <TxButton label="Claim payout" className="btn btn-primary !py-1.5" send={(acct) => write(acct, "claim_payout", [])} onDone={() => void owed.reload()} />
      </div>
    </div>
  );
}
