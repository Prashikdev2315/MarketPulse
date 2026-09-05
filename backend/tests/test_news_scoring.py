"""Unit tests for services/news_aggregator.py — keyword scoring & filtering.

Tests cover the pure-function layer:
  - _financial_score      (high/medium weight keywords, ticker regex bonus)
  - _has_reject_keywords  (reject list enforcement)
  - _detect_sentiment     (positive / negative / neutral)
  - _classify_category    (IPO, Crypto, Economy, … fallback to Markets)
  - _detect_sectors       (Banking, IT, Pharma, …)
  - _estimate_impact      (high ≥ 10 or high-impact term, medium 5-9, low < 5)

No network or RSS calls are made.
"""
import pytest

from services.news_aggregator import (
    _financial_score,
    _has_reject_keywords,
    _detect_sentiment,
    _classify_category,
    _detect_sectors,
    _estimate_impact,
    HIGH_WEIGHT_KEYWORDS,
    MEDIUM_WEIGHT_KEYWORDS,
    REJECT_KEYWORDS,
)


# ── _financial_score ──────────────────────────────────────────────────────────

class TestFinancialScore:
    def test_high_weight_keyword_scores_at_least_3(self):
        # "stock" is a HIGH_WEIGHT_KEYWORD → at least 3 points
        score = _financial_score("Reliance stock hits all-time high")
        assert score >= 3

    def test_medium_weight_keyword_scores_at_least_1(self):
        # "economy" is a MEDIUM_WEIGHT_KEYWORD
        score = _financial_score("Global economy shows resilience")
        assert score >= 1

    def test_gibberish_scores_zero(self):
        score = _financial_score("Lorem ipsum dolor sit amet consectetur")
        assert score == 0

    def test_ticker_nifty_bonus(self):
        # NIFTY in ALL CAPS triggers the +5 regex bonus
        score = _financial_score("NIFTY surges 200 points today")
        # HIGH_WEIGHT keyword "nifty" (3) + regex bonus (5) = at least 8
        assert score >= 8

    def test_ticker_dollar_symbol_bonus(self):
        # $AAPL triggers +5 bonus
        score = _financial_score("$AAPL beats earnings expectations")
        assert score >= 5

    def test_ticker_sensex_bonus(self):
        score = _financial_score("SENSEX closes above 75000")
        assert score >= 8  # keyword(3) + regex(5)

    def test_ticker_nasdaq_bonus(self):
        score = _financial_score("NASDAQ composite gains 1.5%")
        assert score >= 8

    def test_multiple_high_keywords_accumulate(self):
        # "nifty" + "stock" + "market" → at least 9 from keywords alone
        score = _financial_score("Nifty stock market rally today")
        assert score >= 9

    def test_multiple_medium_keywords_accumulate(self):
        score = _financial_score("Economy growth recovery investment")
        assert score >= 4  # 4 medium keywords

    def test_mixed_case_keyword_still_scores(self):
        # Keywords should match case-insensitively
        score = _financial_score("STOCK market RALLY today")
        assert score >= 3

    def test_all_high_weight_keywords_score_nonzero(self):
        for kw in list(HIGH_WEIGHT_KEYWORDS)[:10]:   # spot-check first 10
            score = _financial_score(kw)
            assert score > 0, f"Expected nonzero score for keyword '{kw}'"

    def test_all_medium_weight_keywords_score_nonzero(self):
        for kw in list(MEDIUM_WEIGHT_KEYWORDS)[:10]:
            score = _financial_score(kw)
            assert score > 0, f"Expected nonzero score for keyword '{kw}'"


# ── _has_reject_keywords ──────────────────────────────────────────────────────

class TestHasRejectKeywords:
    def test_cricket_is_rejected(self):
        assert _has_reject_keywords("India wins cricket match against Australia") is True

    def test_ipl_is_rejected(self):
        assert _has_reject_keywords("IPL season kicks off in Mumbai") is True

    def test_bollywood_is_rejected(self):
        assert _has_reject_keywords("Bollywood actor wins award at film festival") is True

    def test_weather_is_rejected(self):
        assert _has_reject_keywords("Heavy rain and flood warning in Mumbai") is True

    def test_politics_is_rejected(self):
        assert _has_reject_keywords("Parliament passes new election bill") is True

    def test_financial_news_is_not_rejected(self):
        assert _has_reject_keywords("Nifty surges 300 points; FII buying continues") is False

    def test_empty_string_is_not_rejected(self):
        assert _has_reject_keywords("") is False

    def test_case_insensitive_rejection(self):
        assert _has_reject_keywords("CRICKET world cup semi-final") is True

    def test_partial_word_match(self):
        # "film" should trigger rejection even mid-sentence
        assert _has_reject_keywords("Box office film collection report") is True

    def test_all_reject_keywords_trigger(self):
        for kw in list(REJECT_KEYWORDS)[:10]:
            assert _has_reject_keywords(kw) is True, f"'{kw}' should be rejected"


# ── _detect_sentiment ─────────────────────────────────────────────────────────

class TestDetectSentiment:
    def test_positive_keywords_give_bullish(self):
        result = _detect_sentiment("Markets rally surge gain record high bullish")
        assert result["sentiment"] == "positive"
        assert result["sentiment_label"] == "Bullish"

    def test_negative_keywords_give_bearish(self):
        result = _detect_sentiment("Markets fall crash decline plunge sell-off bearish loss")
        assert result["sentiment"] == "negative"
        assert result["sentiment_label"] == "Bearish"

    def test_neutral_text_gives_neutral(self):
        result = _detect_sentiment("The market index closed today at its previous level")
        assert result["sentiment"] == "neutral"
        assert result["sentiment_label"] == "Neutral"

    def test_mixed_equal_positive_negative_gives_neutral(self):
        # "rally" (pos) and "fall" (neg) → tie → neutral
        result = _detect_sentiment("Markets rally but also fall today")
        assert result["sentiment"] == "neutral"

    def test_single_positive_word(self):
        result = _detect_sentiment("rally")
        assert result["sentiment"] == "positive"

    def test_single_negative_word(self):
        result = _detect_sentiment("crash")
        assert result["sentiment"] == "negative"

    def test_empty_string_is_neutral(self):
        result = _detect_sentiment("")
        assert result["sentiment"] == "neutral"


# ── _classify_category ────────────────────────────────────────────────────────

class TestClassifyCategory:
    def test_ipo_text(self):
        text = "The IPO subscription period opens tomorrow for mainboard listing"
        assert _classify_category(text) == "IPO"

    def test_crypto_text(self):
        text = "Bitcoin ethereum crypto blockchain DeFi surges"
        assert _classify_category(text) == "Crypto"

    def test_economy_text(self):
        text = "RBI cuts repo rate; GDP forecast revised; inflation at 4%"
        assert _classify_category(text) == "Economy"

    def test_commodities_text(self):
        text = "Crude oil brent gold silver metal commodity prices"
        assert _classify_category(text) == "Commodities"

    def test_earnings_text(self):
        text = "Q3 quarterly earnings revenue profit EBITDA guidance miss"
        assert _classify_category(text) == "Earnings"

    def test_markets_text(self):
        text = "Nifty sensex market equity rally index"
        assert _classify_category(text) == "Markets"

    def test_unknown_text_falls_back_to_markets(self):
        # Text with absolutely no category-specific keywords → should default to "Markets"
        result = _classify_category("xyz abc def ghi jkl mno pqr stu vwx")
        assert result == "Markets"


# ── _detect_sectors ───────────────────────────────────────────────────────────

class TestDetectSectors:
    def test_banking_detected(self):
        sectors = _detect_sectors("HDFC Bank SBI ICICI banking nifty bank")
        assert "Banking" in sectors

    def test_it_detected(self):
        sectors = _detect_sectors("TCS Infosys Wipro IT sector software revenue")
        assert "IT" in sectors

    def test_pharma_detected(self):
        sectors = _detect_sectors("Sun Pharma healthcare drug approval FDA")
        assert "Pharma" in sectors

    def test_energy_detected(self):
        sectors = _detect_sectors("Reliance oil gas energy power ONGC")
        assert "Energy" in sectors

    def test_multiple_sectors_detected(self):
        # Text covering banking + IT
        sectors = _detect_sectors("HDFC Bank IT software tech TCS banking")
        assert "Banking" in sectors
        assert "IT" in sectors

    def test_max_3_sectors_returned(self):
        # Text covering many sectors
        text = "bank IT pharma auto energy FMCG realty metals"
        sectors = _detect_sectors(text)
        assert len(sectors) <= 3

    def test_no_sector_match_returns_empty(self):
        sectors = _detect_sectors("Lorem ipsum with no financial sector terms")
        assert sectors == []


# ── _estimate_impact ──────────────────────────────────────────────────────────

class TestEstimateImpact:
    def test_score_10_or_more_is_high(self):
        # Score >= 10 → "high"
        assert _estimate_impact(10, "neutral text") == "high"
        assert _estimate_impact(15, "neutral text") == "high"

    def test_score_5_to_9_is_medium(self):
        assert _estimate_impact(5, "neutral text") == "medium"
        assert _estimate_impact(9, "neutral text") == "medium"

    def test_score_below_5_is_low(self):
        assert _estimate_impact(4, "neutral text") == "low"
        assert _estimate_impact(0, "neutral text") == "low"

    def test_rbi_term_forces_high_regardless_of_score(self):
        # "rbi" is a high_impact_term → forced high even with score=0
        assert _estimate_impact(0, "rbi cuts rates") == "high"

    def test_fed_term_forces_high(self):
        assert _estimate_impact(2, "fed fomc meeting") == "high"

    def test_ipo_term_forces_high(self):
        assert _estimate_impact(1, "major ipo listing tomorrow") == "high"

    def test_merger_term_forces_high(self):
        assert _estimate_impact(3, "company merger announced") == "high"

    def test_earnings_term_forces_high(self):
        assert _estimate_impact(0, "earnings season begins") == "high"

    def test_score_5_with_no_high_impact_terms_is_medium(self):
        assert _estimate_impact(5, "some random financial text") == "medium"
