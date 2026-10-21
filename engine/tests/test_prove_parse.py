"""Yosys prints the counterexample as signed decimal then hex; negative values must still parse."""
import re

from siliconsmith.tools import verify

LOG = r"""
  \in_rs1          2045968811  79f301ab    01111001111100110000000110101011
  \in_rs2         -1193444705  b8dd7a9f    10111000110111010111101010011111
  \trigger                  1         1                                   1
"""


def test_counterexample_regex_handles_negative_decimals():
    src = open(verify.__file__, encoding="utf-8").read()
    pat = re.search(r're\.findall\((r"[^"]*in_[^"]*"), log\)', src).group(1)
    got = {k: int(h, 16) for k, h in re.findall(eval(pat), LOG)}
    assert got == {"rs1": 0x79F301AB, "rs2": 0xB8DD7A9F}
