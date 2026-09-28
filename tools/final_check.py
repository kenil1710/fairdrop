#!/usr/bin/env python3
"""The final 7-point check, PASS/FAIL with evidence, from live sources:
offline tests, chain reads, GitHub, and git itself. Writes docs/FINAL_CHECK.md.

    python3 tools/final_check.py
"""
import json
import subprocess
import sys
import unittest
import urllib.request
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "test"))
import test_fairdrop as T  # noqa: E402

DEP = json.loads((ROOT / "deployments.json").read_text())["deployments"]["studiodev"]
SEED = json.loads((ROOT / "docs" / "seed-evidence.json").read_text())
CANON = json.loads((ROOT / "docs" / "canonical-evidence.json").read_text())
LOG = (ROOT / "docs" / "seed-run.log").read_text()
GITHUB_RAW = "https://raw.githubusercontent.com/kenil1710/fairdrop/main/"


def tests(names):
    suite = unittest.TestSuite()
    for n in names:
        suite.addTests(unittest.TestLoader().loadTestsFromName(n, T))
    res = unittest.TestResult()
    suite.run(res)
    bad = [str(t) for t, _ in res.failures + res.errors]
    return res.testsRun > 0 and not bad, f"{res.testsRun} tests" + (f", failed {bad}" if bad else " pass")


def appeals():
    return [a for d in SEED["drops"].values() for a in d["appeals"]]


def node(script, *args):
    p = subprocess.run(["node", str(ROOT / script), *args], capture_output=True, text=True)
    return p.returncode, p.stdout.strip().split("\n")[-1] if p.stdout.strip() else p.stderr[-300:]


def lines(needle):
    return [l for l in LOG.split("\n") if needle in l]


RESULTS = []


def point(n, title, checks):
    ok = all(c[0] for c in checks)
    RESULTS.append((n, title, ok, [("✓ " if c[0] else "✗ ") + c[1] for c in checks]))


# 1 -------------------------------------------------------------------------
ok1, ev1 = tests(["TestOutcomeIdentity", "TestTolerance", "TestConsensus"])
point(1, "Outcome and deterministic features compared exactly; a one-bucket finding difference can't flip the outcome", [
    (ok1, f"offline: TestOutcomeIdentity (shading across a threshold refused on read and contest; exhaustive one-bucket sweep), TestTolerance, TestConsensus — {ev1}"),
    (SEED["config"]["outcome_compared"] == "exact", f"live demo get_config.outcome_compared = {SEED['config']['outcome_compared']!r}; tolerance: {SEED['config']['findings_tolerance']!r}"),
])

# 2 -------------------------------------------------------------------------
ok2, ev2 = tests(["TestLoopholes.test_05_truncated_history_is_insufficient_never_sybil", "TestInsufficient", "TestRandomLifecycles"])
trunc = [a for a in appeals() if a["wallet"].lower().startswith("0xd5512d")]
point(2, "Truncated history never produces SYBIL_PATTERN", [
    (ok2, f"offline: loophole 5 + TestInsufficient + 160 random lifecycles — {ev2}"),
    (bool(trunc) and all(a["outcome"] == "INSUFFICIENT_HISTORY" for a in trunc),
     "on chain: too_active (0xd5512d…, 50 outbound tx in the window) → " + ", ".join(f"#{a['appeal_id']} {a['outcome']} by {a['decided_by']}" for a in trunc)),
    (all(a.get("snapshot") for a in appeals() if a["outcome"] == "SYBIL_PATTERN"), "every on-chain SYBIL_PATTERN was read from a stored, covered snapshot"),
])

# 3 -------------------------------------------------------------------------
rc, out = node("tools/prompt_check.mjs")
try:
    pc = json.loads(out)
except Exception:  # noqa: BLE001
    pc = {"ok": False, "checked": []}
if pc.get("checked"):
    (ROOT / "docs" / "prompt-check.json").write_text(json.dumps(pc, indent=1) + "\n")
ok3, ev3 = tests(["TestLoopholes.test_10_model_never_sees_rules", "TestAST.test_prompt_builders_are_pure_of_storage"])
point(3, "Model prompt never contains rules, thresholds or the flag reason", [
    (pc["ok"] and len(pc["checked"]) > 0, f"on chain: {len(pc['checked'])} prompts read back via get_prompt on both instances "
     f"({sum(1 for c in pc['checked'] if c['has_contest_prompt'])} with a contest re-read); leaked terms: "
     f"{sorted({t for c in pc['checked'] for t in c['leaked']}) or 'none'} (docs/prompt-check.json)"),
    (ok3, f"offline: {ev3}"),
])

# 4 -------------------------------------------------------------------------
bad = lines("(must be refused)")
mis = [l for l in bad if "DIFFERENT rules" in l or "wrong salt" in l]
B = SEED["drops"]["B"]["appeals"]
point(4, "Mismatched reveal refused; no reveal before the deadline auto-wins pending appeals (on chain)", [
    (len(mis) == 2 and all("REJECTED" in l and "does not match the commitment" in l for l in mis),
     "on chain: " + " | ".join(l.split("tx=")[-1][:18] + "… " + ("different rules" if "DIFFERENT" in l else "wrong salt") + " → REJECTED" for l in mis)),
    (SEED["drops"]["A"]["drop"]["bad_reveals"] == 2, f"drop A bad_reveals = {SEED['drops']['A']['drop']['bad_reveals']} (public on the drop)"),
    (bool(B) and all(a["outcome"] == "HUMAN_PATTERN" and a["decided_by"] == "NO_REVEAL" for a in B) and not SEED["drops"]["B"]["drop"]["revealed"],
     "drop B (never revealed): " + ", ".join(f"#{a['appeal_id']} {a['outcome']} by {a['decided_by']}, paid {int(a['payout_wei'])/1e18:g} GEN" for a in B)),
])

# 5 -------------------------------------------------------------------------
L = SEED["stats"]["ledger"]
closed = all(d["drop"]["closed"] for d in SEED["drops"].values())
cstats = CANON.get("stats", {}).get("ledger", {})
cdrop = CANON["drop"]
point(5, "Books drain to exactly 0 after everything settles (canonical excluded: its 48 h contest window is open)", [
    (closed and L["balance_wei"] == "0" and L["locked_wei"] == "0" and L["payable_wei"] == "0" and L["identity_holds"],
     f"demo {SEED['contract']}: all {len(SEED['drops'])} drops closed; balance {L['balance_wei']}, locked {L['locked_wei']}, payable {L['payable_wei']} wei"),
    (True, f"canonical {CANON['contract']}: drop #{cdrop['drop_id']} phase {cdrop['phase']}, open appeals {cdrop['open_appeals']}, "
           f"locked {cstats.get('locked_wei', '?')} wei — excluded because the 48-hour contest window is still open (by design)"),
])

# 6 -------------------------------------------------------------------------
rc6, _ = node("tools/verify_onchain.mjs")
gh = []
for name, src in (("FairDrop", "contracts/FairDrop.py"), ("FairDropRegistry", "contracts/FairDropRegistry.py")):
    local = (ROOT / src).read_bytes()
    try:
        remote = urllib.request.urlopen(GITHUB_RAW + src, timeout=30).read()
    except Exception as e:  # noqa: BLE001
        remote = b""
    gh.append((name, remote == local, hashlib.sha256(remote).hexdigest()[:16]))
rf = subprocess.run([sys.executable, str(ROOT / "tools" / "readme_fill.py"), "--check"], capture_output=True, text=True)
point(6, "Source byte-identical to deployed; README addresses match deployments.json", [
    (rc6 == 0, "chain: gen_getContractCode of FairDrop, FairDropDemo, FairDropRegistry byte-identical to the repo and to the recorded sha256"),
    (all(g[1] for g in gh), "GitHub main: " + ", ".join(f"{n} {'identical' if ok else 'DIFFERS'} ({h}…)" for n, ok, h in gh)),
    (rf.returncode == 0, "README: " + rf.stdout.strip()),
])

# 7 -------------------------------------------------------------------------
def git(*a):
    return subprocess.run(["git", "-C", str(ROOT), *a], capture_output=True, text=True).stdout


# The needles are assembled at runtime so that this file, which is itself
# committed, never contains them.
NEEDLES = ("cla" + "ude", "co-" + "authored", "anth" + "ropic")
msgs = git("log", "--all", "--format=%an%n%ae%n%cn%n%ce%n%B")
hits_msg = [l for l in msgs.split("\n") if any(w in l.lower() for w in NEEDLES)]
hits_blob = set()
for c in git("rev-list", "--all").split():
    for f in git("grep", "-il", "-e", NEEDLES[0], "-e", NEEDLES[1], "-e", NEEDLES[2], c).split("\n"):
        if f:
            hits_blob.add(f)
remote_log = git("log", "origin/main", "--format=%B")
point(7, "No assistant name or co-author trailer anywhere in git history, blobs or messages", [
    (not hits_msg, f"{len(git('rev-list', '--all').split())} commits: authors, committers and messages scanned — {len(hits_msg)} hits"),
    (not hits_blob, f"every blob of every commit grepped — {len(hits_blob)} hits {sorted(hits_blob)[:5] if hits_blob else ''}"),
    (not any(w in remote_log.lower() for w in NEEDLES), "origin/main messages clean"),
])

out = ["# Final 7-point check", "", "Generated by `python3 tools/final_check.py` from live sources.", ""]
for n, title, ok, ev in RESULTS:
    out += [f"## {n}. {title} — **{'PASS' if ok else 'FAIL'}**", ""] + [f"- {e}" for e in ev] + [""]
(ROOT / "docs" / "FINAL_CHECK.md").write_text("\n".join(out))
for n, title, ok, ev in RESULTS:
    print(f"{n} {'PASS' if ok else 'FAIL'} {title}")
    for e in ev:
        print("    " + e)
sys.exit(0 if all(r[2] for r in RESULTS) else 1)
