"""
AI Market Analyzer — uses the Gemini REST API via httpx.
Supports: today, 5days, 1month, why, forecast
"""
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from utils.cache import cache

logger = logging.getLogger(__name__)

_GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.0-flash:generateContent"
)

# Whitelisted section.icon IDs that the frontend knows how to render. Any icon
# the model returns that isn't here is normalised to ``"chart"``.
VALID_SECTION_ICONS = {
    "chart", "rotate", "globe", "warning", "lightbulb",
    "activity", "zap", "calendar", "trending", "bar",
}


def _gemini_api_key() -> Optional[str]:
    key = os.getenv("GEMINI_API_KEY", "")
    if key and key != "your_gemini_api_key_here":
        return key
    return None


def _strip_code_fence(raw: str) -> str:
    """Remove ``` / ```json fences from a model response.

    The previous implementation used ``lines[1:]`` in BOTH branches of a
    ternary, so trailing fences were never dropped correctly. This version
    strips an optional opening fence (with optional language tag) and an
    optional trailing fence, then trims stray backticks.
    """
    text = raw.strip()
    if text.startswith("```"):
        # Drop the opening fence line (which may be ``` or ```json).
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1:]
        else:
            text = text[3:]
        # Drop a trailing ``` fence if present.
        text = text.rstrip()
        if text.endswith("```"):
            text = text[:-3]
    return text.strip()


def _sanitize_sections(result: Dict[str, Any]) -> None:
    """Ensure every section.icon is a known text ID the frontend can map."""
    for section in result.get("sections", []) or []:
        icon = (section.get("icon") or "").strip().lower()
        if icon not in VALID_SECTION_ICONS:
            section["icon"] = "chart"
        else:
            section["icon"] = icon


def _call_gemini(prompt: str, api_key: str, max_tokens: int = 2048) -> str:
    """Send a prompt to the Gemini REST API and return the text response."""
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": max_tokens,
        },
    }
    # Reuse a module-level client so connections are pooled across requests.
    t0 = time.perf_counter()
    with httpx.Client(timeout=45.0) as client:
        try:
            resp = client.post(
                _GEMINI_URL,
                params={"key": api_key},
                json=payload,
            )
            resp.raise_for_status()
        except Exception as exc:
            latency = time.perf_counter() - t0
            logger.error(
                "Gemini HTTP error after %.2fs tokens_requested=%d: %s",
                latency, max_tokens, exc,
            )
            raise
        latency = time.perf_counter() - t0
        logger.info(
            "Gemini call OK latency=%.2fs tokens_requested=%d status=%s",
            latency, max_tokens, resp.status_code,
        )
        data = resp.json()
        # Guard against empty / blocked responses from the safety filter.
        candidates = data.get("candidates") or []
        if not candidates:
            raise RuntimeError("Gemini returned no candidates (possibly blocked)")
        parts = candidates[0].get("content", {}).get("parts", [])
        if not parts:
            raise RuntimeError("Gemini returned an empty response")
        return parts[0].get("text", "")


def build_market_context(market_data: List[dict], news_articles: List[dict]) -> str:
    market_lines = []
    for idx in market_data:
        direction = "▲" if idx.get("change_pct", 0) > 0 else "▼"
        trend = idx.get("trend", "neutral").upper()
        market_lines.append(
            f"  - {idx['name']} ({idx['symbol']}): {idx.get('price', 0):,.2f} "
            f"{direction}{abs(idx.get('change_pct', 0)):.2f}% | "
            f"Open: {idx.get('open', 'N/A')} High: {idx.get('high', 'N/A')} Low: {idx.get('low', 'N/A')} | "
            f"Trend: {trend}"
        )

    news_lines = []
    for article in news_articles[:20]:
        impact = article.get("market_impact", "low")
        category = article.get("category", "Markets")
        news_lines.append(
            f"  [{impact.upper()} IMPACT][{category}] [{article['source']}] {article['title']} "
            f"(Sentiment: {article.get('sentiment_label', article.get('sentiment', 'Neutral'))})"
        )

    return (
        f"MARKET DATA:\n" + "\n".join(market_lines) +
        "\n\nFINANCIAL NEWS HEADLINES:\n" + "\n".join(news_lines)
    )


PERIOD_PROMPTS = {
    "today": "Analyze today's market performance. What drove today's movements? Focus on key movers and catalysts.",
    "5days": "Analyze the market trend over the past 5 trading days. Identify key themes, momentum shifts, and catalysts.",
    "1month": "Provide a comprehensive 1-month market analysis. Cover major trends, sector rotation, macro themes, and key events.",
    "why": "Explain WHY the market moved in this direction. Identify the primary catalysts, both fundamental and technical.",
    "forecast": "Based on current market data and news sentiment, provide an AI-powered market forecast. Include bullish/bearish scenarios, key levels to watch, and potential catalysts.",
}


def analyze_market(
    market_data: List[dict],
    news_articles: List[dict],
    period: str = "today",
    question: Optional[str] = None,
) -> Dict[str, Any]:
    _key_src = f"{period}_{len(market_data)}_{len(news_articles)}_{str(market_data[:2])}"
    cache_key = "ai_" + hashlib.md5(_key_src.encode()).hexdigest()[:16]
    cached = cache.get(cache_key)
    if cached:
        logger.info("AI market analysis cache HIT key=%s period=%s", cache_key, period)
        return cached

    api_key = _gemini_api_key()
    if not api_key:
        return generate_fallback_insight(market_data, news_articles, period)

    context = build_market_context(market_data, news_articles)
    task = question if (period == "why" and question) else PERIOD_PROMPTS.get(period, PERIOD_PROMPTS["today"])

    # NOTE: icon values use text IDs (not emoji) — the frontend maps these to Lucide React icons.
    prompt = f"""You are a senior financial market analyst at a top-tier investment bank. Analyze the following market data and news with institutional-grade insight.

{context}

Task: {task}

Respond ONLY with valid JSON in this exact format:
{{
  "title": "8-12 word headline summarizing the market situation",
  "sentiment": "bullish" or "bearish" or "neutral",
  "confidence": 0.0 to 1.0,
  "sections": [
    {{
      "id": "market_summary",
      "title": "Market Summary",
      "content": "2-3 paragraph professional analysis. Be specific about index levels, % changes, and catalysts.",
      "icon": "chart"
    }},
    {{
      "id": "sector_momentum",
      "title": "Sector Momentum",
      "content": "Which sectors are leading/lagging? What is the rotation story?",
      "icon": "rotate"
    }},
    {{
      "id": "macro_factors",
      "title": "Macro & Policy",
      "content": "RBI/Fed policy, inflation, GDP, global macro factors affecting markets.",
      "icon": "globe"
    }},
    {{
      "id": "risk_alerts",
      "title": "Risk Alerts",
      "content": "Key downside risks, warning signals, or concerns to watch.",
      "icon": "warning"
    }},
    {{
      "id": "opportunities",
      "title": "Opportunities",
      "content": "Bullish setups, potential catalysts, sectors to watch for upside.",
      "icon": "lightbulb"
    }}
  ],
  "key_factors": ["Factor 1", "Factor 2", "Factor 3", "Factor 4"],
  "bullish_signals": ["Signal 1", "Signal 2"],
  "bearish_signals": ["Signal 1", "Signal 2"]
}}

IMPORTANT: Return ONLY valid JSON. No markdown, no code fences, no backticks. Be factual and professional."""

    try:
        raw = _call_gemini(prompt, api_key, max_tokens=2048).strip()
        text = _strip_code_fence(raw)
        result = json.loads(text)
        result["generated_at"] = datetime.now(timezone.utc).isoformat()
        result["period"] = period
        _sanitize_sections(result)
        logger.info("Analysis OK — title: %s", result.get('title', '')[:60])
        cache.set(cache_key, result, ttl=300)
        return result
    except Exception as e:
        logger.error("Gemini API error: %s", e)
        return generate_fallback_insight(market_data, news_articles, period)


def generate_fallback_insight(market_data: List[dict], news_articles: List[dict], period: str) -> Dict[str, Any]:
    """Rule-based fallback when Gemini API is not configured."""
    if not market_data:
        return {
            "title": "Market Analysis Unavailable",
            "sentiment": "neutral",
            "confidence": 0.0,
            "period": period,
            "sections": [
                {
                    "id": "market_summary",
                    "title": "Market Summary",
                    "content": "Market data could not be fetched. Please check your connection and ensure the backend is running.",
                    "icon": "chart",
                }
            ],
            "key_factors": ["Data unavailable"],
            "bullish_signals": [],
            "bearish_signals": [],
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    import math
    valid_data = []
    for i in market_data:
        chg = i.get("change_pct")
        if chg is not None and not math.isnan(float(chg)):
            valid_data.append(i)

    gainers    = [i for i in valid_data if i.get("change_pct", 0) > 0]
    losers     = [i for i in valid_data if i.get("change_pct", 0) < 0]
    avg_change = sum(i.get("change_pct", 0) for i in valid_data) / len(valid_data) if valid_data else 0.0
    sentiment  = "bullish" if avg_change > 0.5 else ("bearish" if avg_change < -0.5 else "neutral")
    top_mover  = max(valid_data, key=lambda x: abs(x.get("change_pct", 0)), default={})

    summary = (
        f"Markets showed {'positive' if avg_change > 0 else 'negative'} momentum with an "
        f"average index move of {avg_change:+.2f}%. "
        f"{len(gainers)} indices gained while {len(losers)} declined. "
        f"{top_mover.get('name', 'The leading index')} was the biggest mover at "
        f"{top_mover.get('change_pct', 0):+.2f}%. "
        "Configure your GEMINI_API_KEY in backend/.env for full AI-powered analysis."
    )

    return {
        "title": f"Markets {'Rise' if avg_change > 0 else 'Fall'} — {abs(avg_change):.1f}% Avg Move",
        "sentiment": sentiment,
        "confidence": 0.5,
        "period": period,
        "sections": [
            {
                "id": "market_summary",
                "title": "Market Summary",
                "content": summary,
                "icon": "chart",
            },
            {
                "id": "sector_momentum",
                "title": "Sector Momentum",
                "content": f"{len(gainers)} indices advancing, {len(losers)} declining. Top mover: {top_mover.get('name', 'N/A')} at {top_mover.get('change_pct', 0):+.2f}%.",
                "icon": "rotate",
            },
        ],
        "key_factors": [
            f"{top_mover.get('name', 'Top index')}: {top_mover.get('change_pct', 0):+.2f}%",
            f"{len(gainers)} advancing, {len(losers)} declining",
            f"Avg market move: {avg_change:+.2f}%",
            "Add GEMINI_API_KEY for full AI analysis",
        ],
        "bullish_signals": [f"{g['name']}: +{g['change_pct']:.2f}%" for g in gainers[:2]],
        "bearish_signals": [f"{l['name']}: {l['change_pct']:.2f}%" for l in losers[:2]],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Stock-specific analysis (sibling to analyze_market above). Shares the same
# Gemini plumbing (_call_gemini / _strip_code_fence / _sanitize_sections) and
# emits the SAME output schema (AIInsight) so the frontend renders it unchanged.
# ──────────────────────────────────────────────────────────────────────────────
def _fmt_money(v: Any) -> str:
    """Compact currency formatter for market cap etc."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return "N/A"
    if n >= 1e12:
        return f"{n / 1e12:.2f}T"
    if n >= 1e9:
        return f"{n / 1e9:.2f}B"
    if n >= 1e6:
        return f"{n / 1e6:.2f}M"
    return f"{n:,.0f}"


def build_stock_context(quote: Optional[dict], info: Optional[dict], news_articles: List[dict]) -> str:
    """Build a single-stock context string for the model. Mirrors
    ``build_market_context`` but focuses on one equity."""
    info = info or {}
    quote = quote or {}

    direction = "▲" if quote.get("change_pct", 0) >= 0 else "▼"
    lines = [
        f"STOCK: {quote.get('name', info.get('name', 'Unknown'))} ({quote.get('symbol', info.get('symbol', '?'))})",
        f"  Price: {quote.get('price', 'N/A')} {quote.get('currency', '')} "
        f"{direction}{abs(quote.get('change_pct', 0)):.2f}% "
        f"(change {quote.get('change', 0):+.2f})",
        f"  Open: {quote.get('open', 'N/A')}  High: {quote.get('high', 'N/A')}  "
        f"Low: {quote.get('low', 'N/A')}  Volume: {quote.get('volume', 'N/A')}",
        f"  Sector: {info.get('sector', 'N/A')}  Industry: {info.get('industry', 'N/A')}",
        f"  Market Cap: {_fmt_money(info.get('market_cap'))}  "
        f"P/E (trailing): {info.get('trailing_pe', 'N/A')}  "
        f"Beta: {info.get('beta', 'N/A')}",
        f"  52-Week Range: {info.get('fifty_two_week_low', 'N/A')} – "
        f"{info.get('fifty_two_week_high', 'N/A')}",
    ]

    news_lines = []
    for article in news_articles[:12]:
        impact = article.get("market_impact", "low")
        news_lines.append(
            f"  [{impact.upper()} IMPACT][{article.get('source', '')}] {article.get('title', '')} "
            f"(Sentiment: {article.get('sentiment_label', article.get('sentiment', 'Neutral'))})"
        )

    news_block = "\n".join(news_lines) if news_lines else "  (no recent company-specific news found)"
    return "STOCK DATA:\n" + "\n".join(lines) + "\n\nRECENT COMPANY NEWS:\n" + news_block


STOCK_PERIOD_PROMPTS = {
    "today":    "Give a snapshot analysis of this stock's most recent trading session — price action, volume, and what likely drove today's move.",
    "5days":    "Analyze this stock's 5-day price action and momentum. Identify short-term trends, volume signals, and any catalysts.",
    "1month":   "Provide a 1-month analysis of this stock: trend, performance vs its sector, key levels, and notable events.",
    "why":      "Explain WHY this stock has moved the way it has recently. Identify the primary fundamental and technical catalysts.",
    "forecast": "Based on the data and news, give an AI-powered outlook for this stock: bullish/bearish scenarios, key price levels to watch, and risks.",
    "nextday":  "Predict this stock's behaviour for the NEXT trading session. Use today's price action, volume, news sentiment, technicals, and any pre-market catalysts. Give a directional call (up/down/sideways), estimated % move range, key price levels to watch, and top 3 catalysts. Be specific and actionable.",
}


def analyze_stock(
    symbol: str,
    quote: Optional[dict],
    info: Optional[dict],
    news_articles: List[dict],
    period: str = "today",
) -> Dict[str, Any]:
    """Stock-specific AI analysis. Same pipeline as ``analyze_market``:
    build context → Gemini → JSON → sanitize → cache, with a rule-based
    fallback when the key is missing or the call fails.
    """
    _key_src = f"stock_{symbol}_{period}_{str(quote)[:80]}_{len(news_articles)}"
    cache_key = "ai_stock_" + hashlib.md5(_key_src.encode()).hexdigest()[:16]
    cached = cache.get(cache_key)
    if cached:
        logger.info("AI stock analysis cache HIT key=%s symbol=%s period=%s", cache_key, symbol, period)
        return cached

    period = period if period in STOCK_PERIOD_PROMPTS else "today"
    name = (quote or {}).get("name") or (info or {}).get("name") or symbol

    api_key = _gemini_api_key()
    if not api_key:
        return _fallback_stock_insight(symbol, name, quote, info, news_articles, period)

    context = build_stock_context(quote, info, news_articles)
    task = STOCK_PERIOD_PROMPTS[period]

    # Next-day prediction uses a richer, prediction-specific JSON schema.
    if period == "nextday":
        prompt = f"""You are a quantitative equity strategist. Based on today's data and news, predict this stock's behaviour for the NEXT trading session. Be specific, data-driven, and honest about uncertainty.

{context}

Task: {task}

Respond ONLY with valid JSON in this exact format (no markdown, no code fences):
{{
  "title": "Short headline: next-day directional call for this stock (e.g. 'Reliance Likely Gaps Up — Bullish Momentum Intact')",
  "sentiment": "bullish" or "bearish" or "neutral",
  "confidence": 0.0 to 1.0 (your confidence in this prediction),
  "next_day_direction": "up" or "down" or "sideways",
  "expected_move_pct": "e.g. +0.5% to +1.8%  OR  -1.2% to -2.5%  OR  ±0.3%",
  "price_target_low": estimated low price for next session as a number (based on current price),
  "price_target_high": estimated high price for next session as a number,
  "key_support": key support level as a number,
  "key_resistance": key resistance level as a number,
  "sections": [
    {{
      "id": "prediction_summary",
      "title": "Next Day Outlook",
      "content": "2-3 sentence directional prediction. State clearly whether you expect the stock to open higher/lower and why. Mention the key price range and what to watch for confirmation.",
      "icon": "chart"
    }},
    {{
      "id": "catalysts",
      "title": "Key Catalysts to Watch",
      "content": "List the top 3-4 specific events, news items, or technical signals that will drive next-session price action. Be concrete.",
      "icon": "zap"
    }},
    {{
      "id": "risk_alerts",
      "title": "Downside Risks",
      "content": "What could invalidate this prediction? List 2-3 specific risks or scenarios that would flip the direction.",
      "icon": "warning"
    }},
    {{
      "id": "technical",
      "title": "Technical Levels",
      "content": "Support and resistance levels, trend alignment, volume context, and what price action pattern you are monitoring.",
      "icon": "activity"
    }}
  ],
  "key_factors": ["Factor 1", "Factor 2", "Factor 3"],
  "bullish_signals": ["Signal 1", "Signal 2"],
  "bearish_signals": ["Signal 1", "Signal 2"]
}}

IMPORTANT: Return ONLY valid JSON. No markdown. If unsure of exact price levels use the current price ± logical %. Be honest — say 'sideways' if the data is mixed. Do not fabricate catalyst events."""
    else:
        prompt = f"""You are a senior equity analyst at a top-tier investment bank. Analyze the following single stock with institutional-grade, actionable insight. Be specific about price levels, percentages, and catalysts. Be honest about uncertainty and do NOT fabricate facts not present in the data.

{context}

Task: {task}

Respond ONLY with valid JSON in this exact format (no markdown, no code fences):
{{
  "title": "8-12 word headline about this stock",
  "sentiment": "bullish" or "bearish" or "neutral",
  "confidence": 0.0 to 1.0,
  "sections": [
    {{
      "id": "market_summary",
      "title": "Stock Snapshot",
      "content": "2-3 paragraph professional analysis. Be specific about the current price, % change, volume, and today's catalysts.",
      "icon": "chart"
    }},
    {{
      "id": "fundamentals",
      "title": "Fundamentals",
      "content": "Sector, industry, P/E, market cap, 52-week range positioning, and what the valuation implies.",
      "icon": "bar"
    }},
    {{
      "id": "technical",
      "title": "Technical Outlook",
      "content": "Trend, momentum, key support/resistance levels, volume signals.",
      "icon": "activity"
    }},
    {{
      "id": "risk_alerts",
      "title": "Risk Alerts",
      "content": "Key downside risks, warning signals, and concerns to watch.",
      "icon": "warning"
    }},
    {{
      "id": "opportunities",
      "title": "Opportunities",
      "content": "Bullish setups, potential catalysts, and upside scenarios.",
      "icon": "lightbulb"
    }}
  ],
  "key_factors": ["Factor 1", "Factor 2", "Factor 3", "Factor 4"],
  "bullish_signals": ["Signal 1", "Signal 2"],
  "bearish_signals": ["Signal 1", "Signal 2"]
}}

IMPORTANT: Return ONLY valid JSON. No markdown, no backticks. If a data field is N/A, say so — do not invent numbers. Be factual and professional."""

    try:
        raw = _call_gemini(prompt, api_key, max_tokens=2048).strip()
        text = _strip_code_fence(raw)
        result = json.loads(text)
        result["generated_at"] = datetime.now(timezone.utc).isoformat()
        result["period"] = period
        _sanitize_sections(result)
        # For nextday, ensure numeric fields are present even if model omitted them
        if period == "nextday":
            price = float((quote or {}).get("price") or 0)
            result.setdefault("next_day_direction", result.get("sentiment", "neutral"))
            result.setdefault("expected_move_pct", "±1–2%")
            result.setdefault("price_target_low",  round(price * 0.99, 2))
            result.setdefault("price_target_high", round(price * 1.01, 2))
            result.setdefault("key_support",     round(price * 0.975, 2))
            result.setdefault("key_resistance",  round(price * 1.025, 2))
        logger.info("Stock analysis OK — %s: %s", symbol, result.get("title", "")[:60])
        cache.set(cache_key, result, ttl=300)
        return result
    except Exception as exc:
        logger.error("Stock Gemini error for %s: %s", symbol, exc)
        return _fallback_stock_insight(symbol, name, quote, info, news_articles, period)


def _fallback_stock_insight(
    symbol: str,
    name: str,
    quote: Optional[dict],
    info: Optional[dict],
    news_articles: List[dict],
    period: str,
) -> Dict[str, Any]:
    """Rule-based stock analysis when Gemini is unavailable."""
    quote = quote or {}
    info = info or {}
    change_pct = quote.get("change_pct", 0) or 0
    price = float(quote.get("price") or 0)
    sentiment = "bullish" if change_pct > 0.5 else ("bearish" if change_pct < -0.5 else "neutral")
    direction = "up" if change_pct >= 0 else "down"

    pos_news = [a for a in news_articles if a.get("sentiment") == "positive"]
    neg_news = [a for a in news_articles if a.get("sentiment") == "negative"]
    news_note = (
        f"{len(news_articles)} recent news items scanned. "
        + (news_articles[0].get("title", "") if news_articles else "No recent company news found.")
    )

    # ── Next-day specific fallback ────────────────────────────────────────────
    if period == "nextday":
        pos_count, neg_count = len(pos_news), len(neg_news)
        nd_sentiment = (
            "bullish" if pos_count > neg_count + 1 else
            "bearish" if neg_count > pos_count + 1 else
            sentiment  # inherit from today's move
        )
        nd_direction = "up" if nd_sentiment == "bullish" else ("down" if nd_sentiment == "bearish" else "sideways")
        beta = float(info.get("beta") or 1.0)
        expected_low  = round(price * (1 - 0.01 * beta), 2) if price else 0
        expected_high = round(price * (1 + 0.01 * beta), 2) if price else 0
        move_sign = "+" if nd_direction == "up" else ("-" if nd_direction == "down" else "±")
        return {
            "title": f"{name} — Next Day {nd_direction.capitalize()} ({nd_sentiment.capitalize()}) · Rule-Based",
            "sentiment": nd_sentiment,
            "confidence": 0.40,
            "period": "nextday",
            "next_day_direction": nd_direction,
            "expected_move_pct": f"{move_sign}0.5% to {move_sign}{beta:.1f}%",
            "price_target_low":  expected_low,
            "price_target_high": expected_high,
            "key_support":    round(price * 0.975, 2) if price else 0,
            "key_resistance": round(price * 1.025, 2) if price else 0,
            "sections": [
                {
                    "id": "prediction_summary",
                    "title": "Next Day Outlook",
                    "content": (
                        f"Rule-based projection for {name}: sentiment is {nd_sentiment} based on "
                        f"{pos_count} positive vs {neg_count} negative news signals and today's "
                        f"{change_pct:+.2f}% move. "
                        f"Estimated range: {expected_low} – {expected_high} {quote.get('currency', '')}. "
                        "Add GEMINI_API_KEY in backend/.env for a full AI-powered next-day prediction."
                    ),
                    "icon": "chart",
                },
                {
                    "id": "catalysts",
                    "title": "Key Catalysts to Watch",
                    "content": (
                        "\n".join(
                            [f"• {a['title']}" for a in (pos_news + neg_news)[:4]]
                        ) or "No significant company-specific news found."
                    ),
                    "icon": "zap",
                },
                {
                    "id": "risk_alerts",
                    "title": "Downside Risks",
                    "content": (
                        "\n".join([f"• {a['title']}" for a in neg_news[:3]])
                        or "No negative signals detected in available news."
                    ),
                    "icon": "warning",
                },
            ],
            "key_factors": [
                f"Today's move: {change_pct:+.2f}%",
                f"News sentiment: {pos_count} positive, {neg_count} negative",
                f"Beta: {beta:.2f} (expected daily volatility)",
                "Configure GEMINI_API_KEY for full AI prediction",
            ],
            "bullish_signals": [a["title"] for a in pos_news[:2]],
            "bearish_signals": [a["title"] for a in neg_news[:2]],
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    # ── Standard fallback (all other periods) ─────────────────────────────────
    summary = (
        f"{name} ({symbol}) traded {direction} {abs(change_pct):.2f}% to "
        f"{quote.get('price', 'N/A')} {quote.get('currency', '')}. "
        f"Day range: {quote.get('low', 'N/A')} – {quote.get('high', 'N/A')}. "
        f"{info.get('sector', '')} / {info.get('industry', '')} name "
        f"with market cap {_fmt_money(info.get('market_cap'))}. "
        f"{news_note} "
        "Configure GEMINI_API_KEY for full AI-powered stock analysis."
    )

    return {
        "title": f"{name} {direction.capitalize()} {abs(change_pct):.2f}% — Rule-Based View",
        "sentiment": sentiment,
        "confidence": 0.45,
        "period": period,
        "sections": [
            {
                "id": "market_summary",
                "title": "Stock Snapshot",
                "content": summary,
                "icon": "chart",
            },
            {
                "id": "fundamentals",
                "title": "Fundamentals",
                "content": (
                    f"Sector: {info.get('sector') or 'N/A'}. Industry: {info.get('industry') or 'N/A'}. "
                    f"P/E (trailing): {info.get('trailing_pe') or 'N/A'}. "
                    f"52W range: {info.get('fifty_two_week_low', 'N/A')} – {info.get('fifty_two_week_high', 'N/A')}. "
                    f"Beta: {info.get('beta', 'N/A')}."
                ),
                "icon": "bar",
            },
        ],
        "key_factors": [
            f"{name}: {change_pct:+.2f}% today",
            f"Sector: {info.get('sector', 'N/A')}",
            f"{len(pos_news)} positive vs {len(neg_news)} negative news items",
            "Add GEMINI_API_KEY for full AI analysis",
        ],
        "bullish_signals": [a["title"] for a in pos_news[:2]],
        "bearish_signals": [a["title"] for a in neg_news[:2]],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
