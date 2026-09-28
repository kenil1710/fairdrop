#!/usr/bin/env python3
"""STEP 1 probe, reproducible: python3 tools/probe.py

Measures, against the live Blockscout hosts, every assumption FairDrop's
blind read rests on, and writes docs/probe/results.json. Stdlib only. Bounded:
a handful of requests per host with a pause between them.

  1. Does /api/v2/addresses/{a}/transactions?filter=from return ONLY outbound
     transactions (compared against filter=to and no filter)?
  2. Does a short page carry next_page_params == null (completeness signal)?
  3. Does the legacy txlist honour sort=asc (earliest-first), which the
     funding read depends on?
  4. Does the host answer without a redirect (GenVM's fetcher does not follow)?
  5. Do any of the keys we control have history on any allowlisted chain?
  6. The demo wallets: outbound page size, completeness, and first funding.
"""
import json, time, urllib.request, urllib.error, http.client, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "probe" / "results.json"
V = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"  # vitalik.eth: busy on every chain
HOSTS = ["eth.blockscout.com", "base.blockscout.com", "arbitrum.blockscout.com",
         "polygon.blockscout.com", "eth-sepolia.blockscout.com",
         "base-sepolia.blockscout.com", "optimism.blockscout.com",
         "gnosis.blockscout.com", "scroll.blockscout.com"]
DEMO = json.loads((ROOT / "docs" / "probe" / "demo-wallets.json").read_text())


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def get(url, follow=False):
    t = time.time()
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"user-agent": "fairdrop-probe"})
            r = (urllib.request.urlopen(req, timeout=60) if follow
                 else OPENER.open(req, timeout=60))
            return r.status, r.read().decode("utf-8", "ignore"), round(time.time() - t, 2)
        except urllib.error.HTTPError as e:
            if e.code == 429 and i < 3:
                time.sleep(4 * (i + 1))
                continue
            return e.code, "", round(time.time() - t, 2)
        except Exception as e:
            return 0, str(e)[:80], round(time.time() - t, 2)
    return 429, "", 0


def items_of(body):
    try:
        d = json.loads(body)
    except Exception:
        return None, None
    it = d.get("items") if isinstance(d, dict) else None
    return (it if isinstance(it, list) else None), (d.get("next_page_params") if isinstance(d, dict) else None)


def who(x, k):
    v = x.get(k) or {}
    return (v.get("hash") or "").lower() if isinstance(v, dict) else ""


def main():
    res = {"measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "hosts": {}, "controlled": {}, "demo": {}}
    for h in HOSTS:
        row = {}
        for f in ("from", "to", None):
            url = f"https://{h}/api/v2/addresses/{V}/transactions" + (f"?filter={f}" if f else "")
            s, b, dt = get(url)
            r = {"http": s, "bytes": len(b), "secs": dt}
            it, nxt = items_of(b) if s == 200 else (None, None)
            if it is not None:
                r.update(n=len(it), all_outbound=all(who(i, "from") == V for i in it),
                         all_inbound=all(who(i, "to") == V for i in it), has_next=nxt is not None)
            row["filter=" + str(f)] = r
            time.sleep(1.2)
        s, b, dt = get(f"https://{h}/api?module=account&action=txlist&address={V}&sort=asc&page=1&offset=5")
        asc = {"http": s}
        try:
            rs = json.loads(b).get("result")
            if isinstance(rs, list):
                t = [int(x["timeStamp"]) for x in rs]
                asc.update(n=len(t), ascending=t == sorted(t), first=t[:1])
        except Exception:
            pass
        row["legacy_sort_asc"] = asc
        row["filter_from_honoured"] = bool(row["filter=from"].get("all_outbound")) and not row["filter=None"].get("all_outbound", True)
        res["hosts"][h] = row
        print(h, json.dumps(row), flush=True)
        time.sleep(1.2)

    addrs = [l.strip() for l in (ROOT / "docs" / "probe" / "controlled-addresses.txt").read_text().split() if l.strip()]
    for h in ("eth.blockscout.com", "base.blockscout.com", "arbitrum.blockscout.com",
              "eth-sepolia.blockscout.com", "base-sepolia.blockscout.com"):
        hits = []
        for a in addrs:
            s, b, _ = get(f"https://{h}/api/v2/addresses/{a}/counters")
            try:
                if s == 200 and int(json.loads(b).get("transactions_count") or 0) > 0:
                    hits.append(a)
            except Exception:
                pass
            time.sleep(0.25)
        res["controlled"][h] = {"checked": len(addrs), "with_history": hits}
        print(h, "controlled keys with history:", len(hits), flush=True)

    for role, w in DEMO.items():
        h = w["host"]; a = w["address"].lower()
        s, b, dt = get(f"https://{h}/api/v2/addresses/{a}/transactions?filter=from")
        it, nxt = items_of(b) if s == 200 else (None, None)
        r = {"host": h, "address": a, "http": s, "bytes": len(b), "secs": dt}
        if it is not None:
            r.update(n=len(it), complete=(len(it) < 50 and nxt is None),
                     all_outbound=all(who(i, "from") == a for i in it),
                     newest=it[0]["timestamp"] if it else None, oldest=it[-1]["timestamp"] if it else None)
        time.sleep(1.2)
        s, b, _ = get(f"https://{h}/api?module=account&action=txlist&address={a}&sort=asc&page=1&offset=5")
        try:
            rs = json.loads(b).get("result")
            r["first_txs"] = [{"ts": int(x["timeStamp"]), "from": x["from"], "to": x["to"], "value": x["value"]} for x in rs]
        except Exception:
            r["first_txs"] = None
        res["demo"][role] = r
        print(role, json.dumps(r)[:300], flush=True)
        time.sleep(1.2)
    OUT.write_text(json.dumps(res, indent=1) + "\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
