"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Menu, Radio, Wallet, X } from "lucide-react";
import { Logo } from "./Logo";
import { ClaimBar } from "./ClaimBar";
import { useWallet } from "./WalletProvider";
import { NETWORK_LABEL } from "@/lib/genlayer";
import { short } from "@/lib/fairdrop";
import { getConfig } from "@/lib/contract";

const NAV = [
  { href: "/drops", label: "Drops" },
  { href: "/appeal", label: "Appeal" },
  { href: "/operator", label: "Operator" },
  { href: "/docs", label: "Docs" },
];

export function NetworkBadge() {
  const { account, onRightNetwork, switchNetwork } = useWallet();
  const wrong = Boolean(account) && !onRightNetwork;
  return (
    <button
      type="button"
      onClick={() => wrong && void switchNetwork()}
      className="chip"
      style={{ color: wrong ? "var(--pending)" : "var(--human)" }}
      title={wrong ? "Switch to GenLayer Studio Dev" : "GenLayer Studio Dev, chain 61997"}
    >
      {wrong ? <AlertTriangle size={12} /> : <Radio size={12} />}
      {wrong ? "Wrong network" : NETWORK_LABEL}
    </button>
  );
}

export function ConnectButton() {
  const { account, connect, connecting, disconnect, hasWallet } = useWallet();
  if (account) {
    return (
      <button type="button" className="btn btn-ghost mono !px-3 !py-1.5 text-xs" onClick={disconnect} title="Disconnect this app">
        <Wallet size={14} /> {short(account, 4)}
      </button>
    );
  }
  return (
    <button type="button" className="btn btn-primary !px-3 !py-1.5 text-sm" onClick={() => void connect()} disabled={connecting}>
      <Wallet size={14} /> {connecting ? "Connecting…" : hasWallet ? "Connect" : "Connect wallet"}
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<string>("");
  const { account, onRightNetwork, switchNetwork, error } = useWallet();
  const asked = useRef(false);

  // AUTO SWITCH: once connected on the wrong chain, ask the wallet to switch
  // (and add Studio Dev if it does not know it). Once per session - a wallet
  // that refuses is not asked again on every render.
  useEffect(() => {
    if (account && !onRightNetwork && !asked.current) {
      asked.current = true;
      void switchNetwork();
    }
  }, [account, onRightNetwork, switchNetwork]);

  useEffect(() => {
    getConfig().then((c) => setMode(c.mode)).catch(() => setMode(""));
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      {mode === "DEMO" && (
        <div className="border-b border-pending/30 bg-pending/10 px-4 py-2 text-center text-xs text-pending">
          <b>DEMO instance</b> — operators may file on behalf of named public wallets so real histories can be read. The canonical instance requires the flagged wallet to appeal itself. <Link className="underline" href="/docs#demo">Why</Link>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--bg)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" aria-label="FairDrop home"><Logo /></Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={`rounded-lg px-3 py-1.5 text-sm ${path?.startsWith(n.href) ? "bg-[var(--card)] text-sand" : "text-muted hover:text-sand"}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex"><NetworkBadge /></span>
            <ConnectButton />
            <button type="button" className="btn btn-ghost !p-2 md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
              {open ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="border-t border-[var(--line)] px-4 py-2 md:hidden">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sand">
                {n.label}
              </Link>
            ))}
            <div className="px-3 py-2"><NetworkBadge /></div>
          </nav>
        )}
        {error && <div className="bg-sybil/10 px-4 py-1.5 text-center text-xs text-sybil">{error}</div>}
      </header>
      <ClaimBar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-[var(--line)] px-4 py-6 text-center text-xs text-muted">
        FairDrop · GenLayer Studio Dev · <Link href="/docs" className="underline">how it works</Link> · <a className="underline" href="https://github.com/kenil1710/fairdrop" target="_blank" rel="noreferrer">source</a>
      </footer>
    </div>
  );
}
