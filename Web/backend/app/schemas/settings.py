"""Configuration/settings API contract — READ-ONLY, only real data.

The courier roster is NOT here — it's read live from /api/couriers (one source of
truth; the old hardcoded settings.json copy drifted, e.g. fictional codes on real
names). Also removed earlier: the Company block, notification toggles, the
'discrepancy threshold', per-courier api_status/active toggle, and Rate Card meta.
What remains is read-only system preferences.
"""

from pydantic import BaseModel


class Preferences(BaseModel):
    """System info only — hardcoded throughout the app (₹ INR, IST dates, kg)."""

    currency: str
    timezone: str
    weight_unit: str


class SettingsResponse(BaseModel):
    preferences: Preferences
