"""Derive calendar-month windows from a selected from/to range.

Used by the trend + recovery services so the monthly charts follow the picker
instead of a hardcoded Jan..Jul. The newest month (cut off by the range end or
by today) is flagged partial.
"""

import calendar
from datetime import date

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _parse(d: str | None, fallback: date) -> date:
    try:
        return date.fromisoformat(d) if d else fallback
    except ValueError:
        return fallback


def month_windows(date_from: str | None, date_to: str | None) -> list[tuple[str, str, str, bool]]:
    """Return [(label, start_iso, end_iso, partial), ...] spanning the range.

    Default (no dates): last ~6 months ending today. `partial` = the queried
    end is before the month's natural end (incomplete month).
    """
    today = date.today()
    end = _parse(date_to, today)
    start = _parse(date_from, date(end.year, end.month, 1))
    # Default range with no from: go back ~6 months so a monthly chart is meaningful.
    if not date_from:
        y, m = end.year, end.month
        for _ in range(5):
            y, m = (y - 1, 12) if m == 1 else (y, m - 1)
        start = date(y, m, 1)
    if start > end:
        start, end = end, start

    multi_year = start.year != end.year
    windows: list[tuple[str, str, str, bool]] = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        last_day = calendar.monthrange(y, m)[1]
        natural_end = date(y, m, last_day)
        ws = max(date(y, m, 1), start)
        we = min(natural_end, end, today)
        partial = we < natural_end
        label = f"{_MONTHS[m - 1]} {str(y)[2:]}" if multi_year else _MONTHS[m - 1]
        windows.append((label, ws.isoformat(), we.isoformat(), partial))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return windows
