"""Settings from the environment, with .env.local at the repo root loaded first (never committed)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from . import paths


def _load_env_file() -> None:
    f = paths.ROOT / ".env.local"
    if not f.exists():
        return
    for raw in f.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env_file()
# a key pasted into a host dashboard often carries a trailing newline or quotes; the Sandbox SDK reads the variable itself
if "NEBIUS_API_KEY" in os.environ:
    os.environ["NEBIUS_API_KEY"] = os.environ["NEBIUS_API_KEY"].strip().strip(chr(34)).strip(chr(39))

# USD per 1M tokens (input, output), from the Token Factory model catalog.
PRICES: dict[str, tuple[float, float]] = {
    "nvidia/Nemotron-3-Ultra-550b-a55b": (1.00, 3.00),
    "nvidia/nemotron-3-super-120b-a12b": (0.30, 0.90),
    "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B": (0.06, 0.24),
}


@dataclass(frozen=True)
class Settings:
    api_key: str = field(default_factory=lambda: os.environ.get("NEBIUS_API_KEY", "").strip().strip(chr(34)).strip(chr(39)), repr=False)
    project_id: str = field(default_factory=lambda: os.environ.get("NEBIUS_PROJECT_ID", ""))
    base_url: str = field(default_factory=lambda: os.environ.get(
        "TOKEN_FACTORY_BASE_URL", "https://api.tokenfactory.nebius.com/v1"))
    model_nano: str = field(default_factory=lambda: os.environ.get(
        "SS_MODEL_NANO", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"))
    model_super: str = field(default_factory=lambda: os.environ.get(
        "SS_MODEL_SUPER", "nvidia/nemotron-3-super-120b-a12b"))
    model_ultra: str = field(default_factory=lambda: os.environ.get(
        "SS_MODEL_ULTRA", "nvidia/Nemotron-3-Ultra-550b-a55b"))
    backend: str = field(default_factory=lambda: os.environ.get("SS_BACKEND", "local"))
    max_concurrency: int = field(default_factory=lambda: int(os.environ.get("SS_MAX_CONCURRENCY", "6")))
    run_budget_usd: float = field(default_factory=lambda: float(os.environ.get("SS_RUN_BUDGET_USD", "4")))

    def model(self, tier: str) -> str:
        return {"nano": self.model_nano, "super": self.model_super, "ultra": self.model_ultra}[tier]


def settings() -> Settings:
    return Settings()
