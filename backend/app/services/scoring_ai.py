"""
AI explanation layer for the v2 scoring engine ("The Brain").

Uses OpenAI when OPENAI_API_KEY is present, otherwise falls back to a
deterministic, data-driven explanation derived from the score breakdown.
The fallback is intentionally explicit so the UI can show real reasoning
even without an LLM available.
"""
import json
import os
from typing import Optional


_CATEGORY_LABELS = {
    "market": "Market Opportunity",
    "team": "Founder / Team",
    "product": "Product / Technology",
    "traction": "Traction & Validation",
    "capital": "Capital Efficiency & Financials",
    "fit": "Strategic Fit & Moat",
}


def _category_summary(breakdown: dict) -> list[dict]:
    rows = []
    for key, cat in breakdown.items():
        ratio = (cat["total"] / cat["max"]) * 100 if cat["max"] else 0
        rows.append({
            "key": key,
            "label": _CATEGORY_LABELS.get(key, key.title()),
            "score": cat["total"],
            "max": cat["max"],
            "pct": round(ratio, 1),
        })
    rows.sort(key=lambda r: r["pct"])
    return rows


def _heuristic_explanation(result: dict, startup_name: Optional[str]) -> dict:
    rows = _category_summary(result["category_breakdown"])
    weakest = rows[:2]
    strongest = list(reversed(rows))[:2]
    name = startup_name or "This venture"

    strength_text = ", ".join(f"{r['label']} ({r['score']}/{r['max']})" for r in strongest)
    weak_text = ", ".join(f"{r['label']} ({r['score']}/{r['max']})" for r in weakest)

    rec = result["recommendation"]
    headline = {
        "Strong":      f"{name} scores {result['total_score']}/100 — strong investment signal across the board.",
        "Promising":   f"{name} scores {result['total_score']}/100 — promising, with a few gaps to validate before commit.",
        "Needs Work":  f"{name} scores {result['total_score']}/100 — meaningful gaps; refine before advancing.",
        "High Risk":   f"{name} scores {result['total_score']}/100 — high risk profile, recommend pass or major rework.",
    }.get(rec, f"{name} scores {result['total_score']}/100.")

    body = (
        f"{headline} "
        f"Strongest signals: {strength_text}. "
        f"Weakest areas to address: {weak_text}. "
        f"AI bonus layer applied: {result['ai_adjustment']:+.1f} pts."
    )

    return {
        "ai_generated": False,
        "fallback_reason": "OPENAI_API_KEY not configured — using deterministic explanation",
        "headline": headline,
        "summary": body,
        "strengths": [r["label"] for r in strongest],
        "weaknesses": [r["label"] for r in weakest],
        "recommendation": rec,
    }


def explain_score(result: dict, startup_name: Optional[str] = None, context: Optional[str] = None) -> dict:
    """
    Generate a natural-language explanation of a scoring result.

    `result` is the dict returned by `run_brain_score`.
    `context` is optional free-form text the user provided (e.g. project description).
    """
    openai_key = os.environ.get("OPENAI_API_KEY")
    if not openai_key:
        return _heuristic_explanation(result, startup_name)

    try:
        import openai
        client = openai.OpenAI(api_key=openai_key)

        rows = _category_summary(result["category_breakdown"])
        compact = [{"category": r["label"], "score": r["score"], "max": r["max"]} for r in rows]

        prompt = f"""You are a senior partner at Axal VC reviewing a 100-point startup scorecard.

Startup: {startup_name or 'Unnamed venture'}
Total score: {result['total_score']}/100 (raw {result['raw_score']}, AI bonus {result['ai_adjustment']:+.1f})
Recommendation tier: {result['recommendation']}

Category breakdown (sorted weakest -> strongest):
{json.dumps(compact, indent=2)}

{f'Additional context from analyst: {context}' if context else ''}

Return ONLY valid JSON with these fields:
- headline: one punchy sentence summarising the verdict
- summary: 3-4 sentences explaining the score, calling out the 2 strongest and 2 weakest categories with specific reasoning
- strengths: array of 2-3 short strings (category names that drove the score up)
- weaknesses: array of 2-3 short strings (category names dragging it down)
- recommendation: one of "Strong", "Promising", "Needs Work", "High Risk" (must match {result['recommendation']})
"""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a concise, data-driven VC analyst. Always return valid JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            max_tokens=500,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content.strip()
        parsed = json.loads(content)
        parsed["ai_generated"] = True
        # Ensure recommendation is always present and consistent.
        parsed.setdefault("recommendation", result["recommendation"])
        return parsed

    except Exception as exc:  # noqa: BLE001
        fallback = _heuristic_explanation(result, startup_name)
        fallback["fallback_reason"] = f"AI call failed: {exc.__class__.__name__}"
        return fallback
