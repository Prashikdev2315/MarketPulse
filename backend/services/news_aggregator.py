import feedparser
import hashlib
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Dict, List, Optional
from utils.cache import cache

logger = logging.getLogger(__name__)

# ── Strictly financial RSS feeds only ───────────────────────────────────────
RSS_FEEDS = [
    # India — markets specific
    {"url": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",     "source": "Economic Times",    "country": "IN",     "weight": 3},
    {"url": "https://www.livemint.com/rss/markets",                                     "source": "Mint Markets",       "country": "IN",     "weight": 3},
    {"url": "https://www.business-standard.com/rss/markets-106.rss",                   "source": "Business Standard", "country": "IN",     "weight": 3},
    {"url": "https://www.financialexpress.com/market/feed/",                            "source": "Financial Express",  "country": "IN",     "weight": 2},
    {"url": "https://economictimes.indiatimes.com/prime/economy-and-policy/rssfeeds/63703541.cms", "source": "ET Economy", "country": "IN", "weight": 2},
    # Global / US
    {"url": "https://news.google.com/rss/search?q=site:reuters.com&hl=en-US&gl=US&ceid=US:en", "source": "Reuters", "country": "GLOBAL", "weight": 3},
    {"url": "https://www.cnbc.com/id/100727362/device/rss/rss.html",                   "source": "CNBC Markets",      "country": "US",     "weight": 3},
    {"url": "https://finance.yahoo.com/news/rssindex",                                 "source": "Yahoo Finance",     "country": "GLOBAL", "weight": 2},
    {"url": "https://www.cnbc.com/id/10000664/device/rss/rss.html",                    "source": "CNBC Economy",      "country": "GLOBAL", "weight": 2},
    # UK
    {"url": "https://feeds.bbci.co.uk/news/business/rss.xml",                           "source": "BBC Business",      "country": "GB",     "weight": 3},
    # Japan
    {"url": "https://asia.nikkei.com/rss/feed/nar",                                     "source": "Nikkei Asia",       "country": "JP",     "weight": 3},
]

# ── Financial relevance keyword scoring ─────────────────────────────────────
HIGH_WEIGHT_KEYWORDS = {
    "nifty", "sensex", "banknifty", "nsei", "bsesn",
    "stock", "stocks", "equity", "equities",
    "market", "markets", "trading", "trader",
    "ipo", "listing", "earnings", "quarterly", "results",
    "gdp", "inflation", "cpi", "wpi",
    "rbi", "sebi", "fed", "fomc",
    "interest rate", "repo rate", "rate hike", "rate cut",
    "bond", "yield", "treasury",
    "fii", "dii", "fpi", "institutional",
    "mutual fund", "etf", "index fund",
    "merger", "acquisition", "buyout",
    "revenue", "profit", "loss", "ebitda",
    "nasdaq", "s&p", "dow jones", "ftse", "nikkei",
    "shanghai", "csi", "hang seng", "china",
    "crude", "brent", "gold", "silver", "commodity",
    "rupee", "dollar", "euro", "forex", "currency",
    "cryptocurrency", "bitcoin", "ethereum", "crypto",
}

MEDIUM_WEIGHT_KEYWORDS = {
    "economy", "economic", "fiscal", "monetary",
    "sector", "industry", "banking", "pharma", "it sector",
    "growth", "recession", "slowdown", "recovery",
    "export", "import", "trade deficit", "current account",
    "investment", "capital", "fund",
    "company", "corporate", "business",
    "dividend", "buyback", "rights issue",
    "analyst", "forecast", "outlook", "guidance",
    "portfolio", "hedge",
    "oil", "energy", "metals", "agri",
    "tax", "gst", "budget",
}

# Keywords that immediately REJECT an article
REJECT_KEYWORDS = {
    "cricket", "ipl", "football", "tennis", "sports", "hockey", "badminton",
    "bollywood", "actor", "actress", "celebrity", "film", "movie", "netflix",
    "weather", "rain", "flood", "earthquake", "cyclone", "drought",
    "bail", "arrested", "convicted", "rape", "murder", "crime", "police",
    "recipe", "food", "fashion", "lifestyle", "health tips", "diet",
    "horoscope", "astrology", "zodiac",
    "politics", "election", "parliament", "opposition", "ruling party",
    "travel", "tourism", "hotel", "airline deal",
}

# Category classification
CATEGORY_KEYWORDS = {
    "Markets":     {"nifty", "sensex", "nasdaq", "s&p", "ftse", "nikkei", "market", "equity", "rally", "correction", "index"},
    "Economy":     {"gdp", "inflation", "cpi", "rbi", "fed", "rate", "repo", "monetary", "fiscal", "budget", "policy"},
    "Earnings":    {"earnings", "quarterly", "results", "revenue", "profit", "ebitda", "guidance", "q1", "q2", "q3", "q4"},
    "IPO":         {"ipo", "listing", "subscription", "allotment", "gmp", "mainboard", "sme"},
    "Global":      {"fed", "fomc", "ecb", "us markets", "global", "trade war", "tariff", "international"},
    "Crypto":      {"bitcoin", "ethereum", "crypto", "blockchain", "defi", "nft", "web3"},
    "Commodities": {"crude", "oil", "gold", "silver", "metal", "commodity", "agri", "brent"},
}

# Sector detection
SECTOR_KEYWORDS = {
    "Banking":    {"bank", "banking", "nifty bank", "hdfc", "sbi", "icici", "kotak"},
    "IT":         {"it sector", "tech", "software", "tcs", "infosys", "wipro", "hcl"},
    "Pharma":     {"pharma", "healthcare", "drug", "medicine", "sun pharma"},
    "Auto":       {"auto", "automobile", "ev", "maruti", "tata motors"},
    "Energy":     {"energy", "oil", "gas", "power", "reliance", "ongc"},
    "FMCG":       {"fmcg", "consumer", "hul", "nestle", "itc"},
    "Realty":     {"realty", "real estate", "property", "housing"},
    "Metals":     {"metal", "steel", "tata steel", "jsw", "hindalco"},
}

SENTIMENT_POSITIVE = {
    "rally", "surge", "gain", "gains", "rise", "rises", "bull", "bullish",
    "growth", "record", "strong", "positive", "up", "boost",
    "soar", "soars", "outperform", "beat", "beats", "upgrade",
    "recovery", "rebound", "optimism", "buy",
}
SENTIMENT_NEGATIVE = {
    "fall", "falls", "drop", "drops", "decline", "declines", "crash",
    "bear", "bearish", "loss", "losses", "weak", "negative", "down",
    "plunge", "plunges", "sink", "sell-off", "selloff", "downgrade",
    "concern", "risk", "warning", "caution", "miss", "misses",
}


def _financial_score(text: str) -> int:
    """Score how financially relevant a text is (higher = more relevant)."""
    text_lower = text.lower()
    score = 0
    for kw in HIGH_WEIGHT_KEYWORDS:
        if kw in text_lower:
            score += 3
    for kw in MEDIUM_WEIGHT_KEYWORDS:
        if kw in text_lower:
            score += 1
    # Ticker detection bonus
    if re.search(r'\b(NIFTY|SENSEX|NASDAQ|S&P|FTSE|NIKKEI|BTC|ETH)\b', text):
        score += 5
    if re.search(r'\$[A-Z]{2,5}\b', text):  # $AAPL, $TSLA etc.
        score += 5
    return score


def _has_reject_keywords(text: str) -> bool:
    text_lower = text.lower()
    return any(kw in text_lower for kw in REJECT_KEYWORDS)


def _detect_sentiment(text: str) -> Dict[str, str]:
    text_lower = text.lower()
    pos = sum(1 for w in SENTIMENT_POSITIVE if w in text_lower)
    neg = sum(1 for w in SENTIMENT_NEGATIVE if w in text_lower)
    if pos > neg:
        sentiment = "positive"
        label = "Bullish"
    elif neg > pos:
        sentiment = "negative"
        label = "Bearish"
    else:
        sentiment = "neutral"
        label = "Neutral"
    return {"sentiment": sentiment, "sentiment_label": label}


def _classify_category(text: str) -> str:
    text_lower = text.lower()
    scores = {}
    for cat, keywords in CATEGORY_KEYWORDS.items():
        scores[cat] = sum(1 for kw in keywords if kw in text_lower)
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "Markets"


def _detect_sectors(text: str) -> List[str]:
    text_lower = text.lower()
    sectors = []
    for sector, keywords in SECTOR_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            sectors.append(sector)
    return sectors[:3]  # Max 3 sectors


def _estimate_impact(score: int, text: str) -> str:
    text_lower = text.lower()
    high_impact_terms = {"rbi", "fed", "rate", "gdp", "inflation", "ipo", "merger", "acquisition", "earnings", "fomc"}
    has_high_impact = any(t in text_lower for t in high_impact_terms)
    if score >= 10 or has_high_impact:
        return "high"
    elif score >= 5:
        return "medium"
    return "low"


def clean_html(text: str) -> str:
    if not text:
        return ""
    clean = re.sub(r"<[^>]+>", "", text)
    clean = re.sub(r"&[a-zA-Z]+;", " ", clean)
    clean = re.sub(r"\s+", " ", clean)
    return clean.strip()[:500]


def parse_date(entry) -> str:
    for attr in ("published_parsed", "updated_parsed"):
        val = getattr(entry, attr, None)
        if val:
            try:
                ts = time.mktime(val)
                return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            except Exception:
                pass
    return datetime.now(timezone.utc).isoformat()


def _parse_single_feed(feed_info: Dict, country_upper: str) -> List[Dict]:
    """Parse one RSS feed and return qualifying articles.

    Pulled out of ``fetch_news`` so it can run in a thread pool — feedparser
    performs blocking network I/O. Exceptions are swallowed by the caller; a
    feed going down should never break the whole news endpoint.
    """
    out: List[Dict] = []
    try:
        feed = feedparser.parse(feed_info["url"])
        for entry in feed.entries[:15]:
            url = getattr(entry, "link", "")
            if not url:
                continue
            title = getattr(entry, "title", "No title")
            summary = clean_html(
                getattr(entry, "summary", getattr(entry, "description", ""))
            )
            combined_text = title + " " + summary

            # REJECT non-financial
            if _has_reject_keywords(combined_text):
                continue

            # Score financial relevance
            score = _financial_score(combined_text)
            if score < 5:  # raised from 3 → only clearly financial articles pass
                continue

            article_id = hashlib.md5(url.encode()).hexdigest()[:12]
            sentiment_data = _detect_sentiment(combined_text)
            art_category = _classify_category(combined_text)

            out.append({
                "id":               article_id,
                "title":            title,
                "summary":          summary or title,
                "source":           feed_info["source"],
                "url":              url,
                "published_at":     parse_date(entry),
                "sentiment":        sentiment_data["sentiment"],
                "sentiment_label":  sentiment_data["sentiment_label"],
                "category":         art_category,
                "affected_sectors": _detect_sectors(combined_text),
                "market_impact":    _estimate_impact(score, combined_text),
                "relevance_score":  score,
            })
    except Exception as e:
        logger.warning(
            "RSS feed error source=%s url=%s exc=%s",
            feed_info.get('source', 'unknown'), feed_info['url'], e,
        )
    return out


def fetch_news(
    country: str = "IN",
    limit: int = 30,
    category: Optional[str] = None,
    min_score: int = 5,
) -> List[dict]:
    cache_key = f"news_{country}_{limit}_{category or 'all'}"
    cached = cache.get(cache_key)
    if cached:
        logger.info(
            "news cache HIT country=%s category=%s articles=%d",
            country_upper, category or 'all', len(cached),
        )
        return cached

    country_upper = country.upper()

    # Select feeds by country
    if country_upper == "IN":
        feeds = [f for f in RSS_FEEDS if f["country"] in ("IN", "GLOBAL")]
    elif country_upper == "US":
        feeds = [f for f in RSS_FEEDS if f["country"] in ("US", "GLOBAL")]
    elif country_upper == "GB":
        feeds = [f for f in RSS_FEEDS if f["country"] in ("GB", "GLOBAL")]
    elif country_upper == "JP":
        feeds = [f for f in RSS_FEEDS if f["country"] in ("JP", "GLOBAL")]
    elif country_upper == "CN":
        # China-specific feeds are scarce on the free tier; fall back to
        # global business feeds so the panel is never empty.
        feeds = [f for f in RSS_FEEDS if f["country"] in ("CN", "GLOBAL")]
    else:
        feeds = RSS_FEEDS

    # Parse feeds in parallel — feedparser blocks on network I/O.
    articles: List[dict] = []
    seen_urls: set = set()
    with ThreadPoolExecutor(max_workers=min(8, len(feeds) or 1)) as executor:
        future_to_feed = {executor.submit(_parse_single_feed, f, country_upper): f for f in feeds}
        for future in as_completed(future_to_feed):
            for article in future.result():
                if article["url"] in seen_urls:
                    continue
                seen_urls.add(article["url"])
                articles.append(article)

    # Apply category filter AFTER de-dup so per-category counts are stable.
    if category:
        articles = [a for a in articles if a["category"] == category]

    # Sort: most recent first, break ties by relevance. The previous code
    # sorted twice in sequence and the second sort silently discarded the
    # relevance ordering — a single composite key fixes that.
    articles.sort(
        key=lambda a: (a["published_at"], a["relevance_score"]),
        reverse=True,
    )
    result = articles[:limit]
    logger.info(
        "news fetch OK country=%s category=%s articles=%d feeds_polled=%d",
        country_upper, category or 'all', len(result), len(feeds),
    )
    cache.set(cache_key, result, ttl=600)
    return result
