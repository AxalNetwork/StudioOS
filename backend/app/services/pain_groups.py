"""Task #29 — Pain-group resolver (dev FastAPI mirror of the Worker's
``cloudflare-worker/src/services/painGroups.ts``).

Logged discovery pains are plain strings in ``interviews.pains_json``.
Founders curate them into themes via two tables (``pain_groups`` +
``pain_group_aliases``). A raw phrase resolves to a theme by, in order:

  1. explicit alias (phrase_norm)   — founder-curated membership.
  2. group title_norm exact match   — "reuse a suggested title" path.
  3. implicit one-phrase group      — an uncurated phrase is its own theme.

``mentions`` is the count of DISTINCT interviews mentioning the resolved
theme (multiple matching pains in one interview count once), matching the
"n / total interviews" slide label. Empty real data yields no themes so the
deck shows its honest placeholder, never the bundled BASEPOINT sample.
"""
from __future__ import annotations

import json
import re
from typing import Optional

from sqlmodel import Session, select

from backend.app.models.entities import Interview, PainGroup, PainGroupAlias

_NORM_RE = re.compile(r"[\s.,!?;:\"'`]+")


def norm_phrase(s: str) -> str:
    """Mirror of the Worker's ``normPhrase`` (lower-case, collapse
    whitespace/punctuation, cap length)."""
    s = (s or "").lower().strip()
    s = _NORM_RE.sub(" ", s)
    return s[:60].strip()


def _safe_parse_strings(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    try:
        v = json.loads(raw)
    except Exception:  # noqa: BLE001
        return []
    if not isinstance(v, list):
        return []
    return [x if isinstance(x, str) else str(x or "") for x in v]


class _ThemeAccum:
    __slots__ = ("key", "title", "group_id", "count", "phrases")

    def __init__(self, key: str, title: str, group_id: Optional[int]):
        self.key = key
        self.title = title
        self.group_id = group_id
        self.count = 0
        self.phrases: dict[str, str] = {}  # phrase_norm -> display


def _load_model(session: Session, project_id: int):
    groups = list(
        session.exec(
            select(PainGroup)
            .where(PainGroup.project_id == project_id)
            .order_by(PainGroup.sort_order, PainGroup.id)
        )
    )
    group_ids = {g.id for g in groups}
    aliases = list(
        session.exec(
            select(PainGroupAlias).where(PainGroupAlias.project_id == project_id)
        )
    )
    alias_by_norm: dict[str, int] = {}
    alias_display: dict[str, str] = {}
    for a in aliases:
        if a.group_id not in group_ids:
            continue  # defensive: orphaned alias
        alias_by_norm[a.phrase_norm] = a.group_id
        alias_display[a.phrase_norm] = a.display_phrase
    title_norm_to_group: dict[str, int] = {}
    for g in groups:
        tn = norm_phrase(g.title)
        if tn and tn not in title_norm_to_group:
            title_norm_to_group[tn] = g.id
    return groups, alias_by_norm, alias_display, title_norm_to_group


def _analyze(session: Session, project_id: int):
    groups, alias_by_norm, alias_display, title_norm_to_group = _load_model(session, project_id)
    group_by_id = {g.id: g for g in groups}
    interviews = list(
        session.exec(select(Interview).where(Interview.project_id == project_id))
    )
    interview_total = len(interviews)

    acc: dict[str, _ThemeAccum] = {}

    def ensure(key: str, title: str, group_id: Optional[int]) -> _ThemeAccum:
        a = acc.get(key)
        if a is None:
            a = _ThemeAccum(key, title, group_id)
            acc[key] = a
        return a

    # Seed curated groups (so they appear in the view even with 0 mentions)
    # and their explicit alias member phrases.
    for g in groups:
        ensure(f"g:{g.id}", g.title, g.id)
    for norm, gid in alias_by_norm.items():
        a = acc.get(f"g:{gid}")
        if a is None:
            continue
        a.phrases.setdefault(norm, alias_display.get(norm, norm))

    def resolve(norm: str, display: str):
        gid = alias_by_norm.get(norm)
        if gid is not None and gid in group_by_id:
            g = group_by_id[gid]
            return f"g:{g.id}", g.id, g.title
        gid = title_norm_to_group.get(norm)
        if gid is not None and gid in group_by_id:
            g = group_by_id[gid]
            return f"g:{g.id}", g.id, g.title
        return f"impl:{norm}", None, display

    for it in interviews:
        seen: set[str] = set()
        for phrase in _safe_parse_strings(it.pains_json):
            display = phrase.strip()
            if not display:
                continue
            norm = norm_phrase(display)
            if not norm:
                continue
            key, group_id, title = resolve(norm, display)
            a = ensure(key, title, group_id)
            a.phrases[norm] = display
            if key not in seen:
                a.count += 1
                seen.add(key)

    return acc, groups, interview_total


def compute_pain_themes(session: Session, project_id: int) -> list[tuple[str, int]]:
    """Ranked ``[(theme, mentions)]`` (distinct-interview count), highest first."""
    acc, _groups, _total = _analyze(session, project_id)
    themes = [a for a in acc.values() if a.count > 0]
    themes.sort(key=lambda a: (-a.count, a.title.lower()))
    return [(a.title, a.count) for a in themes]


def compute_pain_bars(session: Session, project_id: int, limit: int = 6) -> list[list]:
    """Deck ``problem.pains`` rows: ``[label, pct, "n / total"]`` ranked by
    distinct-interview mentions. Empty when there is no real data."""
    acc, _groups, total = _analyze(session, project_id)
    themes = [a for a in acc.values() if a.count > 0]
    themes.sort(key=lambda a: (-a.count, a.title.lower()))
    bars: list[list] = []
    for a in themes[:limit]:
        pct = round(a.count / total * 100) if total else 0
        bars.append([a.title, pct, f"{a.count} / {total}"])
    return bars


def materialize_title_norm_aliases(session: Session, group: PainGroup) -> None:
    """Persist any logged pains that resolve to ``group`` ONLY via its
    title-norm (path 2, no explicit alias) as explicit aliases. Call this
    before renaming a group: without it, changing the title silently drops
    those phrases back to implicit themes, moving the slide's counts even
    though no interview was edited. No-op when the membership is already
    explicit or nothing was actually logged against the title. Caller commits.
    """
    project_id = group.project_id
    old_norm = norm_phrase(group.title)
    if not old_norm:
        return
    existing = session.exec(
        select(PainGroupAlias)
        .where(PainGroupAlias.project_id == project_id)
        .where(PainGroupAlias.phrase_norm == old_norm)
    ).first()
    if existing:
        return  # already curated explicitly — title-norm wasn't load-bearing
    interviews = session.exec(
        select(Interview).where(Interview.project_id == project_id)
    )
    display: Optional[str] = None
    for it in interviews:
        for phrase in _safe_parse_strings(it.pains_json):
            d = phrase.strip()
            if d and norm_phrase(d) == old_norm:
                display = d[:200]
                break
        if display:
            break
    if not display:
        return  # nobody logged this title — nothing to preserve
    session.add(
        PainGroupAlias(
            project_id=project_id,
            group_id=group.id,
            phrase_norm=old_norm,
            display_phrase=display,
        )
    )


def get_pain_groups_view(session: Session, project_id: int) -> dict:
    """Structured view for the curation UI: curated groups + ungrouped phrases."""
    acc, groups, total = _analyze(session, project_id)
    groups_view = []
    for g in groups:
        a = acc.get(f"g:{g.id}")
        phrases = (
            [{"phrase_norm": pn, "display_phrase": dp} for pn, dp in a.phrases.items()]
            if a
            else []
        )
        groups_view.append(
            {
                "id": g.id,
                "title": g.title,
                "sort_order": g.sort_order,
                "count": a.count if a else 0,
                "phrases": phrases,
            }
        )
    ungrouped = [a for a in acc.values() if a.group_id is None]
    ungrouped.sort(key=lambda a: (-a.count, a.title.lower()))
    ungrouped_view = [
        {
            "phrase_norm": a.key[len("impl:") :],
            "display_phrase": a.title,
            "count": a.count,
        }
        for a in ungrouped
    ]
    return {
        "project_id": project_id,
        "interview_total": total,
        "groups": groups_view,
        "ungrouped": ungrouped_view,
    }
