import { NextResponse } from "next/server";
import { studioDevnet } from "genlayer-js/chains";

/**
 * Same-origin relay for Studio Devnet's JSON-RPC.
 *
 * Two jobs, both measured:
 *  1. Studio drops its CORS headers on 429s, so a rate-limit reaches the
 *     browser as a CORS error. Relaying through our origin keeps the real
 *     reason readable.
 *  2. Studio allows 30 requests per minute per IP. Read-only calls (`gen_call`,
 *     `eth_getBalance`, `eth_chainId`, receipt polls) are cached for a few
 *     seconds and a 429 is retried here with backoff, so a page that makes a
 *     handful of reads does not surface rate-limit errors in the console.
 *
 * Signed writes (`eth_sendRawTransaction`) are forwarded once, never cached,
 * never retried. Nothing is added, nothing is signed; there is no secret here.
 */
const UPSTREAM = studioDevnet.rpcUrls.default.http[0];
const CACHEABLE = new Set(["gen_call", "eth_chainId", "eth_getBalance", "net_version"]);
const RETRYABLE = new Set([...CACHEABLE, "eth_getTransactionByHash", "gen_getTransactionByHash",
  "eth_getTransactionReceipt", "eth_getTransactionCount", "eth_estimateGas", "sim_estimateTransactionFees",
  "gen_estimateTransactionFees", "eth_blockNumber", "eth_gasPrice", "gen_getContractSchema"]);
const TTL_MS = 8000;
const cache = new Map<string, { at: number; status: number; text: string; type: string }>();

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: Request) {
  let body: string;
  try {
    body = await request.text();
  } catch {
    return NextResponse.json({ error: "could not read the request body" }, { status: 400 });
  }
  let method = "";
  try {
    const parsed = JSON.parse(body);
    method = Array.isArray(parsed) ? "" : String(parsed?.method ?? "");
  } catch {
    /* forwarded as-is */
  }
  const key = CACHEABLE.has(method) ? body.replace(/"id":\s*("[^"]*"|\d+)/, '"id":0') : "";
  if (key) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) {
      const id = (() => { try { return JSON.parse(body).id; } catch { return 1; } })();
      const text = hit.text.replace(/"id":\s*("[^"]*"|\d+)/, `"id":${JSON.stringify(id)}`);
      return new NextResponse(text, { status: hit.status, headers: { "content-type": hit.type, "cache-control": "no-store" } });
    }
  }
  const attempts = RETRYABLE.has(method) ? 5 : 1;
  for (let i = 1; ; i++) {
    try {
      const upstream = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store" });
      const text = await upstream.text();
      const limited = upstream.status === 429 || /Rate limit exceeded/i.test(text);
      if (limited && i < attempts) {
        await sleep(1500 * i);
        continue;
      }
      const type = upstream.headers.get("content-type") ?? "application/json";
      if (key && upstream.ok && !limited) {
        cache.set(key, { at: Date.now(), status: upstream.status, text, type });
        if (cache.size > 500) cache.delete(cache.keys().next().value as string);
      }
      return new NextResponse(text, { status: upstream.status, headers: { "content-type": type, "cache-control": "no-store" } });
    } catch (error) {
      if (i < attempts) {
        await sleep(1000 * i);
        continue;
      }
      return NextResponse.json({ error: "the Studio Devnet RPC could not be reached", detail: error instanceof Error ? error.message : String(error) }, { status: 502 });
    }
  }
}
