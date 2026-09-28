"""Shared fixtures for the FairDrop offline suite: a World that drives the
contract through the stub, a flagged-list merkle tree built independently of
the contract, rules documents, and Blockscout-shaped history fixtures whose
field names are copied from live responses (docs/probe/)."""
import copy
import hashlib
import json
import random
from datetime import datetime, timezone
from pathlib import Path

import stub
from stub import (MESSAGE, WEB, MODEL, FORGE, LAST_CONSENSUS, TRANSFERS,
                  BALANCES, _Addr)

stub._install_stub()

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "contracts" / "FairDrop.py"
REGISTRY_SOURCE = ROOT / "contracts" / "FairDropRegistry.py"
MOD = stub.load_full(SOURCE, "fairdrop_full")
C = MOD
SRC = SOURCE.read_text(encoding="utf8")

GEN = 10 ** 18
DAY = 86400
T0 = 1790596800  # 2026-09-28T12:00:00Z

OWNER = _Addr("0x" + "a" * 40)
OPERATOR = _Addr("0x" + "0" * 39 + "1")
OPERATOR2 = _Addr("0x" + "0" * 39 + "2")
STRANGER = _Addr("0x" + "5" * 40)
NOBODY = _Addr("0x" + "6" * 40)


def addr(i: int) -> _Addr:
    return _Addr("0x" + format(0xB000 + i, "040x"))


ALICE = addr(1)
BOB = addr(2)
CAROL = addr(3)
DAVE = addr(4)
ERIN = addr(5)
FRANK = addr(6)
NOT_FLAGGED = addr(99)


def iso(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def set_now(ts: int) -> None:
    MESSAGE.raw["datetime"] = iso(ts)


# --- merkle, written independently of the contract ---------------------------


def h(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


def leaf(a) -> bytes:
    return h(b"\x00" + bytes.fromhex(str(a).lower()[2:]))


def build_tree(wallets):
    """(root_hex, {wallet_lower: [sibling_hex...]}) over the wallets in
    ASCENDING lowercase order (the order the contract publishes them in), with
    sorted-pair nodes and an odd node carried up unchanged."""
    wallets = sorted({str(w).lower() for w in wallets})
    level = [leaf(w) for w in wallets]
    paths = {str(w).lower(): [] for w in wallets}
    index = {str(w).lower(): i for i, w in enumerate(wallets)}
    if not level:
        return ("00" * 32, paths)
    while len(level) > 1:
        nxt = []
        for i in range(0, len(level), 2):
            if i + 1 < len(level):
                a, b = level[i], level[i + 1]
                nxt.append(h(b"\x01" + (a + b if a <= b else b + a)))
            else:
                nxt.append(level[i])
        for w, pos in list(index.items()):
            sib = pos ^ 1
            if sib < len(level):
                paths[w].append(level[sib].hex())
            index[w] = pos // 2
        level = nxt
    return (level[0].hex(), paths)


# --- rules ---------------------------------------------------------------------


def canon(doc: dict) -> str:
    """Canonical rules JSON, written with the standard library - independent of
    the contract's hand-built `_canon_rules`, which a test proves equal."""
    return json.dumps({"min_hits": doc["min_hits"],
                       "rules": [{"condition": r["condition"],
                                  "finding": r["finding"],
                                  "threshold": r["threshold"]}
                                 for r in doc["rules"]]},
                      sort_keys=True, separators=(",", ":"))


def commit(doc: dict, salt: str) -> str:
    return hashlib.sha256((canon(doc) + salt).encode()).hexdigest()


SALT = "5a" * 16
SALT2 = "c3" * 20

SYBIL_RULES = {"min_hits": 2, "rules": [
    {"finding": "WALLET_AGE_DAYS", "condition": "LT", "threshold": 60},
    {"finding": "SCRIPTED_REPETITION", "condition": "GTE", "threshold": "SOME"},
    {"finding": "DISTINCT_CONTRACTS_TOUCHED", "condition": "LTE", "threshold": 2},
    {"finding": "SINGLE_PURPOSE_FARMING", "condition": "EQ", "threshold": "STRONG"},
]}

# --- history fixtures (field names from live Blockscout responses) -----------

FUNDER = "0x" + "fd" * 20
PROTO = "0x" + "3c" * 20


def v2_item(wallet, ts, to=None, is_contract=True, name=None, method="swap",
            value=0, status="ok", sender=None):
    return {
        "hash": "0x" + hashlib.sha256(f"{wallet}{ts}{to}{method}".encode()).hexdigest(),
        "timestamp": iso(ts)[:-1] + ".000000Z",
        "from": {"hash": str(sender or wallet), "is_contract": False},
        "to": None if to == "create" else {
            "hash": str(to or ("0x" + format(ts % (16 ** 40), "040x"))),
            "is_contract": is_contract, "name": name},
        "block_number": int(ts) // 2,
        "method": method, "value": str(value), "status": status,
        "result": "success" if status == "ok" else "error",
    }


def first_item(wallet, ts, sender=None, to=None, value=0, sender_name=None,
               sender_contract=False):
    """One item of the ascending v2 page (mixed in and out), with the sender's
    public label inline, as v2 serves it."""
    it = v2_item(wallet, ts, to=to or wallet, value=value, sender=sender)
    it["from"]["name"] = sender_name
    it["from"]["is_contract"] = sender_contract
    if to is None and sender is None:
        it["to"] = {"hash": PROTO, "is_contract": True, "name": None}
    return it


def serve_first(items, next_page=None):
    WEB.serve("first", 200, json.dumps({"items": items, "next_page_params": next_page}))


def serve_history(wallet, outs, first_ts=None, funder=FUNDER,
                  funder_label="Coinbase 1", funder_contract=False,
                  full_page=False, next_page=None, extra_first=None):
    """Serve one wallet's history on both v2 lanes.

    `outs` are (ts, to, is_contract, name, method, value) tuples, any order.
    The outbound page is newest first and truncated to 50; the earliest page
    is oldest first, mixed, truncated to 50 - as the explorer serves them."""
    w = str(wallet)
    items = [v2_item(w, *o) for o in outs]
    items.sort(key=lambda i: i["timestamp"], reverse=True)
    page = items[:50]
    npp = next_page
    if npp is None and (full_page or len(items) >= 50):
        npp = {"index": 1}
    WEB.serve("out", 200, json.dumps({"items": page, "next_page_params": npp}))
    if first_ts is None:
        first_ts = min([o[0] for o in outs]) - 3 * DAY if outs else T0 - 400 * DAY
    first = []
    if funder:
        first.append(first_item(w, first_ts, sender=funder, to=w, value=10 ** 17,
                                sender_name=funder_label,
                                sender_contract=funder_contract))
    for o in sorted(outs, key=lambda o: o[0]):
        first.append(first_item(w, o[0], to=o[1] if o[1] != "create" else PROTO))
    fnext = {"index": 2} if len(first) > 50 else None
    first = first[:50]
    if extra_first is not None:
        first = extra_first
    serve_first(first, fnext)


def human_outs(snap, n=8):
    """A spread-out, varied history ending well before the snapshot."""
    out = []
    for i in range(n):
        out.append((snap - (30 + i * 47) * DAY - i * 3607,
                    "0x" + format(0xC0DE00 + i, "040x"), True,
                    ["Uniswap", "Aave", "ENS", "Zora", "Safe", "Curve"][i % 6],
                    ["swap", "supply", "register", "mint", "execTransaction",
                     "exchange"][i % 6], (i + 1) * 10 ** 15))
    return out


def farm_outs(snap, n=6):
    """Near-identical calls to the protocol's one contract, daily, just before
    the snapshot."""
    return [(snap - (n - i) * DAY, PROTO, True, "FarmTarget", "mintNFTs", 0)
            for i in range(n)]


class World:
    """A fresh contract and a fresh network for every test."""

    def __init__(self, demo=False, contest=None, stall=None, min_phase=None):
        WEB.reset()
        MODEL.reset()
        FORGE["payload"] = None
        FORGE["leader_dies"] = False
        FORGE["mutate"] = None
        TRANSFERS.clear()
        BALANCES.clear()
        MESSAGE.value = 0
        set_now(T0)
        MESSAGE.sender_address = OWNER
        if demo:
            self.c = MOD.FairDrop(True, contest or 180, stall or 240,
                                  min_phase or 30)
        else:
            self.c = MOD.FairDrop()
        self.now = T0
        self.deposited = 0
        self.ops = 0
        self.infos = {}
        self.undetermined = 0

    # --- driving ------------------------------------------------------------

    def at(self, ts):
        self.now = int(ts)
        set_now(self.now)
        return self

    def later(self, secs):
        return self.at(self.now + int(secs))

    def call(self, who, name, *args, value=0):
        """One transaction. A consensus round that does not settle rolls the
        WHOLE transaction back (UNDETERMINED on chain): nothing is written and
        the value never arrives."""
        MESSAGE.sender_address = who
        MESSAGE.value = int(value)
        before = copy.deepcopy(self.c)
        try:
            out = getattr(self.c, name)(*args)
        except stub._Rolled as e:
            self.c = before
            self.ops += 1
            self.undetermined += 1
            self.check_ledger()
            return {"status": "UNDETERMINED", "reason": e.args[0] if e.args else ""}
        finally:
            MESSAGE.value = 0
        self.deposited += int(value)
        self.ops += 1
        self.check_ledger()
        return out

    def view(self, name, *args):
        out = getattr(self.c, name)(*args)
        return json.loads(out) if isinstance(out, str) else out

    # --- invariants ------------------------------------------------------------

    def check_ledger(self):
        c = self.c
        bal = int(c.balance_wei)
        locked = int(c.locked_wei)
        payable = int(c.payable_wei)
        assert bal == locked + payable, (bal, locked, payable)
        assert payable == sum(int(v) for v in c.payout_wei.values()), "payable"
        held = 0
        for d in c.drops:
            held += int(d.reserve_wei) + int(d.held_bonds_wei)
        assert locked == held, ("locked", locked, held)
        assert bal + sum(v for _, v in TRANSFERS) == self.deposited, "conservation"
        for v in (bal, locked, payable):
            assert v >= 0

    def drain(self):
        """Every holder claims; the books must end at zero."""
        for k in list(self.c.payout_wei.keys()):
            if int(self.c.payout_wei.get(k) or 0) > 0:
                self.call(_Addr(k), "claim_payout")
        assert int(self.c.balance_wei) == 0
        assert int(self.c.locked_wei) == 0
        assert int(self.c.payable_wei) == 0

    # --- a drop ---------------------------------------------------------------

    def drop(self, flagged=(ALICE, BOB, CAROL), rules=SYBIL_RULES, salt=SALT,
             operator=OPERATOR, lead=100, lookback_days=900, appeal=3 * DAY,
             reveal=2 * DAY, alloc=GEN // 2, bond=GEN // 10, reserve=2 * GEN,
             chain="base", protocol="FarmProto", contracts=PROTO,
             commit_now=True):
        snap = self.now + lead
        out = self.call(operator, "create_drop", "Test drop", chain,
                        commit(rules, salt), snap, lookback_days, appeal,
                        reveal, alloc, bond, len(canon(rules)), len(rules["rules"]),
                        protocol, contracts, value=reserve)
        assert out["status"] == "OK", out
        info = {"id": out["drop_id"], "snap": snap, "appeal_end": snap + appeal,
                "reveal_end": snap + appeal + reveal, "rules": rules,
                "salt": salt, "operator": operator, "alloc": alloc,
                "bond": bond, "reserve": reserve,
                "lookback": snap - lookback_days * DAY}
        root, paths = build_tree(list(flagged))
        info["root"] = root
        info["proofs"] = paths
        info["flagged"] = sorted({str(w).lower() for w in flagged})
        self.infos[info["id"]] = info
        if commit_now:
            self.at(snap + 1)
            r = self.call(operator, "publish_flagged", info["id"],
                          ",".join(info["flagged"]), True)
            assert r["status"] == "OK", r
            assert r["flagged_root"] == root, (r, root)
        return info

    def proof(self, info, wallet):
        return ",".join(info["proofs"].get(str(wallet).lower(), []))

    def file(self, info, wallet, sender=None, value=None, statement="I am a person."):
        return self.call(sender or wallet, "file_appeal", info["id"],
                         str(wallet), self.proof(info, wallet), statement,
                         value=info["bond"] if value is None else value)

    def reveal(self, info, rules=None, salt=None):
        return self.call(info["operator"], "reveal_rules", info["id"],
                         canon(rules or info["rules"]), salt or info["salt"])

    def ensure_revealed(self, drop_id):
        """Reads run after the reveal: jump past the appeal window and reveal
        the committed rules if that has not happened yet."""
        info = self.infos[drop_id]
        if not self.drop_view(info)["revealed"]:
            self.at(max(self.now, info["appeal_end"] + 1))
            r = self.reveal(info)
            assert r["status"] == "OK", r
        return info

    def read(self, aid, who=None, reveal=True):
        """One read_wallet call, after revealing the drop's rules if needed
        (reads need the rules)."""
        who = who or STRANGER
        a = self.view("get_appeal", aid)
        if a.get("found") and reveal:
            self.ensure_revealed(a["appeal"]["drop_id"])
        return self.call(who, "read_wallet", aid)

    def split(self, aid, leader, validator, who=None):
        """One settle_stalled round in which the leader's model reads
        `leader` and the validator's reads `validator` (dicts of findings)."""
        MODEL.reset()
        base = dict(MODEL.answer)
        MODEL.queue = [dict(base, **leader), dict(base, **validator)]
        out = self.call(who or STRANGER, "settle_stalled", aid)
        MODEL.reset()
        return out

    def appeal(self, aid):
        return self.view("get_appeal", aid)["appeal"]

    def drop_view(self, info):
        return self.view("get_drop", info["id"])["drop"]


def rng(seed):
    return random.Random(seed)
