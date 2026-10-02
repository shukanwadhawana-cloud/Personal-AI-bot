#!/usr/bin/env python3
"""Deterministic LLM provider chain for PAI agent (no live API calls).

Outputs one line per available provider:
  PROVIDER=<name> MODEL=<aider-model> BASE=<openai_base_or_empty> KEY_ENV=<env_var>

Environment (keys never printed):
  LLM_PROVIDER, LLM_PROVIDER_ORDER
  OPENROUTER_API_KEY, OPENROUTER_MODEL
  GEMINI_API_KEY / LLM_API_KEY
  GROQ_API_KEY, GROQ_MODEL
  MISTRAL_API_KEY, MISTRAL_MODEL
  DEEPSEEK_API_KEY, DEEPSEEK_MODEL
"""
from __future__ import annotations

import os
import re
import sys
from typing import List, Optional

DEFAULT_ORDER = ["openrouter", "gemini", "groq", "mistral", "deepseek"]

PROVIDER_SPEC = {
    "openrouter": (
        ["OPENROUTER_API_KEY"],
        "openai/{model}",
        "openrouter/free",
        "https://openrouter.ai/api/v1",
        "OPENROUTER_MODEL",
    ),
    "gemini": (
        ["GEMINI_API_KEY", "LLM_API_KEY"],
        "gemini/{model}",
        "gemini-3.6-flash",
        "",
        "GEMINI_MODEL",
    ),
    "groq": (
        ["GROQ_API_KEY"],
        "openai/{model}",
        "llama-3.3-70b-versatile",
        "https://api.groq.com/openai/v1",
        "GROQ_MODEL",
    ),
    "mistral": (
        ["MISTRAL_API_KEY"],
        "openai/{model}",
        "mistral-small-latest",
        "https://api.mistral.ai/v1",
        "MISTRAL_MODEL",
    ),
    "deepseek": (
        ["DEEPSEEK_API_KEY"],
        "openai/{model}",
        "deepseek-flash",
        "https://api.deepseek.com",
        "DEEPSEEK_MODEL",
    ),
}


def resolve_order(explicit: str, order_env: str) -> List[str]:
    explicit = (explicit or "auto").strip().lower()
    if explicit and explicit != "auto":
        return [explicit]
    raw = (order_env or "").strip()
    if raw:
        parts = [p.strip().lower() for p in raw.split(",") if p.strip()]
        return parts or list(DEFAULT_ORDER)
    return list(DEFAULT_ORDER)


def available_providers(
    explicit: Optional[str] = None,
    order_env: Optional[str] = None,
    environ: Optional[dict] = None,
) -> List[dict]:
    env = environ if environ is not None else os.environ
    order = resolve_order(
        explicit if explicit is not None else env.get("LLM_PROVIDER", "auto"),
        order_env if order_env is not None else env.get("LLM_PROVIDER_ORDER", ""),
    )
    out: List[dict] = []
    for name in order:
        if name not in PROVIDER_SPEC:
            continue
        key_cands, model_fmt, default_model, base, model_env = PROVIDER_SPEC[name]
        key_env = None
        for c in key_cands:
            if env.get(c):
                key_env = c
                break
        if not key_env:
            continue
        model_name = env.get(model_env) or default_model
        if name == "gemini":
            aider_model = (
                f"gemini/{model_name}"
                if not model_name.startswith("gemini/")
                else model_name
            )
        else:
            aider_model = model_fmt.format(model=model_name)
        out.append(
            {
                "name": name,
                "model": aider_model,
                "base": base,
                "key_env": key_env,
            }
        )
    return out


def classify_failure(text: str) -> str:
    t = (text or "").lower()
    if re.search(
        r"token limit|context length|context window|maximum context|max_tokens|"
        r"too many tokens|prompt is too long|maximum input|context_length",
        t,
    ):
        return "context"
    if re.search(
        r"\b429\b|rate.?limit|quota|resource_exhausted|capacity|insufficient_quota|"
        r"too many requests|overloaded|provider.?unavailable",
        t,
    ):
        return "quota"
    if re.search(r"auth|unauthorized|invalid.?api.?key|forbidden|401|403", t):
        return "auth"
    return "other"


def main(argv: List[str]) -> int:
    if len(argv) >= 2 and argv[1] == "--self-test":
        return _self_test()
    if len(argv) >= 3 and argv[1] == "--classify":
        print(classify_failure(argv[2]))
        return 0
    providers = available_providers()
    if not providers:
        print("PROVIDER_NONE", file=sys.stderr)
        return 2
    for p in providers:
        print(
            f"PROVIDER={p['name']} MODEL={p['model']} BASE={p['base']} KEY_ENV={p['key_env']}"
        )
    return 0


def _self_test() -> int:
    env = {"OPENROUTER_API_KEY": "x", "LLM_PROVIDER": "auto"}
    p = available_providers(environ=env)
    assert p[0]["name"] == "openrouter", p

    env = {"GEMINI_API_KEY": "g", "LLM_PROVIDER": "auto"}
    p = available_providers(environ=env)
    assert p[0]["name"] == "gemini", p

    env = {"GROQ_API_KEY": "g", "LLM_PROVIDER": "auto"}
    p = available_providers(environ=env)
    assert p[0]["name"] == "groq", p

    env = {"MISTRAL_API_KEY": "m", "LLM_PROVIDER": "auto"}
    p = available_providers(environ=env)
    assert p[0]["name"] == "mistral", p

    env = {"DEEPSEEK_API_KEY": "d", "LLM_PROVIDER": "auto"}
    p = available_providers(environ=env)
    assert p[0]["name"] == "deepseek", p

    env = {"OPENROUTER_API_KEY": "o", "DEEPSEEK_API_KEY": "d", "LLM_PROVIDER": "auto"}
    names = [x["name"] for x in available_providers(environ=env)]
    assert "groq" not in names and "mistral" not in names
    assert names[0] == "openrouter"

    env = {
        "OPENROUTER_API_KEY": "o",
        "GEMINI_API_KEY": "g",
        "LLM_PROVIDER": "gemini",
    }
    p = available_providers(environ=env)
    assert len(p) == 1 and p[0]["name"] == "gemini", p

    env = {
        "OPENROUTER_API_KEY": "o",
        "GROQ_API_KEY": "g",
        "LLM_PROVIDER": "auto",
        "LLM_PROVIDER_ORDER": "groq,openrouter",
    }
    p = available_providers(environ=env)
    assert [x["name"] for x in p] == ["groq", "openrouter"], p

    assert classify_failure("Model has hit a token limit!") == "context"
    assert classify_failure("Error 429 rate limit exceeded") == "quota"
    assert classify_failure("RESOURCE_EXHAUSTED") == "quota"
    assert classify_failure("invalid api key") == "auth"
    assert classify_failure("random boom") == "other"

    print("PROVIDER_SELECT_SELF_TEST=PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
