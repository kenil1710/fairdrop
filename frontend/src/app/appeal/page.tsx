"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Fingerprint, Scale, ShieldCheck, XCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useWallet } from "@/components/WalletProvider";
import { TxButton } from "@/components/TxButton";
import { ErrorNote, Loading, Section } from "@/components/ui";
import { useAsync } from "@/components/useAsync";
import { checkProof, getConfig, getDrops, getFlaggedList, write } from "@/lib/contract";
import { gen, merkle, type WriteResult } from "@/lib/fairdrop";

export default function AppealPage() {
  const { account } = useWallet();
  const drops = useAsync(() => getDrops());
  const cfg = useAsync(() => getConfig());
  const [dropId, setDropId] = useState<number>(0);
  const [wallet, setWallet] = useState("");
  const [proof, setProof] = useState("");
  const [statement, setStatement] = useState("");
  const [preview, setPreview] = useState<{ ok: boolean; reason: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [building, setBuilding] = useState(false);

  /** Build this wallet's proof from the flagged list PUBLISHED ON CHAIN, and
   *  check the rebuilt root against the contract's. No operator involved. */
  async function buildProof() {
    setBuilding(true);
    setPreview(null);
    try {
      const list = await getFlaggedList(dropId);
      if (!list.final) throw new Error("The operator has not published a final flagged list for this drop.");
      const tree = await merkle(list.wallets);
      if (tree.root !== list.root) throw new Error("The published list does not hash to the on-chain root.");
      const mine = tree.proofs[walletValue.trim().toLowerCase()];
      if (mine === undefined) {
        setProof("");
        setPreview({ ok: false, reason: `Not on the published flagged list (${list.total} wallets).` });
        return;
      }
      setProof(mine);
      setPreview(await checkProof(dropId, walletValue.trim(), mine));
    } catch (e) {
      setPreview({ ok: false, reason: e instanceof Error ? e.message : String(e) });
    } finally {
      setBuilding(false);
    }
  }
  const [filed, setFiled] = useState<number | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("drop");
    if (q) queueMicrotask(() => setDropId(Number(q)));
  }, []);
  const walletValue = wallet || account || "";

  const open = (drops.data?.drops ?? []).filter((d) => d.phase === "APPEALS_OPEN" || d.phase === "REVEAL_WINDOW");
  const d = (drops.data?.drops ?? []).find((x) => x.drop_id === dropId);
  const demo = cfg.data?.mode === "DEMO";
  const self = account && walletValue.toLowerCase() === account.toLowerCase();

  async function runPreview() {
    setChecking(true);
    try {
      setPreview(await checkProof(dropId, walletValue.trim(), proof.trim()));
    } catch (e) {
      setPreview({ ok: false, reason: e instanceof Error ? e.message : String(e) });
    } finally {
      setChecking(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-3xl font-bold text-sand">Appeal a flag</h1>
          <p className="mt-1 text-sm text-muted">Connect the flagged wallet itself. The appeal is sent from it, so nobody can appeal for a wallet they do not control and no identity binding is needed.</p>
        </div>
        {drops.loading && <Loading />}
        {drops.error ? <ErrorNote error={drops.error} /> : null}

        <Section title="1 · The drop and your wallet" icon={<Fingerprint size={18} className="text-coral" />}>
          <label className="label" htmlFor="drop">Drop</label>
          <select id="drop" className="input mt-1" value={dropId} onChange={(e) => { setDropId(Number(e.target.value)); setPreview(null); }}>
            <option value={0}>Choose a drop…</option>
            {(drops.data?.drops ?? []).map((x) => (
              <option key={x.drop_id} value={x.drop_id}>#{x.drop_id} {x.name} — {x.phase}</option>
            ))}
          </select>
          {open.length === 0 && drops.data && <p className="mt-2 text-xs text-muted">No drop is taking appeals right now. You can still check a proof.</p>}
          <label className="label mt-4 block" htmlFor="wallet">Flagged wallet</label>
          <input id="wallet" className="input mono mt-1" value={walletValue} onChange={(e) => { setWallet(e.target.value); setPreview(null); }} placeholder="0x…" />
          {account && !self && (
            <p className="mt-2 text-xs" style={{ color: demo ? "var(--pending)" : "var(--sybil)" }}>
              {demo ? "DEMO: only this drop's operator may file on behalf of another wallet." : "The canonical contract refuses this: the sender must be the flagged wallet."}
            </p>
          )}
        </Section>

        <Section title="2 · Merkle proof" icon={<ShieldCheck size={18} className="text-sand" />}>
          <p className="mb-2 text-xs text-muted">The flagged list is published on chain and the contract computed its root, so you never need the operator for a proof. Build yours here from the published list, paste one, or file with none: the contract then checks the published list itself.</p>
          <button type="button" className="btn btn-primary mb-3" disabled={!dropId || !walletValue || building} onClick={() => void buildProof()}>
            {building ? "Reading the published list…" : "Build my proof from the on-chain list"}
          </button>
          <textarea className="input mono min-h-24 text-xs" value={proof} onChange={(e) => { setProof(e.target.value); setPreview(null); }} placeholder="a3f1…,9c07…" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-ghost" disabled={!dropId || !walletValue || checking} onClick={() => void runPreview()}>
              {checking ? "Checking…" : "Preview"}
            </button>
            {preview && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1 text-sm" style={{ color: preview.ok ? "var(--human)" : "var(--sybil)" }}>
                {preview.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                {preview.ok ? "This wallet is on the flagged list." : preview.reason || "Not on the flagged list."}
              </motion.span>
            )}
          </div>
        </Section>

        <Section title="3 · Post the bond" icon={<Scale size={18} className="text-sand" />}>
          <label className="label" htmlFor="stmt">Statement (optional, max 1000 characters)</label>
          <textarea id="stmt" className="input mt-1 min-h-20" maxLength={1000} value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Anything you want on the record. The model does not read it; a later contest must add something new to it." />
          {d && (
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div><div className="label">Bond</div><span className="text-sand">{gen(d.bond_wei)} GEN</span></div>
              <div><div className="label">Allocation if you win</div><span className="text-human">{gen(d.allocation_wei)} GEN</span></div>
              <div><div className="label">Lookback</div><span className="text-sand">{d.lookback_days} days</span></div>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">HUMAN_PATTERN returns the bond and pays the allocation. SYBIL_PATTERN sends the bond to the reserve. INSUFFICIENT_HISTORY and UNRESOLVED return it and you may refile.</p>
          <div className="mt-4">
            <TxButton
              label="File appeal and post bond"
              className="btn btn-coral"
              disabled={!d || !walletValue || !preview?.ok}
              send={(acct) => write(acct, "file_appeal", [dropId, walletValue.trim(), proof.trim(), statement], BigInt(d?.bond_wei ?? "0"))}
              onDone={(r: WriteResult) => { if (r.status === "OK" && typeof r.appeal_id === "number") setFiled(r.appeal_id); }}
            />
          </div>
          {filed && (
            <p className="mt-3 text-sm text-human">Appeal #{filed} filed. <Link className="link" href={`/appeal/${filed}`}>Follow it</Link> — anyone can trigger its blind read.</p>
          )}
        </Section>
      </div>
    </AppShell>
  );
}
