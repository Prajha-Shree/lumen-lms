"""Stateless adaptive assessment engine.

The caller (backend) sends the full response history on every call. The engine
re-derives which item should have been asked at each step, so a client can't skip,
repeat or reorder items, and the ml-service needs no database.

Adaptivity: every topic is probed twice. The first probe is medium difficulty; the
second is harder after a correct answer and easier after a wrong one (a two-step
staircase). Mastery is then estimated with a 1-parameter logistic (Rasch) model.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Literal

from app.cognitive.items import (
    ALL_ITEMS,
    PREFERENCE_ITEMS,
    REASONING_ITEMS,
    TOPICS,
    Item,
    diagnostic_for,
)

# Rapid-guess threshold: answers faster than this carry half weight in scoring.
RAPID_GUESS_MS = 1500

Slot = tuple[Literal["item"], str] | tuple[Literal["topic"], str, int]

# Interleaved plan: preferences, then two passes over the topics with reasoning items
# spaced between them to reduce fatigue effects on any one topic.
PLAN: tuple[Slot, ...] = (
    ("item", PREFERENCE_ITEMS[0].id),
    ("item", PREFERENCE_ITEMS[1].id),
    ("item", PREFERENCE_ITEMS[2].id),
    ("topic", TOPICS[0], 1),
    ("topic", TOPICS[1], 1),
    ("item", REASONING_ITEMS[0].id),
    ("topic", TOPICS[2], 1),
    ("topic", TOPICS[3], 1),
    ("item", REASONING_ITEMS[1].id),
    ("topic", TOPICS[4], 1),
    ("topic", TOPICS[0], 2),
    ("topic", TOPICS[1], 2),
    ("item", REASONING_ITEMS[2].id),
    ("topic", TOPICS[2], 2),
    ("topic", TOPICS[3], 2),
    ("topic", TOPICS[4], 2),
)
TOTAL_ITEMS = len(PLAN)


@dataclass(frozen=True)
class Response:
    item_id: str
    answer: str
    response_time_ms: int
    confidence: int | None = None  # 1 (guessing) .. 4 (certain); None for preference items


class SequenceError(ValueError):
    """The response history doesn't match what the engine would have asked."""


def is_correct(item: Item, answer: str) -> bool:
    return item.correct is not None and answer == item.correct


def _resolve(slot: Slot, history: list[Response]) -> Item:
    if slot[0] == "item":
        return ALL_ITEMS[slot[1]]
    _, topic, probe = slot
    if probe == 1:
        return diagnostic_for(topic, 2)
    first = next(r for r in history if ALL_ITEMS[r.item_id].topic == topic and ALL_ITEMS[r.item_id].kind == "diagnostic")
    return diagnostic_for(topic, 3 if is_correct(ALL_ITEMS[first.item_id], first.answer) else 1)


def next_item(history: list[Response]) -> Item | None:
    """The item to ask after `history`, or None when the assessment is complete."""
    if len(history) >= TOTAL_ITEMS:
        return None
    return _resolve(PLAN[len(history)], history)


def validate(history: list[Response]) -> None:
    for i, r in enumerate(history):
        if i >= TOTAL_ITEMS:
            raise SequenceError("More responses than the assessment has items")
        expected = _resolve(PLAN[i], history[:i])
        if r.item_id != expected.id:
            raise SequenceError(f"Response {i + 1} answers '{r.item_id}' but '{expected.id}' was asked")
        if r.answer not in {o.id for o in expected.options}:
            raise SequenceError(f"'{r.answer}' is not an option for '{expected.id}'")
        if expected.kind != "preference" and (r.confidence is None or not 1 <= r.confidence <= 4):
            raise SequenceError(f"'{expected.id}' requires a confidence rating from 1 to 4")


# ─── Scoring ──────────────────────────────────────────────────────────────────


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def rasch_ability(observations: list[tuple[float, bool, float]]) -> float:
    """MAP estimate of ability θ under a Rasch model with a N(0, 1) prior.

    observations: (item difficulty b, correct, weight). The prior keeps estimates
    finite when every answer is right or wrong, which is common with few items.
    """
    theta = 0.0
    for _ in range(25):
        grad = -theta
        hess = -1.0
        for b, y, w in observations:
            p = _sigmoid(theta - b)
            grad += w * ((1.0 if y else 0.0) - p)
            hess -= w * p * (1 - p)
        step = grad / hess
        theta -= step
        if abs(step) < 1e-6:
            break
    return theta


def _difficulty_param(level: int) -> float:
    # Difficulty levels 1..3 → Rasch b of -1.2, 0, +1.2.
    return (level - 2) * 1.2


@dataclass(frozen=True)
class Profile:
    modality: dict[str, float]
    pace: str
    processing_speed: float
    calibration: float
    topic_mastery: dict[str, float]
    strengths: list[str]
    growth_areas: list[str]
    summary: str
    rapid_guesses: int


def score(history: list[Response]) -> Profile:
    validate(history)
    if len(history) < TOTAL_ITEMS:
        raise SequenceError("Assessment is not complete")

    # Preferences
    modality = {"reading": 0.0, "video": 0.0, "interactive": 0.0}
    pace_votes: dict[str, float] = {}
    for r in history:
        item = ALL_ITEMS[r.item_id]
        if item.kind != "preference":
            continue
        weights = next(o.weights for o in item.options if o.id == r.answer)
        target = modality if item.dimension == "modality" else pace_votes
        for k, v in weights.items():
            target[k] = target.get(k, 0.0) + v
    total = sum(modality.values()) or 1.0
    modality = {k: round(v / total, 2) for k, v in modality.items()}

    # Knowledge + reasoning
    scored = [r for r in history if ALL_ITEMS[r.item_id].kind != "preference"]
    rapid = sum(1 for r in scored if r.response_time_ms < RAPID_GUESS_MS)
    by_topic: dict[str, list[tuple[float, bool, float]]] = {}
    for r in scored:
        item = ALL_ITEMS[r.item_id]
        weight = 0.5 if r.response_time_ms < RAPID_GUESS_MS else 1.0
        by_topic.setdefault(item.topic or "general", []).append(
            (_difficulty_param(item.difficulty), is_correct(item, r.answer), weight)
        )
    topic_mastery = {t: round(_sigmoid(rasch_ability(obs)), 2) for t, obs in by_topic.items()}

    # Processing speed: median of (actual / expected) time, mapped so that answering at
    # the expected pace ≈ 0.75 and twice as slow ≈ 0.3. Rapid guesses are excluded.
    ratios = [
        (r.response_time_ms / 1000) / ALL_ITEMS[r.item_id].expected_seconds
        for r in scored
        if r.response_time_ms >= RAPID_GUESS_MS
    ]
    median_ratio = statistics.median(ratios) if ratios else 1.0
    processing_speed = round(min(1.0, max(0.05, 1.2 - 0.45 * median_ratio)), 2)

    # Calibration: mean(correct − confidence). Positive → under-confident.
    calibration = round(
        statistics.fmean(
            (1.0 if is_correct(ALL_ITEMS[r.item_id], r.answer) else 0.0) - (r.confidence or 2) / 4 for r in scored
        ),
        2,
    )

    pace = max(pace_votes, key=pace_votes.get) if pace_votes else "balanced"
    mean_mastery = statistics.fmean(topic_mastery.values())
    if pace == "steady" and processing_speed > 0.75 and mean_mastery > 0.7:
        pace = "balanced"
    elif pace == "accelerated" and (processing_speed < 0.35 or mean_mastery < 0.35):
        pace = "balanced"

    ranked = sorted(topic_mastery.items(), key=lambda kv: kv[1], reverse=True)
    strengths = [t for t, m in ranked if m >= 0.6][:3]
    growth = [t for t, m in reversed(ranked) if m < 0.5][:3]
    if not growth:
        growth = [ranked[-1][0]]

    return Profile(
        modality=modality,
        pace=pace,
        processing_speed=processing_speed,
        calibration=calibration,
        topic_mastery=topic_mastery,
        strengths=strengths,
        growth_areas=growth,
        summary=_summary(modality, pace, calibration, strengths, growth),
        rapid_guesses=rapid,
    )


_MODALITY_WORDS = {
    "reading": "clear written explanations",
    "video": "guided video walkthroughs",
    "interactive": "hands-on practice",
}
_PACE_WORDS = {
    "steady": "short, steady sessions with regular review",
    "balanced": "a balance of new material and review",
    "accelerated": "moving quickly and circling back when needed",
}


def _label(topic: str) -> str:
    return topic.replace("-", " ")


def _join(words: list[str]) -> str:
    """'a', 'a and b', 'a, b and c'."""
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"


def _summary(modality: dict[str, float], pace: str, calibration: float, strengths: list[str], growth: list[str]) -> str:
    """Supportive, non-labeling description: preferences and current skills, not fixed traits."""
    top = max(modality, key=modality.get)
    parts = [f"Right now you prefer {_MODALITY_WORDS[top]} and {_PACE_WORDS[pace]}."]
    if strengths:
        parts.append(f"You're already strong in {_join([_label(s) for s in strengths])}.")
    parts.append(f"{_label(growth[0]).capitalize()} is a great place to grow next, and your path will start there.")
    if calibration > 0.15:
        parts.append("You often knew more than you gave yourself credit for, so trust your reasoning a little more.")
    elif calibration < -0.15:
        parts.append("A few confident answers missed the mark, so quick self-checks will help lock concepts in.")
    parts.append("This profile reflects today, not a fixed trait. Retake it anytime as you learn.")
    return " ".join(parts)
