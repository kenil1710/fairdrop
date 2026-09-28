/**
 * FairDrop domain model for the app: the fixed vocabulary, the canonical rules
 * JSON, the sha256 commitment and the flagged-list merkle tree - all matching
 * contracts/FairDrop.py byte for byte, and all computed IN THE BROWSER, so the
 * rules and the salt never leave the operator's machine before the reveal.
 */

export const DET_FINDINGS = [
  "WALLET_AGE_DAYS",
  "OUTBOUND_TX_COUNT",
  "DISTINCT_CONTRACTS_TOUCHED",
  "ACTIVE_DAYS",
] as const;

export const MODEL_FINDINGS = [
  "FIRST_FUNDER_IS_EXCHANGE_OR_BRIDGE",
  "SCRIPTED_REPETITION",
  "SINGLE_PURPOSE_FARMING",
  "ORGANIC_DIVERSITY",
] as const;

export const SCALES: Record<string, string[]> = {
  FIRST_FUNDER_IS_EXCHANGE_OR_BRIDGE: ["NO", "YES"],
  SCRIPTED_REPETITION: ["NONE", "SOME", "STRONG"],
  SINGLE_PURPOSE_FARMING: ["NONE", "SOME", "STRONG"],
  ORGANIC_DIVERSITY: ["LOW", "MEDIUM", "HIGH"],
};

export const FINDING_TEXT: Record<string, string> = {
  WALLET_AGE_DAYS: "Days from the wallet's first visible transaction to the snapshot",
  OUTBOUND_TX_COUNT: "Transactions the wallet sent inside the lookback window",
  DISTINCT_CONTRACTS_TOUCHED: "Different contracts it called inside the window",
  ACTIVE_DAYS: "Distinct UTC days with an outbound transaction",
  FIRST_FUNDER_IS_EXCHANGE_OR_BRIDGE: "Was the first funding sent by an exchange or a bridge?",
  SCRIPTED_REPETITION: "Near-identical transactions at regular intervals?",
  SINGLE_PURPOSE_FARMING: "Only the airdropped protocol, right before the snapshot?",
  ORGANIC_DIVERSITY: "Varied protocols, amounts and timing, like a normal user?",
};

export const CONDITIONS = ["LT", "LTE", "GT", "GTE", "EQ", "NEQ"] as const;
export const COND_SYMBOL: Record<string, string> = {
  LT: "<", LTE: "≤", GT: ">", GTE: "≥", EQ: "=", NEQ: "≠",
};

export type Rule = { finding: string; condition: string; threshold: number | string };
export type RulesDoc = { min_hits: number; rules: Rule[] };

export const isModelFinding = (f: string) => (MODEL_FINDINGS as readonly string[]).includes(f);

/** The exact string that is hashed. Keys sorted, no whitespace, rules in order. */
export function canonRules(doc: RulesDoc): string {
  const parts = doc.rules.map(
    (r) =>
      `{"condition":"${r.condition}","finding":"${r.finding}","threshold":${
        typeof r.threshold === "number" ? String(r.threshold) : `"${r.threshold}"`
      }}`,
  );
  return `{"min_hits":${doc.min_hits},"rules":[${parts.join(",")}]}`;
}

const hex = (buf: ArrayBuffer | Uint8Array) =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (h: string) => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
};

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export async function commitment(doc: RulesDoc, salt: string): Promise<string> {
  return hex(await sha256(new TextEncoder().encode(canonRules(doc) + salt)));
}

export function newSalt(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return hex(b);
}

function cmp(a: Uint8Array, b: Uint8Array) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Sorted-pair merkle tree. leaf = sha256(20 address bytes). */
export async function merkle(wallets: string[]) {
  const leaves = await Promise.all(wallets.map((w) => sha256(fromHex(w.toLowerCase()))));
  let level = leaves;
  const idx: Record<string, number> = {};
  const proofs: Record<string, string[]> = {};
  wallets.forEach((w, i) => {
    idx[w.toLowerCase()] = i;
    proofs[w.toLowerCase()] = [];
  });
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        const [a, b] = cmp(level[i], level[i + 1]) <= 0 ? [level[i], level[i + 1]] : [level[i + 1], level[i]];
        const joined = new Uint8Array(64);
        joined.set(a, 0);
        joined.set(b, 32);
        next.push(await sha256(joined));
      } else next.push(level[i]);
    }
    for (const w of Object.keys(idx)) {
      const sib = idx[w] ^ 1;
      if (sib < level.length) proofs[w].push(hex(level[sib]));
      idx[w] = Math.floor(idx[w] / 2);
    }
    level = next;
  }
  return {
    root: level.length ? hex(level[0]) : "",
    proofs: Object.fromEntries(Object.entries(proofs).map(([k, v]) => [k, v.join(",")])),
  };
}

/* --- formatting --------------------------------------------------------- */

export function gen(wei: string | number | bigint | undefined, digits = 3): string {
  if (wei === undefined || wei === null || wei === "") return "0";
  const n = BigInt(wei);
  const whole = n / 10n ** 18n;
  const frac = (n % 10n ** 18n).toString().padStart(18, "0").slice(0, digits).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export const toWei = (gen: string) => {
  const [w, f = ""] = gen.trim().split(".");
  return BigInt(w || "0") * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18) || "0");
};

export const short = (h: string, n = 6) => (h && h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

export function when(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function relative(ts: number, now = Math.floor(Date.now() / 1000)): string {
  const d = ts - now;
  const a = Math.abs(d);
  const unit = a < 90 ? `${a}s` : a < 5400 ? `${Math.round(a / 60)}m` : a < 172800 ? `${Math.round(a / 3600)}h` : `${Math.round(a / 86400)}d`;
  return d >= 0 ? `in ${unit}` : `${unit} ago`;
}

/* --- contract shapes ------------------------------------------------------ */

export type Drop = {
  drop_id: number; operator: string; name: string; chain: string; protocol: string;
  protocol_contracts: string[]; phase: string; created_at: number; snapshot_ts: number;
  committed_before_snapshot_s: number; lookback_days: number; lookback_start: number;
  appeal_end_ts: number; reveal_end_ts: number; allocation_wei: string; bond_wei: string;
  contest_bond_wei: string; reserve_initial_wei: string; reserve_wei: string;
  held_bonds_wei: string; rules_hash: string; flagged_root: string; flagged_count: number;
  flagged_at: number; revealed: boolean; rules_json: string; salt: string;
  rules: RulesDoc | null; revealed_at: number; bad_reveals: number; appeals: number;
  open_appeals: number; winners: number; closed: boolean; closed_at: number;
  per_winner_wei: string; paid_winners_wei: string; leftover_wei: string; pro_rata: boolean;
};

export type TraceRow = {
  finding: string; condition: string; threshold: number | string; value: string;
  fired: boolean; note: string;
};
export type Trace = { hits: number; min_hits: number; rules: TraceRow[] };

export type Appeal = {
  appeal_id: number; drop_id: number; wallet: string; filer: string; on_behalf: boolean;
  statement: string; filed_at: number; bond_wei: string; status: string; outcome: string;
  decided_by: string; refile_of: number; read_attempts: number; read_at: number;
  last_read_status: string; snapshot: string; snapshot_hash: string;
  features: Record<string, string>; findings: Record<string, string>; decided_at: number;
  provisional_outcome: string; contest_until: number; contested: boolean; contester: string;
  contest_bond_wei: string; contest_evidence: string; contest_findings: Record<string, string>;
  contest_at: number; final_at: number; payout_wei: string; in_flight: boolean;
  rounds_opened: number; unsettled_rounds: number; round_open_at: number;
  trace: Trace | null; contest_trace: Trace | null;
};

export type Config = {
  rubric_version: string; mode: "DEMO" | "CANONICAL"; mode_note: string; owner: string;
  paused: boolean; contest_window_s: number; stall_ttl_s: number; min_phase_s: number;
  round_ttl_s: number; max_unsettled_rounds: number;
  chains: string[]; max_appeals_per_drop: number;
};

export type Stats = {
  drops: number; appeals: number; reads: number; contests: number; rejected_calls: number;
  outcomes: Record<string, number>;
  ledger: { balance_wei: string; locked_wei: string; payable_wei: string; identity_holds: boolean };
  on_chain_balance_wei: string; undelivered_wei: string;
  totals: Record<string, string>;
};

export type WriteResult = { status: "OK" | "REJECTED"; reason?: string; [k: string]: unknown };

export const OUTCOME_COLOR: Record<string, string> = {
  HUMAN_PATTERN: "var(--human)",
  SYBIL_PATTERN: "var(--sybil)",
  INSUFFICIENT_HISTORY: "var(--insufficient)",
  UNRESOLVED: "var(--pending)",
  "": "var(--pending)",
};

export const PHASE_LABEL: Record<string, string> = {
  BEFORE_SNAPSHOT: "Before snapshot",
  AWAITING_FLAGGED_LIST: "Awaiting flagged list",
  APPEALS_OPEN: "Appeals open",
  REVEAL_WINDOW: "Reveal window",
  REVEAL_MISSED: "Reveal missed",
  SETTLING: "Settling",
  CLOSED: "Closed",
  VOID: "Void",
};
