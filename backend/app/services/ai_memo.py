import os
import json


def generate_memo_with_ai(data: dict) -> dict:
    openai_key = os.environ.get("OPENAI_API_KEY")

    if openai_key:
        try:
            import openai
            client = openai.OpenAI(api_key=openai_key)

            prompt = f"""Generate a structured investment deal memo for the following startup:

Startup Name: {data.get('startup_name', 'Unknown')}
Problem: {data.get('problem', 'N/A')}
Solution: {data.get('solution', 'N/A')}
Sector: {data.get('sector', 'N/A')}
TAM: ${data.get('tam', 0):,.0f}
Team: {data.get('team_info', 'N/A')}
Traction: {data.get('traction', 'N/A')}
Funding Needed: ${data.get('funding_needed', 0):,.0f}
Use of Funds: {data.get('use_of_funds', 'N/A')}
Known Risks: {data.get('risks', 'N/A')}

Return a JSON object with these fields:
- problem_analysis: 2-3 sentences on the problem space
- solution_assessment: 2-3 sentences on the solution viability
- traction_summary: 2-3 sentences on current traction/momentum
- risk_assessment: 2-3 bullet points on key risks
- decision: one of "INVEST", "CONDITIONAL", "PASS" with 1-2 sentence reasoning
- key_insight: one unique observation about this opportunity

Return ONLY valid JSON, no markdown."""

            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a venture capital analyst at Axal VC. Generate concise, data-driven investment memos."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=800,
            )

            content = response.choices[0].message.content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            return {
                "ai_generated": True,
                "memo": json.loads(content),
            }

        except Exception:
            return _fallback_memo(data, "AI generation unavailable")
    else:
        return _fallback_memo(data, "OpenAI API key not configured")


def _fallback_memo(data: dict, reason: str) -> dict:
    startup_name = data.get("startup_name", "Unknown Startup")
    problem = data.get("problem", "Not specified")
    solution = data.get("solution", "Not specified")
    sector = data.get("sector", "General")
    tam = data.get("tam", 0)
    funding = data.get("funding_needed", 0)

    tam_assessment = "large" if tam and tam > 500_000_000 else "moderate" if tam and tam > 50_000_000 else "early-stage"

    return {
        "ai_generated": False,
        "fallback_reason": reason,
        "memo": {
            "problem_analysis": f"{startup_name} is addressing: {problem}. The {sector} sector presents a {tam_assessment} market opportunity.",
            "solution_assessment": f"Proposed solution: {solution}. Requires further technical diligence to validate feasibility and differentiation.",
            "traction_summary": data.get("traction", "Early stage — pre-traction. Key milestones need to be defined for next 90 days."),
            "risk_assessment": [
                "Market timing and competitive dynamics need validation",
                "Team execution capability requires further assessment",
                f"Capital efficiency at ${funding:,.0f} funding request needs detailed burn analysis" if funding else "Funding requirements not yet specified",
            ],
            "decision": "CONDITIONAL — requires deeper diligence on team and market validation",
            "key_insight": f"The {sector} opportunity warrants exploration given current market dynamics. Recommend 2-week deep-dive before final decision.",
        },
    }
