"""D539 (#1084) — whether a fund's notable LPs name the EIF or EIFO.

ONE RULE, IN TWO PLACES THAT MUST AGREE. The importers call `lp_flags`, and
migration 380 recomputes the stored flags with the same rule in SQL. The test
(`scripts/test_fund_lp_flags.py`) applies 380 to every EuroTech row and checks
that both say the same.

  EIF  (the European Investment Fund): "European Investment Fund", or `EIF`
       as a whole token, with no ASCII letter directly before or after it, so
       "EIFO", "EIFFEL" and "Seifert" do not match.
  EIFO (Denmark's Export and Investment Fund): `EIFO` as a whole token, or
       "Export and Investment Fund", which covers every spelling the
       spreadsheet uses: "Export and Investment Fund of Denmark", "Export and
       Investment Fund (EIFO)" and "Denmark’s Export and Investment Fund (EIFO)".

The token is matched case-sensitively, as SQL `GLOB` matches it; the full
names case-insensitively, as SQL `LIKE` matches them. EIFO's predecessor
(Vækstfonden, the Danish Growth Fund) is not EIFO's name and is not matched.
"""
from __future__ import annotations

import re

_EIF_TOKEN = re.compile(r'(?<![A-Za-z])EIF(?![A-Za-z])')
_EIFO_TOKEN = re.compile(r'(?<![A-Za-z])EIFO(?![A-Za-z])')
_EIF_NAME = re.compile(r'european investment fund', re.IGNORECASE | re.ASCII)
_EIFO_NAME = re.compile(r'export and investment fund', re.IGNORECASE | re.ASCII)


def lp_flags(notable_lps: str | None) -> tuple[bool, bool]:
    """(eif, eifo) for one fund's notable-LPs text. Empty text names neither."""
    text = notable_lps or ''
    eif = bool(_EIF_TOKEN.search(text) or _EIF_NAME.search(text))
    eifo = bool(_EIFO_TOKEN.search(text) or _EIFO_NAME.search(text))
    return eif, eifo
