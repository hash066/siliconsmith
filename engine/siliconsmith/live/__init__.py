"""LIVE single-candidate Silicon pipeline: one instruction, proposed, implemented and verified in a Sandbox.

    from siliconsmith.live import run_live
    for event in run_live("w1", budget_usd=0.15, max_seconds=240):   # v2 event dicts, then a final `bundle`
        ...

See README.md for the endpoint contract. Heavy imports (openai, contree) happen only when a run starts.
"""

from .limits import (DEFAULT_BUDGET_USD, DEFAULT_SECONDS, HARD_MAX_BUDGET_USD, HARD_MAX_SECONDS, WORKLOADS,
                     LiveError)
from .pipeline import run_live

__all__ = ["run_live", "LiveError", "WORKLOADS", "DEFAULT_BUDGET_USD", "DEFAULT_SECONDS", "HARD_MAX_BUDGET_USD",
           "HARD_MAX_SECONDS"]
