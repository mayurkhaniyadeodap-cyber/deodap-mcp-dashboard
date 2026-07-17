"""Configuration/settings service — READ-ONLY.

Serves the courier roster, rate-card meta, and read-only system preferences.
Nothing is editable: the Company block was fabricated data and the notification
toggles saved nowhere (no email/alert system reads them), so both were removed
along with the PATCH endpoint.
"""

from app.schemas.settings import SettingsResponse
from app.utils.mock import load_mock

_settings: dict = load_mock("settings.json")


def get_settings() -> SettingsResponse:
    return SettingsResponse(**_settings)
