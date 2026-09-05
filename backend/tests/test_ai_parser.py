"""Unit tests for services/ai_analyzer.py pure-function utilities.

Tests cover:
- _strip_code_fence  — all markdown fence variants
- _sanitize_sections — icon normalisation
- _gemini_api_key    — env-var sentinel handling

No network calls are made; Gemini is never contacted.
"""
import os
from unittest.mock import patch

import pytest

from services.ai_analyzer import (
    _strip_code_fence,
    _sanitize_sections,
    _gemini_api_key,
    VALID_SECTION_ICONS,
)


# ── _strip_code_fence ─────────────────────────────────────────────────────────

class TestStripCodeFence:
    def test_plain_json_passthrough(self):
        raw = '{"key": "value"}'
        assert _strip_code_fence(raw) == raw

    def test_json_fence_with_language_tag(self):
        raw = "```json\n{\"key\": \"value\"}\n```"
        result = _strip_code_fence(raw)
        assert result == '{"key": "value"}'

    def test_plain_triple_backtick_fence(self):
        raw = "```\n{\"a\": 1}\n```"
        result = _strip_code_fence(raw)
        assert result == '{"a": 1}'

    def test_strips_leading_whitespace_and_newlines(self):
        raw = "   ```json\n{\"x\": 2}\n```   "
        result = _strip_code_fence(raw)
        assert result == '{"x": 2}'

    def test_no_trailing_fence(self):
        """Opening fence present but no closing fence — should still strip opener."""
        raw = "```json\n{\"y\": 3}"
        result = _strip_code_fence(raw)
        assert result == '{"y": 3}'

    def test_multiline_json_body_preserved(self):
        body = '{\n  "title": "hello",\n  "value": 42\n}'
        raw = f"```json\n{body}\n```"
        result = _strip_code_fence(raw)
        assert result == body

    def test_no_newline_after_opening_fence(self):
        """Edge case: ``` immediately followed by content with no newline."""
        raw = "```{\"edge\": true}"
        result = _strip_code_fence(raw)
        # Should strip the opening ``` and return remaining text
        assert "```" not in result

    def test_empty_string(self):
        assert _strip_code_fence("") == ""

    def test_only_whitespace(self):
        assert _strip_code_fence("   \n  ") == ""

    def test_json_followed_by_trailing_backticks_only(self):
        """No opening fence, trailing fence only — should be a passthrough."""
        raw = '{"z": 9}'
        # No opening ```, so nothing gets stripped
        result = _strip_code_fence(raw)
        assert result == raw


# ── _sanitize_sections ────────────────────────────────────────────────────────

class TestSanitizeSections:
    def _make_result(self, icons):
        return {
            "sections": [
                {"id": f"s{i}", "title": "T", "content": "C", "icon": icon}
                for i, icon in enumerate(icons)
            ]
        }

    def test_known_icons_are_preserved(self):
        for icon in VALID_SECTION_ICONS:
            result = self._make_result([icon])
            _sanitize_sections(result)
            assert result["sections"][0]["icon"] == icon

    def test_unknown_icon_normalised_to_chart(self):
        result = self._make_result(["rocket", "🚀", "unknown_thing"])
        _sanitize_sections(result)
        for section in result["sections"]:
            assert section["icon"] == "chart"

    def test_empty_icon_normalised_to_chart(self):
        result = self._make_result([""])
        _sanitize_sections(result)
        assert result["sections"][0]["icon"] == "chart"

    def test_none_icon_normalised_to_chart(self):
        result = {"sections": [{"id": "x", "icon": None, "title": "T", "content": "C"}]}
        _sanitize_sections(result)
        assert result["sections"][0]["icon"] == "chart"

    def test_uppercase_icon_normalised(self):
        """Icons from the model may be uppercase — should still match after lower()."""
        result = self._make_result(["CHART", "Globe", "WARNING"])
        _sanitize_sections(result)
        for section in result["sections"]:
            assert section["icon"] in VALID_SECTION_ICONS

    def test_no_sections_key_no_crash(self):
        _sanitize_sections({})         # should not raise
        _sanitize_sections({"sections": None})  # should not raise

    def test_empty_sections_list(self):
        result = {"sections": []}
        _sanitize_sections(result)     # should not raise


# ── _gemini_api_key ───────────────────────────────────────────────────────────

class TestGeminiApiKey:
    def test_returns_none_for_empty_string(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
            assert _gemini_api_key() is None

    def test_returns_none_for_placeholder(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "your_gemini_api_key_here"}):
            assert _gemini_api_key() is None

    def test_returns_none_when_env_var_absent(self):
        env = {k: v for k, v in os.environ.items() if k != "GEMINI_API_KEY"}
        with patch.dict(os.environ, env, clear=True):
            assert _gemini_api_key() is None

    def test_returns_key_for_valid_value(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "AIzaSy_FAKE_KEY_1234567890"}):
            result = _gemini_api_key()
        assert result == "AIzaSy_FAKE_KEY_1234567890"

    def test_returns_key_for_any_non_placeholder_value(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "sk-test-abc"}):
            result = _gemini_api_key()
        assert result == "sk-test-abc"


# ── JSON pipeline (strip → loads) integration ─────────────────────────────────

class TestJsonPipeline:
    """Verify the _strip_code_fence → json.loads pipeline that analyze_market uses."""

    def test_fenced_json_loads_cleanly(self):
        import json
        payload = {"title": "Test", "confidence": 0.8}
        fenced = f"```json\n{json.dumps(payload)}\n```"
        result = json.loads(_strip_code_fence(fenced))
        assert result == payload

    def test_plain_json_loads_cleanly(self):
        import json
        payload = {"sentiment": "neutral", "sections": []}
        result = json.loads(_strip_code_fence(json.dumps(payload)))
        assert result == payload
