"""Vercel Python function: Matter simulation (POST /api/matter/simulate). Deterministic, no model. See api/_gateway.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _gateway import make_matter_handler  # noqa: E402

handler = make_matter_handler()
