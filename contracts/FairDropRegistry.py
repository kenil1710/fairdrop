# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
import genlayer as gl
from genlayer import *
from dataclasses import dataclass
import json
import typing

# FairDropRegistry - the block any airdrop distributor copies.
#
# One question, asked before paying a flagged wallet: did this wallet win its
# FairDrop appeal? `is_cleared(wallet, drop_id)` answers it with a free
# cross-contract read of FairDrop and nothing else.
#
# CUSTODY: FALSE. There is no payable method in this file and no transfer
# anywhere in it. A registry that held funds would inherit every money rule
# FairDrop has; this one is a gate, so it holds nothing.
#
# `attest` is the only write. It records THAT a distributor checked a wallet
# and what FairDrop said at that moment, so a distributor can later prove it
# paid (or refused) on the strength of a final appeal outcome. It never raises.

MAX_ATTESTATIONS = 10000


def _as_int(v: typing.Any, default: int = 0) -> int:
    if isinstance(v, bool):
        return default
    if isinstance(v, int):
        return v
    if isinstance(v, str):
        t = v.strip()
        if t == "" or not t.isdigit() or len(t) > 30:
            return default
        return int(t)
    return default


def _is_addr(text: typing.Any) -> bool:
    t = str(text).strip()
    if len(t) != 42 or not t.startswith("0x"):
        return False
    for ch in t[2:]:
        if ch not in "0123456789abcdefABCDEF":
            return False
    return True


def _epoch_from_iso(value: typing.Any) -> int:
    if not isinstance(value, str) or len(value) < 19:
        return 0
    try:
        y = int(value[0:4])
        m = int(value[5:7])
        d = int(value[8:10])
        hh = int(value[11:13])
        mm = int(value[14:16])
        ss = int(value[17:19])
    except Exception:
        return 0
    y -= 1 if m <= 2 else 0
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return (era * 146097 + doe - 719468) * 86400 + hh * 3600 + mm * 60 + ss


@gl.contract.interface
class IFairDrop:
    class View:
        def is_cleared(self, wallet: str, drop_id: typing.Any) -> bool: ...

        def get_appeal_of(self, drop_id: typing.Any, wallet: str) -> typing.Any: ...

        def get_config(self) -> typing.Any: ...

    class Write:
        pass


@gl.storage.allow
@dataclass
class Attestation:
    wallet: Address
    drop_id: u32
    cleared: bool
    outcome: str
    appeal_id: u32
    asked_by: Address
    asked_at: u64


class FairDropRegistry(gl.contract.Contract):
    fairdrop: Address
    attestations: gl.storage.DynArray[Attestation]
    total_cleared: u256
    total_refused: u256

    def __init__(self, fairdrop_address: str):
        self.fairdrop = Address(str(fairdrop_address).strip())
        self.total_cleared = u256(0)
        self.total_refused = u256(0)

    def _fd(self) -> typing.Any:
        return IFairDrop(self.fairdrop)

    def _appeal(self, wallet: str, drop_id: typing.Any) -> dict:
        """The appeal as FairDrop reports it, or {"found": False}. Never
        raises: an unreachable FairDrop is reported, not thrown."""
        if not _is_addr(wallet):
            return {"found": False, "reason": "not an address"}
        try:
            raw = self._fd().view().get_appeal_of(_as_int(drop_id, 0),
                                                  str(wallet).strip())
            doc = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            return {"found": False, "reachable": False,
                    "reason": "FairDrop could not be read"}
        if not isinstance(doc, dict):
            return {"found": False, "reason": "unreadable answer"}
        return doc

    @gl.public.view
    def is_cleared(self, wallet: str, drop_id: typing.Any) -> bool:
        """True only for a FINAL HUMAN_PATTERN appeal. False for anything else,
        including a FairDrop that cannot be reached."""
        if not _is_addr(wallet):
            return False
        try:
            return bool(self._fd().view().is_cleared(str(wallet).strip(),
                                                     _as_int(drop_id, 0)))
        except Exception:
            return False

    @gl.public.view
    def get_appeal(self, wallet: str, drop_id: typing.Any) -> typing.Any:
        return json.dumps(self._appeal(wallet, drop_id))

    @gl.public.write
    def attest(self, wallet: str, drop_id: typing.Any) -> typing.Any:
        """Record what FairDrop says about this wallet right now."""
        if not _is_addr(wallet):
            return {"status": "REJECTED", "reason": "wallet must be a 0x address"}
        if len(self.attestations) >= MAX_ATTESTATIONS:
            return {"status": "REJECTED", "reason": "attestation log is full"}
        doc = self._appeal(wallet, drop_id)
        ap = doc.get("appeal") if isinstance(doc.get("appeal"), dict) else {}
        cleared = bool(ap.get("status") == "FINAL"
                       and ap.get("outcome") == "HUMAN_PATTERN")
        rec = self.attestations.append_new_get()
        rec.wallet = Address(str(wallet).strip())
        rec.drop_id = u32(_as_int(drop_id, 0))
        rec.cleared = cleared
        rec.outcome = str(ap.get("outcome", "")) if ap else ""
        rec.appeal_id = u32(_as_int(ap.get("appeal_id"), 0) if ap else 0)
        rec.asked_by = gl.message.sender_address
        rec.asked_at = u64(_epoch_from_iso(gl.message.raw.get("datetime", "")))
        if cleared:
            self.total_cleared = u256(int(self.total_cleared) + 1)
        else:
            self.total_refused = u256(int(self.total_refused) + 1)
        return {"status": "OK", "attestation_id": len(self.attestations),
                "cleared": cleared, "outcome": rec.outcome}

    @gl.public.view
    def get_attestation(self, attestation_id: typing.Any) -> typing.Any:
        i = _as_int(attestation_id, 0)
        if i < 1 or i > len(self.attestations):
            return json.dumps({"found": False})
        r = self.attestations[i - 1]
        return json.dumps({"found": True, "wallet": r.wallet.as_hex,
                           "drop_id": int(r.drop_id), "cleared": bool(r.cleared),
                           "outcome": str(r.outcome),
                           "appeal_id": int(r.appeal_id),
                           "asked_by": r.asked_by.as_hex,
                           "asked_at": int(r.asked_at)})

    @gl.public.view
    def get_config(self) -> typing.Any:
        return json.dumps({"fairdrop": self.fairdrop.as_hex, "custody": False,
                           "payable_methods": 0,
                           "attestations": len(self.attestations),
                           "cleared": int(self.total_cleared),
                           "refused": int(self.total_refused),
                           "cleared_means": "the wallet's FairDrop appeal is "
                           "FINAL with outcome HUMAN_PATTERN"})
