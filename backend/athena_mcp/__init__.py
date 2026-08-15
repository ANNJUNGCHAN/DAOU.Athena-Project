"""Athena MCP gateway — Athena as MCP client (to registered upstream servers) and
MCP server (single re-exposed surface to the CLI).

Sibling package to `athena_api/` (Kiwoom). See `plan/mcp-실행계획.md` for the
architecture decision (게이트웨이 안 B, §2/§7) and `plan/mcp-실행계획.md` §10 for
the confirmed upstream server selection. Kiwoom TR exposure is out of scope for
v1 (결정 4) — do not add it here.
"""

__version__ = "0.1.0"
