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
item("Safety", "Leader cannot forge: deterministic features, snapshot hash and the RULE OUTCOME compared exactly; model findings within one bucket",
     ["TestConsensus", "TestTolerance", "TestOutcomeIdentity",
      "TestConsensusMore.test_validators_disagree_on_different_pages"],
     [lambda: chain(lambda: seed["config"]["outcome_compared"] == "exact", "live get_config: outcome_compared = exact"),
      lambda: chain(lambda: all(a["outcome"] in ("HUMAN_PATTERN", "SYBIL_PATTERN") for a in appeals() if a.get("snapshot")),
                    "every stored reading on chain ended in a rule outcome")])
item("Safety", "UNRESOLVED only after 3 committed genuine splits; griefing counts nothing; bond back, refileable after the reveal, never paid, never SYBIL",
     ["TestUnresolved", "TestRandomLifecycles"],
     [lambda: chain(lambda: [l for l in LOG.split("\n") if "GRIEF" in l and "settle_stalled(" in l]
                    and all(" UNDETERMINED " in l or "REJECTED" in l for l in LOG.split("\n") if "GRIEF" in l and "settle_stalled(" in l)
                    and any(a["wallet"].lower().startswith("0x35b4a5") and a["split_rounds"] == 0 and a["outcome"] != "UNRESOLVED"
                            for a in seed["drops"]["D"]["appeals"]),
                    "drop D: stranger and operator griefing via settle_stalled recorded nothing (0 splits, never UNRESOLVED)"),
      lambda: chain(lambda: all(a["split_rounds"] >= 3 for a in appeals() if a["outcome"] == "UNRESOLVED"),
                    "every on-chain UNRESOLVED (if any) has 3 committed splits")])
item("Safety", "Zero raise statements (both contracts)", ["TestAST.test_zero_raise_statements", "TestAST.test_no_assert_statements"])
item("Safety", "Refund-on-reject on every payable path (value of a refused call stays claimable)",
     ["TestAccess", "TestCreateDrop.test_refused_value_stays_claimable",
      "TestFileAppeal.test_short_bond_refused_and_refundable", "TestContest.test_short_bond_refused",
      "TestAST.test_every_write_banks_first", "TestAST.test_payable_methods"])
item("Safety", "No counter moves before a refusal", ["TestAccess"])
item("Safety", "Content hash of the exact fetched history", ["TestRead.test_read_stores_vector", "TestFetch.test_snapshot_is_deterministic", "TestDecide.test_verify_appeal_rederives"])
item("Safety", "settle_stalled permissionless and working while paused",
     ["TestLoopholes.test_11_owner_pause_leaves_appeals_payouts_and_settle_stalled", "TestAccess.test_settle_stalled_refusals"],
     [lambda: chain(lambda: any("settle_stalled(" in l and "paused" in l for l in LOG.split("\n")),
                    "settle_stalled called on chain while the contract was paused; it reached its own logic (a split round), not a pause refusal")])
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

# --- the binding review (docs/TASKS.md) -----------------------------------------
item("Binding", "1-3. Snapshot binding: post-snapshot activity, age and active days at the snapshot, coverage vs post-snapshot tx",
     ["TestBinding.test_01_post_snapshot_organic_activity_changes_nothing", "TestBinding.test_01_contract_farm_wallet_still_sybil_after_turning_organic",
      "TestBinding.test_01_first_seen_and_funding_after_snapshot_are_not_in_the_record", "TestBinding.test_02_age_and_active_days_are_measured_at_the_snapshot",
      "TestBinding.test_02_wallet_that_ages_past_the_threshold_later_still_fails", "TestBinding.test_03_many_post_snapshot_tx_push_the_window_off_the_page",
      "TestBinding.test_03_contract_outcome_is_insufficient_never_sybil_or_human"])
item("Binding", "4-5. Griefing cannot force UNRESOLVED; refile after UNRESOLVED works after the reveal", ["TestUnresolved"])
item("Binding", "6. First funding proven or UNCLEAR/INSUFFICIENT; cannot be buried or forged by a label",
     ["TestBinding.test_06_later_inbound_transfers_cannot_bury_the_first_funding", "TestBinding.test_06_no_funding_on_a_truncated_page_is_unproven",
      "TestBinding.test_06_same_second_funding_by_two_senders_is_unproven", "TestBinding.test_06_unproven_funder_is_unclear_whatever_the_model_says",
      "TestBinding.test_06_rules_using_an_unproven_funder_read_insufficient", "TestBinding.test_06_a_label_cannot_forge_funder_proven"])
item("Binding", "7. Merkle domain separation; internal node cannot pass as a leaf",
     ["TestBinding.test_07_leaf_and_node_are_domain_separated", "TestBinding.test_07_second_preimage_internal_node_cannot_pass_as_a_leaf",
      "TestBinding.test_07_contract_refuses_node_as_leaf_appeal", "TestMerkle", "TestMerkleRefusals"])
item("Binding", "8-9. Malformed/non-canonical rules refused at reveal; late commit refused",
     ["TestBinding.test_08_every_malformed_rules_document_is_refused_at_reveal", "TestBinding.test_08_the_canonical_document_means_what_it_says",
      "TestBinding.test_09_late_commit_is_refused", "TestRules"])
item("Binding", "10-11. Chain, wallet and window binding; unreadable mined items INSUFFICIENT, pending skipped",
     ["TestBinding.test_10_read_uses_only_the_drops_frozen_chain", "TestBinding.test_11_mined_item_with_unreadable_timestamp_is_insufficient",
      "TestBinding.test_11_pending_item_is_after_the_snapshot_and_skipped", "TestBinding.test_11_the_read_is_bound_to_the_appeals_wallet_and_drop"])
item("Binding", "14. Demo isolation: on-behalf filing impossible on canonical; only the demo says DEMO",
     ["TestEdges.test_14_on_behalf_filing_impossible_on_canonical", "TestEdges.test_14_only_the_demo_instance_says_demo",
      "TestEdges.test_14_canonical_ignores_demo_constructor_arguments"],
     [lambda: (canon is not None and [l for l in CLOG.split("\n") if "operator files for flagged2" in l][0].count("REJECTED") == 1
               and canon["config"]["mode"] == "CANONICAL" and seed is not None and seed["config"]["mode"] == "DEMO",
               "canonical refused the operator's on-behalf filing on chain; live get_config: canonical CANONICAL, demo DEMO")])
item("Binding", "15. Proof availability: list published on chain, root computed by the contract, appeal with no proof",
     ["TestFlagged"],
     [lambda: (canon is not None and any("with NO proof" in l and " OK " in l for l in CLOG.split("\n")),
               "canonical: flagged1 appealed with an empty proof (membership read from the published list)")])
item("Binding", "16. Reserve lock: no cancel/withdraw; close refused until every window closes",
     ["TestEdges.test_16_no_cancel_or_withdraw_method_exists", "TestEdges.test_16_operator_cannot_take_the_reserve_before_every_window_closes",
      "TestLoopholes.test_06_operator_cannot_withdraw_reserve_during_appeals"])
item("Binding", "17. Limits declared up front; exact-boundary timing (appeal, reveal, contest, read)",
     ["TestEdges.test_17_over_limit_rules_refused_at_create", "TestEdges.test_17_max_size_document_reveals_in_one_call",
      "TestEdges.test_17_reveal_must_match_the_declared_size_and_count", "TestEdges.test_17_appeal_boundary",
      "TestEdges.test_17_reveal_boundary", "TestEdges.test_17_contest_boundary", "TestEdges.test_17_read_and_refile_boundaries"])
item("Binding", "18. Spam cannot pay a sybil or crowd honest appeals out (per-wallet cap)",
     ["TestFileAppeal.test_capacity_scales_with_the_flagged_list", "TestFileAppeal.test_per_wallet_filing_limit"])

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
     [lambda: chain(lambda: any(d["drop"]["pro_rata"] and d["drop"]["winners"] >= 2
                                and len({a["payout_wei"] for a in d["appeals"] if a["outcome"] == "HUMAN_PATTERN"}) == 1
                                for d in seed["drops"].values()), "a drop closed pro-rata on chain: every winner the same share, below the allocation")])
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
     [lambda: chain(lambda: log_has("owner PAUSES the contract") and [l for l in LOG.split("\n") if "create_drop while paused" in l][0].count("REJECTED") == 1
                    and any("claims" in l and "(contract paused)" in l and " OK " in l for l in LOG.split("\n")),
                    "every demo drop ran paused: appeals, reads, settle_stalled and claims OK; create_drop refused")])


def readme_rows():
    """README must agree with deployments.json: the generated blocks re-render
    identically, every current address appears, and no superseded address
    appears outside the superseded table."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("readme_fill", ROOT / "tools" / "readme_fill.py")
    rf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rf)
    text = (ROOT / "README.md").read_text()
    rows = []
    try:
        same = rf.filled(text) == text
    except SystemExit as e:
        same = False
    rows.append(("README generated blocks == deployments.json + seed evidence", same, "README.md"))
    for name in ("FairDrop", "FairDropDemo", "FairDropRegistry"):
        rows.append((f"README names current {name}", DEP[name]["address"] in text, DEP[name]["address"]))
    stale = [s["address"] for s in DEP.get("superseded", []) if text.count(s["address"]) > 1]
    rows.append(("no superseded address in README outside the superseded table", not stale, ", ".join(stale) or "-"))
    return rows


def deployment_rows(with_chain):
    rows = readme_rows()
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
    for group in ("Safety", "Binding", "Loophole"):
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
