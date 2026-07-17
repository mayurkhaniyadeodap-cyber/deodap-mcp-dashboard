"""Role definitions shared across auth, deps, and route guards.

Two active roles: Admin manages users and everything else; Employee has full
read/normal access to the whole dashboard but cannot manage users. The legacy
operations/finance/viewer values are retained (unused) so existing generated
types stay backward-compatible. Per-endpoint enforcement lives in api/deps.py
via require_role(...).
"""

from enum import Enum


class Role(str, Enum):
    admin = "admin"
    employee = "employee"
    # --- Legacy (no longer assigned; kept so existing types don't break) ---
    operations = "operations"
    finance = "finance"
    viewer = "viewer"
