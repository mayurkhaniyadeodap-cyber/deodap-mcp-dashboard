"""Admin commands for the MCP Dashboard backend (run by an admin on the server, in the backend
folder).

Link an EXISTING MCP account to a DeoDap Central user, so single sign-on from Central uses that
account instead of creating a new one:

    python -m app.cli link-central-user --central-user-id 7 --central-role admin --mcp-user-id 12
    python -m app.cli link-central-user --unlink --central-user-id 7      (or --mcp-user-id 12)

Rules:
  - Accounts are never matched by email: only the ids you give are linked.
  - Refused if the Central user or the MCP account is already linked (unlink first).
  - Central decides the MCP role on every sign-in through Central (Central Admin -> MCP admin,
    Central User -> MCP employee). Because the account is shared with MCP's normal login, a
    different role is refused unless --allow-role-change is given.
  - Shows what will change and asks for confirmation (or --yes).
The email and password of a linked account are never changed by single sign-on.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable

from app.auth.central_sso import PROVIDER, ROLE_MAP
from app.services import user_store

InputFn = Callable[[str], str]


def _confirm(assume_yes: bool, input_fn: InputFn) -> bool:
    if assume_yes:
        return True
    try:
        answer = input_fn("Type 'yes' to continue: ")
    except EOFError:  # no terminal (e.g. a script): never assume consent
        return False
    return answer.strip().lower() == "yes"


def _role(value) -> str:
    return getattr(value, "value", str(value))


def _link(args: argparse.Namespace, input_fn: InputFn) -> int:
    missing = [
        name
        for name, value in (
            ("--central-user-id", args.central_user_id),
            ("--mcp-user-id", args.mcp_user_id),
            ("--central-role", args.central_role),
        )
        if value is None
    ]
    if missing:
        print(f"Error: linking needs {', '.join(missing)}.", file=sys.stderr)
        return 2
    subject = str(args.central_user_id)
    account = user_store.get_by_id(args.mcp_user_id)
    if account is None:
        print(f"Refused: MCP account {args.mcp_user_id} does not exist. Nothing changed.")
        return 1
    by_subject = user_store.find_sso_link(PROVIDER, subject=subject)
    if by_subject is not None:
        print(
            f"Refused: Central user {subject} is already linked to MCP account "
            f"{by_subject.user_id}. Unlink it first (--unlink). Nothing changed."
        )
        return 1
    by_account = user_store.find_sso_link(PROVIDER, user_id=account.id)
    if by_account is not None:
        print(
            f"Refused: MCP account {account.id} is already linked to Central user "
            f"{by_account.subject}. Unlink it first (--unlink). Nothing changed."
        )
        return 1

    current_role = _role(account.role)
    new_role = _role(ROLE_MAP[args.central_role])
    print(f"Link Central user {subject} to the EXISTING MCP account {account.id}:")
    print(f"  MCP account:   {account.full_name} <{account.email}>")
    print(f"  Central role:  {args.central_role}  ->  MCP role {new_role}")
    print(f"  Current MCP role: {current_role}")
    print("  Email and password stay as they are (MCP's normal login keeps working).")
    print("  The name will follow DeoDap Central on the next sign-in through Central.")
    if current_role != new_role:
        print(
            f"  ROLE CHANGE: on the next sign-in through Central this account becomes '{new_role}' "
            f"(now '{current_role}'), for MCP's normal login too."
        )
        if not args.allow_role_change:
            print(
                "Refused: the roles differ. Re-run with --allow-role-change if that is intended. "
                "Nothing changed."
            )
            return 1
    if not _confirm(args.yes, input_fn):
        print("Cancelled. Nothing changed.")
        return 1
    try:
        user_store.link_sso_identity(PROVIDER, subject, account.id)
    except (LookupError, ValueError) as exc:  # changed in the meantime
        print(f"Refused: {exc}. Nothing changed.")
        return 1
    print(
        f"Linked: Central user {subject} <-> MCP account {account.id}. "
        "The next sign-in through DeoDap Central uses this account."
    )
    return 0


def _unlink(args: argparse.Namespace, input_fn: InputFn) -> int:
    if (args.central_user_id is None) == (args.mcp_user_id is None):
        print(
            "Error: --unlink needs exactly one of --central-user-id / --mcp-user-id.",
            file=sys.stderr,
        )
        return 2
    subject = str(args.central_user_id) if args.central_user_id is not None else None
    link = user_store.find_sso_link(PROVIDER, subject=subject, user_id=args.mcp_user_id)
    if link is None:
        print("Nothing to unlink: no such link. Nothing changed.")
        return 1
    account = user_store.get_by_id(link.user_id)
    label = f"{account.full_name} <{account.email}>" if account else "(account no longer exists)"
    print(f"Remove the link: Central user {link.subject} <-> MCP account {link.user_id} {label}.")
    print(
        "  The MCP account itself is kept. The next sign-in through Central creates a new account."
    )
    if not _confirm(args.yes, input_fn):
        print("Cancelled. Nothing changed.")
        return 1
    user_store.unlink_sso_identity(PROVIDER, subject=link.subject)
    print(f"Unlinked: Central user {link.subject} <-> MCP account {link.user_id}.")
    return 0


def cmd_link_central_user(args: argparse.Namespace, input_fn: InputFn = input) -> int:
    return _unlink(args, input_fn) if args.unlink else _link(args, input_fn)


def main(argv: list[str] | None = None, input_fn: InputFn = input) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli", description="MCP Dashboard admin commands"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    link = sub.add_parser(
        "link-central-user",
        help="link (or --unlink) an existing MCP account to a DeoDap Central user",
    )
    link.add_argument("--central-user-id", type=int, help="the user's id in DeoDap Central")
    link.add_argument("--mcp-user-id", type=int, help="the existing MCP account's id")
    link.add_argument(
        "--central-role", choices=sorted(ROLE_MAP), help="the user's role in DeoDap Central"
    )
    link.add_argument(
        "--allow-role-change",
        action="store_true",
        help="link even if Central's role would change the MCP account's role",
    )
    link.add_argument(
        "--unlink", action="store_true", help="remove a link instead (the account is kept)"
    )
    link.add_argument("--yes", action="store_true", help="do not ask for confirmation")
    link.set_defaults(func=cmd_link_central_user)
    args = parser.parse_args(argv)
    for name in ("central_user_id", "mcp_user_id"):
        value = getattr(args, name, None)
        if value is not None and value <= 0:
            parser.error(f"--{name.replace('_', '-')} must be a positive number")
    return args.func(args, input_fn)


if __name__ == "__main__":
    raise SystemExit(main())
