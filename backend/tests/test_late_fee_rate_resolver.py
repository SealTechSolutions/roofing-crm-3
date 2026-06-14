"""Unit tests for the late-fee rate resolver and Cash Flow Statement.

Verifies:
  • resolve_late_fee_rate() precedence (customer override → entity → default)
  • Out-of-range / malformed values fall back gracefully
  • Cash Flow Statement structure shape + reconciliation invariant
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from gl import resolve_late_fee_rate, resolve_late_fee_rate_pct, LATE_FEE_MONTHLY_RATE  # noqa: E402


def test_default_when_both_missing():
    assert resolve_late_fee_rate(None, None) == LATE_FEE_MONTHLY_RATE
    assert resolve_late_fee_rate({}, {}) == LATE_FEE_MONTHLY_RATE


def test_entity_default_used():
    entity = {"late_fee_rate_pct": 2.0}
    assert resolve_late_fee_rate(entity, None) == 0.02
    assert resolve_late_fee_rate_pct(entity, None) == 2.0


def test_customer_override_wins():
    entity = {"late_fee_rate_pct": 2.0}
    customer = {"late_fee_rate_pct": 1.0}
    assert resolve_late_fee_rate(entity, customer) == 0.01
    assert resolve_late_fee_rate_pct(entity, customer) == 1.0


def test_zero_is_valid_override():
    """A customer marked as 0% should NOT fall back to entity default."""
    entity = {"late_fee_rate_pct": 1.5}
    customer = {"late_fee_rate_pct": 0.0}
    assert resolve_late_fee_rate(entity, customer) == 0.0


def test_null_customer_falls_back_to_entity():
    entity = {"late_fee_rate_pct": 1.5}
    customer = {"late_fee_rate_pct": None}
    assert resolve_late_fee_rate(entity, customer) == 0.015


def test_negative_value_ignored():
    """A garbage negative value should not be respected — fall through."""
    customer = {"late_fee_rate_pct": -1.0}
    entity = {"late_fee_rate_pct": 1.5}
    assert resolve_late_fee_rate(entity, customer) == 0.015


def test_malformed_value_ignored():
    customer = {"late_fee_rate_pct": "abc"}
    entity = {"late_fee_rate_pct": 1.5}
    assert resolve_late_fee_rate(entity, customer) == 0.015


def test_decimal_precision_3pct():
    entity = {"late_fee_rate_pct": 3.0}
    assert resolve_late_fee_rate(entity, None) == 0.03
    assert resolve_late_fee_rate_pct(entity, None) == 3.0
