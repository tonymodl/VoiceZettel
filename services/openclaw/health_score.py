"""
health_score.py — Dunbar Health Score Engine.
VoiceZettel 3.0 Phase 3: Semantic CRM

Computes relationship health scores based on:
- Engagement frequency
- Sentiment analysis  
- Decay rate (based on Dunbar layer)
- Balance of communication (who initiates more)

Dunbar Layers:
  Layer 1 (5 people):  Intimate — decay: 7 days
  Layer 2 (15 people): Close    — decay: 14 days
  Layer 3 (50 people): Friends  — decay: 30 days
  Layer 4 (150 people): Known   — decay: 90 days
"""

import math
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger("health_score")

# ── Dunbar Layer Configuration ────────────────────────────
DUNBAR_CONFIG = {
    1: {"name": "Intimate", "max_people": 5, "decay_days": 7, "weight": 3.0},
    2: {"name": "Close", "max_people": 15, "decay_days": 14, "weight": 2.0},
    3: {"name": "Friends", "max_people": 50, "decay_days": 30, "weight": 1.5},
    4: {"name": "Known", "max_people": 150, "decay_days": 90, "weight": 1.0},
}

# ── Health Score thresholds ───────────────────────────────
CRITICAL_THRESHOLD = 30.0  # Below this → generate alert
WARNING_THRESHOLD = 50.0   # Below this → gentle nudge


def compute_health_score(
    last_interaction_date: str,
    dunbar_layer: int,
    avg_sentiment: float,
    interaction_count_30d: int,
    balance_ratio: float = 0.5,
) -> dict:
    """
    Compute a Health Score for a person.
    
    Args:
        last_interaction_date: ISO format date of last interaction
        dunbar_layer: 1-4 Dunbar layer
        avg_sentiment: Average sentiment (-2 to +2)
        interaction_count_30d: Number of interactions in last 30 days
        balance_ratio: 0.0 = they always initiate, 1.0 = you always initiate
    
    Returns:
        Dict with score (0-100), components, and alert level
    """
    config = DUNBAR_CONFIG.get(dunbar_layer, DUNBAR_CONFIG[4])
    now = datetime.now(timezone.utc)

    # ── Component 1: Recency (0-40 points) ────────────────
    try:
        last_dt = datetime.fromisoformat(last_interaction_date.replace("Z", "+00:00"))
        days_since = (now - last_dt).days
    except (ValueError, AttributeError):
        days_since = 999

    decay_days = config["decay_days"]
    recency_raw = max(0, 1 - (days_since / (decay_days * 2)))
    recency_score = recency_raw * 40

    # ── Component 2: Frequency (0-25 points) ──────────────
    # Expected interactions per 30 days based on layer
    expected = {1: 15, 2: 8, 3: 4, 4: 1}.get(dunbar_layer, 1)
    freq_ratio = min(1.0, interaction_count_30d / expected)
    frequency_score = freq_ratio * 25

    # ── Component 3: Sentiment (0-20 points) ──────────────
    # Map [-2, +2] → [0, 20]
    sentiment_normalized = (avg_sentiment + 2) / 4  # 0 to 1
    sentiment_score = sentiment_normalized * 20

    # ── Component 4: Balance (0-15 points) ─────────────────
    # Perfect balance = 0.5, extremes penalized
    balance_penalty = abs(balance_ratio - 0.5) * 2  # 0 to 1
    balance_score = (1 - balance_penalty) * 15

    # ── Total Score ───────────────────────────────────────
    total = recency_score + frequency_score + sentiment_score + balance_score

    # Apply layer weight
    weighted_total = min(100, total * config["weight"] / 2)

    # ── Determine Alert Level ─────────────────────────────
    if weighted_total < CRITICAL_THRESHOLD:
        alert = "critical"
    elif weighted_total < WARNING_THRESHOLD:
        alert = "warning"
    else:
        alert = "healthy"

    return {
        "score": round(weighted_total, 1),
        "alert": alert,
        "dunbar_layer": dunbar_layer,
        "dunbar_name": config["name"],
        "days_since_contact": days_since,
        "components": {
            "recency": round(recency_score, 1),
            "frequency": round(frequency_score, 1),
            "sentiment": round(sentiment_score, 1),
            "balance": round(balance_score, 1),
        },
        "recommendations": _get_recommendations(weighted_total, days_since, avg_sentiment, dunbar_layer),
    }


def _get_recommendations(score: float, days: int, sentiment: float, layer: int) -> list[str]:
    """Generate human-readable recommendations."""
    recs = []
    config = DUNBAR_CONFIG.get(layer, DUNBAR_CONFIG[4])

    if days > config["decay_days"]:
        recs.append(f"Давно не общались ({days} дней). Напишите!")

    if sentiment < -0.5:
        recs.append("Последние разговоры были напряжёнными. Стоит обратить внимание.")

    if score < CRITICAL_THRESHOLD and layer <= 2:
        recs.append("⚠️ Критически низкий индекс для близкого человека!")

    if score > 80:
        recs.append("✅ Отношения в отличном состоянии")

    return recs


def batch_compute_scores(people_data: list[dict]) -> list[dict]:
    """Compute health scores for a batch of people."""
    results = []
    for person in people_data:
        score = compute_health_score(
            last_interaction_date=person.get("last_seen", ""),
            dunbar_layer=person.get("dunbar_layer", 4),
            avg_sentiment=person.get("avg_sentiment", 0.0),
            interaction_count_30d=person.get("interaction_count_30d", 0),
            balance_ratio=person.get("balance_ratio", 0.5),
        )
        score["person_id"] = person.get("id")
        score["person_name"] = person.get("name")
        results.append(score)

    # Sort by score ascending (worst first)
    results.sort(key=lambda x: x["score"])
    return results
