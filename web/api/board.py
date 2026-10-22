"""Vercel Python function: Board checks (/api/board/*). Deterministic, no model. See api/_gateway.py."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _gateway import make_board_handler  # noqa: E402

handler = make_board_handler()
