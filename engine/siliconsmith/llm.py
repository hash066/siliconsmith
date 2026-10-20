"""Nemotron on Nebius Token Factory: tiered models, cost accounting, budget cap, validated JSON."""

from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass
from typing import TypeVar

from openai import OpenAI
from pydantic import BaseModel, ValidationError

from .config import PRICES, Settings
from .events import EventBus

T = TypeVar("T", bound=BaseModel)

MODEL_LABEL = {"nano": "nemotron-nano", "super": "nemotron-super", "ultra": "nemotron-ultra"}


class BudgetExceeded(RuntimeError):
    pass


class LLMError(RuntimeError):
    pass


@dataclass
class Reply:
    content: str
    reasoning: str
    tokens_in: int
    tokens_out: int
    cost_usd: float
    latency_ms: int


class Nemotron:
    def __init__(self, settings: Settings, bus: EventBus | None = None):
        if not settings.api_key:
            raise LLMError("NEBIUS_API_KEY is not set (put it in .env.local)")
        self.s = settings
        self.bus = bus
        self.client = OpenAI(base_url=settings.base_url, api_key=settings.api_key, timeout=300, max_retries=2)
        self._lock = threading.Lock()
        self.spent_usd = 0.0
        self.tokens = 0

    def chat(
        self,
        tier: str,
        role: str,
        messages: list[dict],
        *,
        think: bool,
        max_tokens: int = 8000,
        temperature: float = 0.4,
        node_id: str | None = None,
    ) -> Reply:
        with self._lock:
            if self.spent_usd >= self.s.run_budget_usd:
                raise BudgetExceeded(f"run budget ${self.s.run_budget_usd:.2f} reached")
        model = self.s.model(tier)
        t0 = time.monotonic()
        r = self.client.chat.completions.create(
            model=model, messages=messages, max_tokens=max_tokens, temperature=temperature,
            extra_body={"chat_template_kwargs": {"enable_thinking": think}},
        )
        dt = int((time.monotonic() - t0) * 1000)
        msg = r.choices[0].message
        extra = msg.model_extra or {}
        reasoning = getattr(msg, "reasoning_content", None) or extra.get("reasoning_content") or ""
        tin = r.usage.prompt_tokens if r.usage else 0
        tout = r.usage.completion_tokens if r.usage else 0
        pin, pout = PRICES.get(model, (1.0, 3.0))
        cost = (tin * pin + tout * pout) / 1e6
        with self._lock:
            self.spent_usd += cost
            self.tokens += tin + tout
        if self.bus:
            self.bus.emit("llm.call", node_id=node_id, model=MODEL_LABEL[tier], role=role,
                          tokens_in=tin, tokens_out=tout, cost_usd=round(cost, 6), latency_ms=dt)
        return Reply(content=msg.content or "", reasoning=reasoning, tokens_in=tin, tokens_out=tout,
                     cost_usd=cost, latency_ms=dt)

    def json(
        self,
        tier: str,
        role: str,
        messages: list[dict],
        schema: type[T],
        *,
        think: bool,
        node_id: str | None = None,
        max_tokens: int = 12000,
        attempts: int = 2,
    ) -> tuple[T, Reply]:
        """Ask for JSON matching `schema`; on parse/validation failure, show the model its error once."""
        msgs = list(messages)
        last_err = ""
        for _ in range(attempts):
            rep = self.chat(tier, role, msgs, think=think, node_id=node_id, max_tokens=max_tokens)
            try:
                return schema.model_validate(extract_json(rep.content)), rep
            except (ValueError, ValidationError) as e:
                last_err = str(e)[:1500]
                msgs = msgs + [
                    {"role": "assistant", "content": rep.content[-6000:]},
                    {"role": "user", "content": f"That was not valid JSON for the required schema:\n{last_err}\n"
                                                "Reply again with ONLY the corrected JSON object."},
                ]
        raise LLMError(f"{role}: model did not return valid JSON: {last_err}")


_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.S)


def extract_json(text: str) -> dict:
    """Pull the first complete JSON object out of a reply (fenced or bare)."""
    m = _FENCE.search(text)
    if m:
        return json.loads(m.group(1))
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in reply")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
    raise ValueError("unterminated JSON object in reply")
