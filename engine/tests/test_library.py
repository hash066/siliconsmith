"""Evidence library: manifests are consistent, tampering is detected, and the verifier fails a mutated design."""
import json
import shutil

import pytest

from siliconsmith import library

pytestmark = pytest.mark.skipif(not library.ROOT.exists(), reason="evidence/ not present")


def entries():
    return library.list_entries()


def test_every_entry_has_consistent_manifest_and_hashes():
    es = entries()
    assert len(es) >= 3
    for e in es:
        m = e.manifest
        assert m["schema"] == library.SCHEMA
        assert m["ladder"]["L3"] == "pass"  # an entry exists only for a node whose formal proof passed
        assert m["reproduce"] == f"siliconsmith verify-entry {e.id}"
        assert m["not_claimed"] and m["claims"]
        for row in library.check_integrity(e):
            assert row["ok"], (e.id, row)


def test_index_matches_manifests():
    index = json.loads((library.ROOT / "index.json").read_text(encoding="utf-8"))
    assert {i["id"] for i in index} == {e.id for e in entries()}


def test_tampering_is_detected(tmp_path):
    src = library.load_entry("xor-rotl12-chacha20")
    dst = tmp_path / "xor-rotl12-chacha20"
    shutil.copytree(src.dir, dst)
    (dst / "rtl.v").write_text((dst / "rtl.v").read_text() + "\n// edited\n", encoding="utf-8")
    bad = [r for r in library.check_integrity(library.load_entry(dst.name, tmp_path)) if not r["ok"]]
    assert [r["path"] for r in bad] == ["rtl.v"]


def test_verifier_fails_a_mutated_design(tmp_path):
    """Change the rotate amount in the RTL and refresh the hashes: lint still passes, the vector test and the proof must fail."""
    src = library.load_entry("xor-rotl12-chacha20")
    dst = tmp_path / "mut"
    shutil.copytree(src.dir, dst)
    rtl = (dst / "rtl.v").read_text()
    assert "12" in rtl or "20" in rtl
    mutated = rtl.replace("20", "19", 1) if "20" in rtl else rtl.replace("12", "11", 1)
    assert mutated != rtl
    (dst / "rtl.v").write_text(mutated, encoding="utf-8")
    m = json.loads((dst / "manifest.json").read_text())
    for a in m["artifacts"]:
        a["sha256"] = library.sha256(dst / a["path"])
    (dst / "manifest.json").write_text(json.dumps(m), encoding="utf-8")
    res = library.verify_entry(library.load_entry("mut", tmp_path), vectors=20_000, work=tmp_path / "w")
    status = {r["rung"]: r["status"] for r in res["rungs"]}
    assert status["integrity"] == "pass" and status["L2"] == "fail" and status["L3"] == "fail"
    assert res["reproduced"] is False


@pytest.mark.skipif(not __import__("os").environ.get("SS_SLOW"), reason="SS_SLOW=1 runs the full reproduction (~30 s)")
def test_full_reproduction_of_every_entry(tmp_path):
    for e in entries():
        assert library.verify_entry(e, vectors=200_000, work=tmp_path / e.id)["reproduced"], e.id
