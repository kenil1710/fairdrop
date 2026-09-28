#!/usr/bin/env python3
"""Fill the README's generated blocks from the records, never by hand.

    python3 tools/readme_fill.py          rewrite README.md in place
    python3 tools/readme_fill.py --check  exit 1 if README.md differs (audit)

Blocks (between HTML comment markers):
  addresses  current contracts from deployments.json, plus every superseded one
  outcomes   the demo seed's appeals from docs/seed-evidence.json (chain reads)
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
EXPLORER = "https://explorer-studio-dev.genlayer.com/address/"


def _dep():
    return json.loads((ROOT / "deployments.json").read_text())["deployments"]["studiodev"]


def render_addresses() -> str:
    d = _dep()
    rows = ["| contract | role | address |", "|---|---|---|"]
    roles = {
        "FairDrop": "canonical — sender must be the flagged wallet; 48 h contest window",
        "FairDropDemo": "demo — same source, operator may file for a public wallet; minutes-long windows",
        "FairDropRegistry": "is_cleared(wallet, drop) for distributors; reads the demo; holds no funds",
    }
    for name in ("FairDrop", "FairDropDemo", "FairDropRegistry"):
        a = d[name]["address"]
        rows.append(f"| {name} | {roles[name]} | [`{a}`]({EXPLORER}{a}) |")
    rows += ["", "<details><summary>Superseded deployments (not used by the app)</summary>", "",
             "| contract | address | why it was replaced |", "|---|---|---|"]
    for s in d.get("superseded", []):
        rows.append(f"| {s.get('name') or 'FairDropDemo'} | `{s['address']}` | {s.get('superseded_because', '')} |")
    rows += ["", "</details>"]
    return "\n".join(rows)


def render_outcomes() -> str:
    path = ROOT / "docs" / "seed-evidence.json"
    if not path.exists():
        return "_Seed evidence not written yet._"
    ev = json.loads(path.read_text())
    rows = ["| drop | appeal | wallet | outcome | decided by | payout (GEN) | note |", "|---|---|---|---|---|---|---|"]
    for key in sorted(ev["drops"]):
        drop = ev["drops"][key]["drop"]
        if not ev["drops"][key]["appeals"]:
            rows.append(f"| {key if key.isalpha() else 'UI walk'} #{drop['drop_id']} | — | — | {drop['phase']} (no appeals; reserve returned) | — | 0 | an abandoned walk attempt |")
        for a in ev["drops"][key]["appeals"]:
            notes = []
            if a.get("refile_of"):
                notes.append(f"refile of #{a['refile_of']}")
            if a.get("contested"):
                notes.append(f"contested: {a['provisional_outcome']} → {a['outcome']}")
            if a.get("split_rounds"):
                notes.append(f"{a['split_rounds']} recorded validator split(s)")
            payout = int(a.get("payout_wei") or 0) / 1e18
            rows.append(f"| {key if key.isalpha() else 'UI walk'} #{drop['drop_id']} | #{a['appeal_id']} | `{a['wallet'][:10]}…` | {a['outcome'] or a['status']} "
                        f"| {a['decided_by'] or '—'} | {payout:g} | {'; '.join(notes)} |")
    ledger = ev["stats"]["ledger"]
    rows += ["", f"Contract `{ev['contract']}` after every drop closed and every account claimed: "
             f"balance {ledger['balance_wei']} wei, locked {ledger['locked_wei']}, payable {ledger['payable_wei']}."]
    return "\n".join(rows)


BLOCKS = {"addresses": render_addresses, "outcomes": render_outcomes}


def filled(text: str) -> str:
    for name, fn in BLOCKS.items():
        pat = re.compile(r"(<!-- " + name + r":start -->\n)(?:.*?\n)?(<!-- " + name + r":end -->)", re.S)
        if not pat.search(text):
            raise SystemExit(f"README.md has no {name} block")
        body = fn()
        text = pat.sub(lambda m: m.group(1) + body + "\n" + m.group(2), text)
    return text


def main():
    text = README.read_text()
    want = filled(text)
    if "--check" in sys.argv:
        ok = want == text
        print("README blocks match deployments.json and seed evidence" if ok else "README blocks are STALE")
        sys.exit(0 if ok else 1)
    README.write_text(want)
    print("README.md filled")


if __name__ == "__main__":
    main()
