/**
 * Typed access to FairDrop.
 *
 * FairDrop's views return JSON STRINGS (json.dumps), so every read is parsed
 * here. No write ever throws on chain: a refused call returns
 * {status: "REJECTED", reason} and the value it carried stays claimable, so
 * the UI reads `status` rather than catching.
 */
import { CANONICAL_ADDRESS, CONTRACT_ADDRESS, REGISTRY_ADDRESS, getReadClient, getWalletClient } from "./genlayer";
import type { Appeal, Config, Drop, Stats, WriteResult } from "./fairdrop";

export type TransactionHash = `0x${string}`;
const READ_TIMEOUT_MS = 30_000;

export async function read<T>(method: string, args: unknown[] = [], address: string = CONTRACT_ADDRESS): Promise<T> {
  const result = await Promise.race([
    getReadClient().readContract({ address: address as `0x${string}`, functionName: method, args: args as never }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${method} timed out`)), READ_TIMEOUT_MS)),
  ]);
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as T;
    } catch {
      return result as unknown as T;
    }
  }
  return result as T;
}

export const getConfig = (address?: string) => read<Config>("get_config", [], address);
export const getStats = (address?: string) => read<Stats>("get_stats", [], address);
export const getDrops = (address?: string) =>
  read<{ total: number; drops: Drop[] }>("get_drops", [0, 50], address);
export const getDrop = (id: number) => read<{ found: boolean; drop: Drop }>("get_drop", [id]);
export const getAppeals = (dropId: number) =>
  read<{ appeals: Appeal[] }>("get_appeals", [dropId]);
export const getAppeal = (id: number) => read<{ found: boolean; appeal: Appeal }>("get_appeal", [id]);
export const getPrompt = (id: number) =>
  read<{ found: boolean; read_prompt: string; contest_prompt: string }>("get_prompt", [id]);
export const verifyAppeal = (id: number) =>
  read<{ found: boolean; verified: boolean; checks: { check: string; ok: boolean }[] }>("verify_appeal", [id]);
export const checkProof = (dropId: number, wallet: string, proof: string) =>
  read<{ ok: boolean; reason: string }>("check_proof", [dropId, wallet, proof]);
/** The whole published flagged list, read page by page from the chain. */
export async function getFlaggedList(dropId: number) {
  const out: string[] = [];
  let root = "";
  for (let offset = 0; ; offset += 500) {
    const page = await read<{ total: number; final: boolean; flagged_root: string; wallets: string[] }>("get_flagged", [dropId, offset, 500]);
    root = page.flagged_root;
    out.push(...page.wallets);
    if (!page.wallets.length || out.length >= page.total) return { wallets: out, root, final: page.final, total: page.total };
  }
}
export const payoutOf = (address: string) =>
  read<{ owed_wei: string; owed_gen: string }>("payout_of", [address]);
export const appealsByWallet = (wallet: string) =>
  read<{ appeal_ids: number[] }>("get_appeals_by_wallet", [wallet]);
export const registryIsCleared = async (wallet: string, dropId: number) =>
  REGISTRY_ADDRESS ? Boolean(await read<boolean>("is_cleared", [wallet, dropId], REGISTRY_ADDRESS)) : null;
export const canonicalConfig = () => (CANONICAL_ADDRESS ? getConfig(CANONICAL_ADDRESS) : Promise.resolve(null));

async function estimateFees(
  client: ReturnType<typeof getWalletClient>,
  params: { address: `0x${string}`; functionName: string; args: unknown[]; value: bigint },
) {
  try {
    const est = await client.estimateTransactionFeesForWrite({
      address: params.address,
      functionName: params.functionName,
      args: params.args as never,
      value: params.value,
    });
    if (!est?.distribution) return undefined;
    return {
      distribution: est.distribution,
      ...(est.messageAllocations ? { messageAllocations: est.messageAllocations } : {}),
      feeValue: est.feeValue,
    };
  } catch {
    return undefined;
  }
}

export async function write(
  account: `0x${string}`,
  functionName: string,
  args: unknown[] = [],
  value: bigint = 0n,
): Promise<TransactionHash> {
  const client = getWalletClient(account);
  const fees = await estimateFees(client, { address: CONTRACT_ADDRESS, functionName, args, value });
  return (await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as never,
    value,
    ...(fees ? { fees } : {}),
  })) as TransactionHash;
}

const STATUS_NAMES = ["UNINITIALIZED", "PENDING", "PROPOSING", "COMMITTING", "REVEALING", "ACCEPTED",
  "UNDETERMINED", "FINALIZED", "CANCELED", "APPEAL_REVEALING", "APPEAL_COMMITTING", "READY_TO_FINALIZE",
  "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT"];
const statusName = (s: unknown) => (typeof s === "number" ? STATUS_NAMES[s] ?? String(s) : String(s ?? ""));

/**
 * Wait for a write to be DECIDED and return what the contract returned.
 *
 * Polls the transaction itself rather than `waitForTransactionReceipt({status:
 * "ACCEPTED"})`: that call waits for the exact status ACCEPTED, and Studio can
 * move a transaction to FINALIZED between two polls - the button then waited
 * for ten minutes on a write that had long succeeded (found by the headless
 * lifecycle walk, tools/ui_walk.mjs). ACCEPTED and FINALIZED both count; an
 * UNDETERMINED or CANCELED round is reported as such, never as success.
 */
export async function waitForResult(hash: TransactionHash): Promise<WriteResult> {
  let receipt: Record<string, unknown> | null = null;
  for (let i = 0; i < 200 && !receipt; i++) {
    try {
      const tx = (await getReadClient().getTransaction({ hash: hash as never })) as unknown as Record<string, unknown>;
      const name = statusName(tx?.statusName ?? tx?.status);
      if (name === "ACCEPTED" || name === "FINALIZED") receipt = tx;
      else if (name === "UNDETERMINED" || name === "CANCELED")
        return { status: "REJECTED", reason: `The validators did not reach consensus (${name}); nothing changed. Try again.` };
    } catch {
      /* not visible yet, or the relay had a bad second */
    }
    if (!receipt) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!receipt) return { status: "REJECTED", reason: "No decision after 10 minutes; check the transaction and try again." };
  const consensus = receipt?.consensus_data as { leader_receipt?: Array<Record<string, unknown>> } | undefined;
  const payload = (consensus?.leader_receipt?.[0]?.result as { payload?: unknown } | undefined)?.payload;
  if (payload && typeof payload === "object") {
    const readable = (payload as { readable?: string }).readable;
    if (typeof readable === "string") {
      for (const c of [readable, repairReadable(readable)]) {
        try {
          const parsed = JSON.parse(c);
          if (parsed && typeof parsed === "object") return parsed as WriteResult;
        } catch {
          /* next */
        }
      }
    }
  }
  if (typeof payload === "string" && payload) return { status: "REJECTED", reason: payload };
  return { status: "OK" };
}

/** genlayer-js 2.0.0-rc.1 drops the commas between map entries in `readable`. */
export function repairReadable(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      const prev = out.replace(/\s+$/, "").slice(-1);
      if (prev && !"{[,:".includes(prev)) out += ",";
      out += ch;
      inString = true;
      continue;
    }
    out += ch;
  }
  return out;
}
