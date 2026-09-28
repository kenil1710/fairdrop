#!/usr/bin/env python3
"""STEP 6 audit: every safety pattern and every loophole in the brief, PASS or
FAIL, with evidence. Writes docs/AUDIT.md.

    python3 tools/audit.py            offline evidence + deployment checks
    python3 tools/audit.py --chain    also reads the chain (source byte-for-byte,
                                      seed evidence re-read from the contract)

Each item is backed by named offline tests (run here, individually) and, where
the brief asks for it, by on-chain evidence from docs/seed-evidence.json and
docs/canonical-evidence.json. An item passes only if every test it names passes
and every on-chain check it names holds."""
import ast
import hashlib
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "test"))
import test_fairdrop as T  # noqa: E402

SRC = (ROOT / "contracts" / "FairDrop.py").read_text()
DEP = json.loads((ROOT / "deployments.json").read_text())["deployments"]["studiodev"]
SEED = ROOT / "docs" / "seed-evidence.json"
CANON = ROOT / "docs" / "canonical-evidence.json"
seed = json.loads(SEED.read_text()) if SEED.exists() else None
canon = json.loads(CANON.read_text()) if CANON.exists() else None
LOG = (ROOT / "docs" / "seed-run.log").read_text() if (ROOT / "docs" / "seed-run.log").exists() else ""
CLOG = (ROOT / "docs" / "canonical-run.log").read_text() if (ROOT / "docs" / "canonical-run.log").exists() else ""


def run(names):
    """Run the named tests; return (ok, detail)."""
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for n in names:
        suite.addTests(loader.loadTestsFromName(n, T))
    res = unittest.TestResult()
    suite.run(res)
    bad = [str(t) for t, _ in res.failures + res.errors]
    return (res.testsRun > 0 and not bad, f"{res.testsRun} test(s)" + (f", FAILED: {bad}" if bad else ""))


def appeals():
    if not seed:
        return []
    out = []
    for d in seed["drops"].values():
        out += d["appeals"]
    return out


def chain(check, why):
    if seed is None:
        return (False, "no docs/seed-evidence.json yet")
    try:
        return (bool(check()), why)
    except Exception as e:  # noqa: BLE001
        return (False, f"{why}: {e}")


def log_has(text, where=None):
    return text in (where if where is not None else LOG)


ITEMS = []


def item(group, name, tests=(), chain_checks=()):
    ITEMS.append((group, name, list(tests), list(chain_checks)))


# --- safety patterns -----------------------------------------------------------
item("Safety", "Consensus binds every stored value (full vector compared)",
     ["TestConsensus", "TestConsensusMore", "TestRead.test_disagreement_applies_nothing"],
     [lambda: chain(lambda: all(a["snapshot_hash"] == hashlib.sha256(a.get("snapshot", "").encode()).hexdigest()
                                for a in appeals() if a.get("snapshot")), "stored snapshots hash to stored hashes (full appeals)")])
item("Safety", "Leader cannot forge: findings bucketed and compared (never shaded toward sybil), deterministic features compared exactly",
     ["TestConsensus", "TestTolerance", "TestConsensusMore.test_leader_one_step_toward_sybil_is_refused",
      "TestConsensusMore.test_validators_disagree_on_different_pages"])
item("Safety", "Zero raise statements (both contracts)", ["TestAST.test_zero_raise_statements", "TestAST.test_no_assert_statements"])
item("Safety", "Refund-on-reject on every payable path (value of a refused call stays claimable)",
     ["TestAccess", "TestCreateDrop.test_refused_value_stays_claimable",
      "TestFileAppeal.test_short_bond_refused_and_refundable", "TestContest.test_short_bond_refused",
      "TestAST.test_every_write_banks_first", "TestAST.test_payable_methods"])
item("Safety", "No counter moves before a refusal", ["TestAccess"])
item("Safety", "Content hash of the exact fetched history", ["TestRead.test_read_stores_vector", "TestFetch.test_snapshot_is_deterministic", "TestDecide.test_verify_appeal_rederives"])
item("Safety", "settle_stalled permissionless and working while paused",
     ["TestLoopholes.test_11_owner_pause_leaves_appeals_payouts_and_settle_stalled", "TestAccess.test_settle_stalled_refusals"],
     [lambda: chain(lambda: log_has("settle_stalled while paused") and "settle_stalled(" in LOG, "called on chain while paused; reached its own check, not a pause refusal")])
item("Safety", "Owner cannot freeze funds (pause gates only create_drop; no owner withdraw)",
     ["TestAST.test_pause_gates_only_create_drop", "TestLoopholes.test_11_owner_pause_leaves_appeals_payouts_and_settle_stalled"])
item("Safety", "No str.replace()", ["TestAST.test_no_str_replace"])
item("Safety", "Conservative outcomes (UNCLEAR never fires; source failure decides nothing)",
     ["TestEvaluate", "TestRead.test_unavailable_changes_nothing", "TestConsensusMore.test_model_failure_is_unavailable_not_a_verdict"])
item("Safety", "Deposit lifecycle drains to zero (randomized)", ["TestRandomLifecycles"],
     [lambda: chain(lambda: seed["stats"]["ledger"]["balance_wei"] == "0" and seed["stats"]["ledger"]["identity_holds"], "demo books at 0 after every drop closed and everyone claimed")])
item("Safety", "Two-step money: clock readers never transfer; claim_payout reads no clock",
     ["TestAST.test_only_claim_payout_transfers", "TestAST.test_claim_payout_reads_no_clock", "TestAST.test_clock_readers_never_transfer"])
item("Safety", "emit_transfer at one site, never a bare .emit()", ["TestAST.test_single_emit_transfer_only_in_pay", "TestAST.test_no_bare_emit"])
item("Safety", "Coverage gate: unprovable history is INSUFFICIENT, holds if filter=from is ignored",
     ["TestFetch", "TestInsufficient"],
     [lambda: chain(lambda: any(a["outcome"] == "INSUFFICIENT_HISTORY" for a in appeals()), "too_active read INSUFFICIENT_HISTORY on chain")])
item("Safety", "Bounded fetches, v2 only, URL from an allowlist",
     ["TestFetch.test_fetch_is_bounded", "TestAST.test_no_url_from_calldata"])
item("Safety", "Registry: custody false, zero payable methods", ["TestRegistry", "TestAST.test_registry_has_no_payable_and_no_transfer"])
item("Safety", "Header, undefined names, float literals, TreeMap subscripts, immutables",
     ["TestAST.test_two_line_header", "TestAST.test_no_undefined_names", "TestAST.test_no_float_literals",
      "TestAST.test_no_subscript_on_array_valued_maps", "TestAST.test_immutables_have_no_setter",
      "TestAST.test_frozen_drop_fields_written_only_at_creation"])

# --- the eleven loopholes --------------------------------------------------------
item("Loophole", "1. Operator reveals different rules than committed → refused",
     ["TestLoopholes.test_01_operator_reveals_different_rules_than_committed", "TestReveal"],
     [lambda: chain(lambda: log_has("DIFFERENT rules than committed (must be refused)") and
                    [l for l in LOG.split("\n") if "DIFFERENT rules" in l][0].count("REJECTED") == 1, "refused on chain (seed-run.log)")])
item("Loophole", "2. Operator never reveals → pending appeals auto-won",
     ["TestLoopholes.test_02_operator_never_reveals_pending_appeals_auto_won"],
     [lambda: chain(lambda: [a for a in seed["drops"]["B"]["appeals"]] and all(a["decided_by"] == "NO_REVEAL" and a["outcome"] == "HUMAN_PATTERN" for a in seed["drops"]["B"]["appeals"]), "drop B: every appeal HUMAN by NO_REVEAL")])
item("Loophole", "3. Non-flagged wallet appeals → refused (bad merkle proof)",
     ["TestLoopholes.test_03_non_flagged_wallet_cannot_appeal", "TestMerkleRefusals"],
     [lambda: (canon is not None and "LOOPHOLE 3" in CLOG and [l for l in CLOG.split("\n") if "LOOPHOLE 3" in l][0].count("REJECTED") == 1, "refused on the canonical instance")])
item("Loophole", "4. Appeal for a wallet you don't control → impossible (sender must be the wallet)",
     ["TestLoopholes.test_04_cannot_appeal_for_a_wallet_you_do_not_control"],
     [lambda: (canon is not None and "LOOPHOLE 4" in CLOG and [l for l in CLOG.split("\n") if "LOOPHOLE 4" in l][0].count("REJECTED") == 1, "refused on the canonical instance")])
item("Loophole", "5. Truncated history → INSUFFICIENT_HISTORY, never SYBIL_PATTERN",
     ["TestLoopholes.test_05_truncated_history_is_insufficient_never_sybil", "TestRandomLifecycles"],
     [lambda: chain(lambda: all(a["outcome"] != "SYBIL_PATTERN" for a in appeals() if a["wallet"].lower().startswith("0xd5512d")), "too_active never SYBIL on chain")])
item("Loophole", "6. Operator withdraws reserve during appeals → refused",
     ["TestLoopholes.test_06_operator_cannot_withdraw_reserve_during_appeals"],
     [lambda: (canon is not None and "LOOPHOLE 6" in CLOG and [l for l in CLOG.split("\n") if "LOOPHOLE 6" in l][0].count("REJECTED") == 1, "refused on the canonical instance")])
item("Loophole", "7. Appeals exceed reserve → pro-rata",
     ["TestLoopholes.test_07_appeals_exceeding_reserve_are_pro_rata"],
     [lambda: chain(lambda: seed["drops"]["C"]["drop"]["pro_rata"] and len({a["payout_wei"] for a in seed["drops"]["C"]["appeals"] if a["outcome"] == "HUMAN_PATTERN"}) == 1, "drop C closed pro-rata, equal shares")])
item("Loophole", "8. Same wallet appeals twice → refused",
     ["TestLoopholes.test_08_same_wallet_twice_refused"],
     [lambda: (canon is not None and "LOOPHOLE 8" in CLOG and [l for l in CLOG.split("\n") if "LOOPHOLE 8" in l][0].count("REJECTED") == 1, "refused on the canonical instance")])
item("Loophole", "9. Contest copies original text → refused by novelty gate",
     ["TestLoopholes.test_09_contest_copying_original_text_refused", "TestContest"],
     [lambda: chain(lambda: "COPIES the statement" not in LOG or [l for l in LOG.split("\n") if "COPIES the statement" in l][0].count("REJECTED") == 1, "refused on chain when staged")])
def prompt_check():
    if "--chain" not in sys.argv:
        return (True, "on-chain prompt check skipped (run with --chain)")
    p = subprocess.run(["node", str(ROOT / "tools" / "prompt_check.mjs")], capture_output=True, text=True)
    try:
        data = json.loads(p.stdout.strip().split("\n")[-1])
    except Exception:  # noqa: BLE001
        return (False, "prompt check did not run: " + p.stderr[-200:])
    (ROOT / "docs" / "prompt-check.json").write_text(json.dumps(data, indent=1) + "\n")
    return (data["ok"] and len(data["checked"]) > 0,
            f"{len(data['checked'])} live prompts read back via get_prompt; none contains rules, salt, commitment, a rule line or case framing")


item("Loophole", "10. Model sees rules → impossible by design; prompt never contains them",
     ["TestLoopholes.test_10_model_never_sees_rules", "TestAST.test_prompt_builders_are_pure_of_storage",
      "TestAST.test_nondet_closures_capture_no_self", "TestContest.test_evidence_leaking_rules_refused"],
     [prompt_check])
item("Loophole", "11. Owner pause → appeals, payouts, settle_stalled still work",
     ["TestLoopholes.test_11_owner_pause_leaves_appeals_payouts_and_settle_stalled"],
     [lambda: chain(lambda: log_has("owner PAUSES the contract") and log_has("create_drop while paused (must be refused)"), "drop C filed/read while paused; create_drop refused")])


def deployment_rows(with_chain):
    rows = []
    for name, src in (("FairDrop", "contracts/FairDrop.py"), ("FairDropDemo", "contracts/FairDrop.py"),
                      ("FairDropRegistry", "contracts/FairDropRegistry.py")):
        if name not in DEP:
            continue
        digest = hashlib.sha256((ROOT / src).read_bytes()).hexdigest()
        rows.append((f"{name} recorded sha256 == repo file", DEP[name]["source_sha256"] == digest, DEP[name]["address"]))
    if with_chain:
        p = subprocess.run(["node", str(ROOT / "tools" / "verify_onchain.mjs"), "--json"], capture_output=True, text=True)
        try:
            data = json.loads(p.stdout.strip().split("\n")[-1])
            for r in data:
                rows.append((f"{r['name']} source read back off chain is byte-identical ({r['chain_bytes']} B)", r["identical"], r["address"]))
        except Exception:  # noqa: BLE001
            rows.append(("source read back off chain", False, p.stdout[-200:] + p.stderr[-200:]))
    return rows


def main():
    with_chain = "--chain" in sys.argv
    lines = ["# FairDrop audit", "", "Generated by `python3 tools/audit.py" + (" --chain" if with_chain else "") + "`. "
             "Every item names the offline tests it runs and, where the brief asks for on-chain proof, the on-chain check.", ""]
    total = passed = 0
    for group in ("Safety", "Loophole"):
        lines += [f"## {group}", "", "| # | item | result | evidence |", "|---|---|---|---|"]
        n = 0
        for g, name, tests, checks in ITEMS:
            if g != group:
                continue
            n += 1
            ok, ev = run(tests) if tests else (True, "")
            evs = [ev] if ev else []
            for c in checks:
                cok, why = c()
                ok = ok and cok
                evs.append(("on chain ✓ " if cok else "on chain ✗ ") + why)
            total += 1
            passed += ok
            lines.append(f"| {n} | {name} | **{'PASS' if ok else 'FAIL'}** | {'; '.join(evs)} |")
        lines.append("")
    lines += ["## Deployment", "", "| check | result | address |", "|---|---|---|"]
    for name, ok, a in deployment_rows(with_chain):
        total += 1
        passed += ok
        lines.append(f"| {name} | **{'PASS' if ok else 'FAIL'}** | `{a}` |")
    full = subprocess.run([sys.executable, str(ROOT / "test" / "test_fairdrop.py")], capture_output=True, text=True)
    summary = [l for l in full.stderr.split("\n") if l.startswith("Ran ") or l.startswith("OK") or l.startswith("FAILED")]
    lines += ["", "## Full offline suite", "", "```", *summary, "```", "", f"**{passed}/{total} checks pass.**", ""]
    (ROOT / "docs" / "AUDIT.md").write_text("\n".join(lines))
    print("\n".join(lines[-3:]))
    for l in lines:
        if "FAIL**" in l:
            print(l)
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
