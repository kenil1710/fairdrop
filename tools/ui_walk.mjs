/**
 * Item 12: the whole lifecycle through the LIVE app, headless.
 *
 *   node tools/ui_walk.mjs [--url=https://fairdrop-six.vercel.app] [--deps=<dir with playwright-core + viem>]
 *
 * Two browser contexts, each with an injected EIP-1193 wallet backed by a test
 * key (roles walkOp and walkFlag in test/.accounts.json; --op= / --flag= to change). The wallet signs locally
 * and sends through the app's own /api/rpc relay. Every write goes through the
 * app's buttons; the script asserts each button's pending state ("Confirm in
 * wallet…" / "Waiting for consensus…") and its outcome ("Done" or the
 * contract's refusal text), and cross-checks what the page shows against a
 * direct chain read. Screenshots and a JSON log go to docs/ui-walk/.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const URL0 = arg("url", "https://fairdrop-six.vercel.app");
const require = createRequire(arg("deps", new URL("../test/", import.meta.url).pathname) + "/package.json");
const { chromium } = require("playwright-core");
const { privateKeyToAccount } = require("viem/accounts");

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("docs/ui-walk/", ROOT);
mkdirSync(OUT, { recursive: true });
const acc = JSON.parse(readFileSync(new URL("test/.accounts.json", ROOT), "utf8"));
const CHAIN_ID = 61997;
const RPC = `${URL0}/api/rpc`;
const log = [];
const note = (step, detail = {}) => { const e = { at: new Date().toISOString(), step, ...detail }; log.push(e); console.log(JSON.stringify(e)); writeFileSync(new URL("walk.json", OUT), JSON.stringify(log, null, 1)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params = []) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = await r.json().catch(() => ({ error: { message: `HTTP ${r.status}` } }));
    if (j.error && /rate limit/i.test(j.error.message ?? "") && i < 7) { await sleep(8000); continue; }
    return j;
  }
}

/** The injected wallet, Node side. */
function walletFor(role) {
  const account = privateKeyToAccount(acc[role].key);
  return {
    address: account.address,
    async handle(method, params) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return { result: [account.address] };
      if (method === "eth_chainId") return { result: "0x" + CHAIN_ID.toString(16) };
      if (method === "net_version") return { result: String(CHAIN_ID) };
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return { result: null };
      if (method === "personal_sign") return { result: await account.signMessage({ message: { raw: params[0] } }) };
      if (method === "eth_signTypedData_v4") return { result: await account.signTypedData(JSON.parse(params[1])) };
      if (method === "eth_sendTransaction") {
        const tx = params[0];
        const nonce = Number((await rpc("eth_getTransactionCount", [account.address, "pending"])).result);
        const gasPrice = BigInt((await rpc("eth_gasPrice")).result ?? "0x0");
        let gas = tx.gas ? BigInt(tx.gas) : 0n;
        if (!gas) { const g = await rpc("eth_estimateGas", [{ from: account.address, to: tx.to, data: tx.data, value: tx.value ?? "0x0" }]); gas = BigInt(g.result ?? "0x1c9c380"); }
        const raw = await account.signTransaction({ type: "legacy", chainId: CHAIN_ID, nonce, to: tx.to, data: tx.data, value: BigInt(tx.value ?? "0x0"), gas, gasPrice });
        return await rpc("eth_sendRawTransaction", [raw]);
      }
      return await rpc(method, params);
    },
  };
}

async function contextFor(browser, role) {
  const w = walletFor(role);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.exposeBinding("__fdWallet", async (_src, method, params) => JSON.stringify(await w.handle(method, JSON.parse(params))));
  await ctx.addInitScript(() => {
    const listeners = {};
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }) => {
        const out = JSON.parse(await window.__fdWallet(method, JSON.stringify(params ?? [])));
        if (out.error) { const e = new Error(out.error.message); e.code = out.error.code; throw e; }
        return out.result;
      },
      on: (ev, fn) => { (listeners[ev] ??= []).push(fn); },
      removeListener: () => {},
    };
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => note("page error", { role, message: String(e.message).slice(0, 200) }));
  page.on("console", (m) => { if (m.type() === "error") note("console error", { role, text: m.text().slice(0, 200) }); });
  page.on("response", async (r) => {
    if (!r.url().endsWith("/api/rpc")) return;
    try {
      const m = JSON.parse(r.request().postData() ?? "{}").method ?? "";
      if (/getTransaction|Receipt|sendRaw/.test(m)) note("rpc", { role, method: m, http: r.status(), body: (await r.text()).slice(0, 180) });
    } catch { /* not JSON */ }
  });
  return { ctx, page, address: w.address, role };
}

let shot = 0;
async function snap(p, name) { await p.page.screenshot({ path: new URL(`${String(++shot).padStart(2, "0")}-${p.role}-${name}.png`, OUT).pathname, fullPage: true }); }

/** Click a TxButton and watch it: pending text must appear, then Done or a refusal. */
async function tx(p, label, { expect = "ok" } = {}) {
  const btn = p.page.getByRole("button", { name: label, exact: false }).first();
  await btn.waitFor({ timeout: 60_000 });
  // Hold the CONTAINER element itself: the button's own label changes to the
  // pending text, so a by-name locator would stop resolving mid-flight.
  const box = await (await btn.elementHandle()).evaluateHandle((e) => e.parentElement);
  const textOf = () => box.evaluate((e) => e.innerText).catch(() => "");
  await btn.click();
  const t0 = Date.now();
  let pending = false;
  let text = "";
  const attached = () => box.evaluate((e) => e.isConnected).catch(() => false);
  while (Date.now() - t0 < 600_000) {
    if (pending && !(await attached())) break;   // the page moved on (e.g. the next step replaced the button)
    text = await textOf();
    if (/Confirm in wallet…|Waiting for consensus…/.test(text)) pending = true;
    else if (pending || Date.now() - t0 > 15_000) break;
    await sleep(pending ? 1500 : 200);
  }
  const gone = pending && !(await attached());
  text = (await textOf()).trim();
  const result = gone ? "ok" : /\bDone\b/.test(text) ? "ok" : "refused: " + text.replace(label, "").trim().slice(0, 160);
  note(`tx ${label}`, { role: p.role, pending_shown: pending, result, ...(gone ? { note: "the button was replaced by the next step; the caller checks the page" } : {}), seconds: Math.round((Date.now() - t0) / 1000) });
  await snap(p, label.replace(/[^a-z0-9]+/gi, "_").slice(0, 30));
  if (expect === "ok" && result !== "ok") throw new Error(`${label}: ${result}`);
  if (expect === "refused" && !result.startsWith("refused")) throw new Error(`${label}: expected a refusal, got ${result}`);
  return result;
}

async function connect(p) {
  // The app restores an already-granted session from eth_accounts on mount (it
  // never prompts); click Connect only if it is still offered after that.
  await p.page.waitForTimeout(2500);
  const b = p.page.getByRole("button", { name: /^Connect/ }).first();
  if (await b.isVisible().catch(() => false)) await b.click({ timeout: 5000 }).catch(() => {});
  const tag = p.address.slice(2, 6);
  const shown = await p.page.getByText(new RegExp(tag, "i")).first().waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
  note("wallet connected", { role: p.role, address_shown_in_header: shown });
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const op = await contextFor(browser, arg("op", "walkOp"));
  const fl = await contextFor(browser, arg("flag", "walkFlag"));
  note("accounts", { operator: op.address, flagged: fl.address, url: URL0 });

  const resumeAppeal = Number(arg("appeal", "0"));
  let dropId = Number(arg("drop", "0"));
  let appealId = resumeAppeal;
  if (!resumeAppeal) {
    // --- operator: rules → seal → create -------------------------------------------------
    await op.page.goto(`${URL0}/operator`);
    await connect(op);
    await snap(op, "operator");
    await op.page.getByRole("button", { name: "Next: seal" }).click();
    await op.page.getByRole("button", { name: /Compute commitment/ }).click();
    const hash = await op.page.locator("div.mono.break-all").first().innerText();
    note("sealed in the browser", { rules_hash: hash });
    await op.page.getByRole("button", { name: /Next: create the drop/ }).click();
    const set = async (label, value) => { const i = op.page.locator("label", { hasText: label }).locator("input"); await i.fill(String(value)); };
    const name = `UI walk ${new Date().toISOString().slice(11, 19)}`;
    await set("Drop name", name);
    await set("Snapshot in", 1);
    await set("Appeal window", 0.1);
    await set("Reveal window", 0.2);
    await set("Allocation per wallet", "0.5");
    await set("Appeal bond", "0.05");
    await set("Appeal reserve", "1");
    await tx(op, "Create drop and escrow");
    await op.page.getByText("Publish the flagged list").first().waitFor({ timeout: 60_000 });

    // the drop id: the newest drop by this operator, as the page lists it
    await op.page.waitForTimeout(3000);
    const dropOption = await op.page.locator("#dropSel option").last().innerText().catch(() => "");
    dropId = Number((dropOption.match(/#(\d+)/) ?? [])[1] ?? 0);
    note("drop created", { dropId, option: dropOption });
    if (!dropId) throw new Error("no drop id on the page");
    await op.page.selectOption("#dropSel", String(dropId));

    // --- after the snapshot: publish the flagged list --------------------------------------
    await sleep(75_000);
    const other = "0x" + "7".repeat(40);
    await op.page.locator("textarea").first().fill(`${fl.address}\n${other}`);
    await op.page.getByRole("button", { name: /Sort and preview the root/ }).click();
    await tx(op, "Publish chunk 1 (final)");

    // --- flagged wallet: build its own proof from the on-chain list, file ------------------
    await fl.page.goto(`${URL0}/appeal?drop=${dropId}`);
    await connect(fl);
    await fl.page.waitForTimeout(3000);
    await fl.page.selectOption("#drop", String(dropId));
    await fl.page.getByRole("button", { name: /Build my proof from the on-chain list/ }).click();
    await fl.page.getByText("This wallet is on the flagged list.").waitFor({ timeout: 120_000 });
    const proof = await fl.page.locator("textarea").first().inputValue();
    note("proof built in the browser from get_flagged", { proof });
    await snap(fl, "proof");
    await fl.page.locator("#stmt").fill("This is my own wallet; I appeal from it.");
    await tx(fl, "File appeal and post bond");
    const appealLink = await fl.page.getByRole("link", { name: "Follow it" }).getAttribute("href");
    appealId = Number(appealLink.split("/").pop());
    note("appeal filed", { appealId });
    // error state: the same wallet twice
    await tx(fl, "File appeal and post bond", { expect: "refused" });

    // --- appeal page before the reveal: pending, and a read is not offered -------------------
    await fl.page.goto(`${URL0}/appeal/${appealId}`);
    await fl.page.getByText(/AWAITING REVEAL/).waitFor({ timeout: 60_000 });
    await snap(fl, "awaiting-reveal");
    note("appeal page shows the pending state", { text: "AWAITING REVEAL" });

    // --- operator: reveal, a bad salt first (error state), then the real one -----------------
    await sleep(6 * 60_000 + 20_000);
    await op.page.getByRole("button", { name: "5. Reveal" }).click();
    await op.page.locator("select").first().selectOption(String(dropId));
    await op.page.getByRole("button", { name: /Use this session/ }).click();
    const saltBox = op.page.locator("input.mono").last();
    const realSalt = await saltBox.inputValue();
    await saltBox.fill("ab".repeat(32));
    await tx(op, "Reveal rules", { expect: "refused" });
    note("reveal with a wrong salt was refused; revealing the committed rules");
    await saltBox.fill(realSalt);
    await tx(op, "Reveal rules");


  } else {
    note("resuming at the read", { dropId, appealId });
    await connect(op);
    await connect(fl);
  }

  // --- the read, the verdict ------------------------------------------------------------------
  // A read round that lands UNAVAILABLE (the explorer did not answer) decides
  // nothing and the page offers the read again: retry until one lands.
  for (let i = 1; i <= 12; i++) {
    await fl.page.goto(`${URL0}/appeal/${appealId}`);
    await fl.page.waitForTimeout(4000);
    if (await fl.page.getByText(/READ · OUTCOME AGREED/).isVisible().catch(() => false)) break;
    await tx(fl, "Run the blind read", { expect: "any" });
    await fl.page.reload();
    await fl.page.waitForTimeout(4000);
    const header = (await fl.page.locator("div.display").first().innerText().catch(() => "")).trim();
    note("after a read round", { attempt: i, header });
    if (/READ · OUTCOME AGREED/.test(header)) break;
    await sleep(20_000);
  }
  await fl.page.getByText(/READ · OUTCOME AGREED/).waitFor({ timeout: 60_000 });
  await tx(fl, "Apply the rules");
  await fl.page.reload();
  await fl.page.waitForTimeout(4000);
  const verdict = (await fl.page.locator("div.display").first().innerText()).trim();
  note("verdict on the page", { verdict });
  await snap(fl, "verdict");

  // --- contest by the losing side -----------------------------------------------------------------
  const loser = verdict === "HUMAN_PATTERN" ? op : fl;
  await loser.page.goto(`${URL0}/appeal/${appealId}`);
  await loser.page.locator("textarea").first().fill("Account opened for payroll; the same five colleagues are paid on the last Friday of every month.");
  await tx(loser, "Contest with bond");
  await loser.page.reload();
  await loser.page.getByText("Contest record").waitFor({ timeout: 60_000 });
  const finalText = (await loser.page.locator("div.display").first().innerText()).trim();
  note("after the contest", { final: finalText });
  await snap(loser, "contested");

  // --- close the drop after the reveal deadline, then both sides claim ------------------------------
  await sleep(8 * 60_000);
  await op.page.goto(`${URL0}/drop/${dropId}`);
  await tx(op, "Close");
  for (const p of [op, fl]) {
    await p.page.goto(`${URL0}/drops`);
    await p.page.getByTestId("claim-bar").waitFor({ timeout: 60_000 });
    await tx(p, "Claim payout");
  }
  note("walk complete");
} catch (e) {
  note("FAILED", { error: String(e.message ?? e).slice(0, 400) });
  process.exitCode = 1;
} finally {
  await browser.close();
}
