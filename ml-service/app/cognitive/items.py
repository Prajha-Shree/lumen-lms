"""Item bank for the learning-profile assessment.

Three kinds of items:
- preference: self-reported study preferences (no right answer). Framed as current
  preferences, never as fixed "learning styles".
- diagnostic: short knowledge checks per topic at difficulty 1 (intro) .. 3 (stretch).
  Topic tags match the vocabulary used by lessons and exam questions.
- reasoning: general reasoning items (topic "critical-thinking"), also timed.
"""

from dataclasses import dataclass, field
from typing import Literal

ItemKind = Literal["preference", "diagnostic", "reasoning"]


@dataclass(frozen=True)
class Option:
    id: str
    text: str
    # Preference items only: how this answer shifts a dimension (modality weights or pace).
    weights: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class Item:
    id: str
    kind: ItemKind
    prompt: str
    options: tuple[Option, ...]
    topic: str | None = None
    difficulty: int = 2
    correct: str | None = None
    expected_seconds: int = 30
    dimension: Literal["modality", "pace"] | None = None


def _opts(*texts: str) -> tuple[Option, ...]:
    return tuple(Option(id="abcdefgh"[i], text=t) for i, t in enumerate(texts))


PREFERENCE_ITEMS: tuple[Item, ...] = (
    Item(
        id="pref-modality-1",
        kind="preference",
        dimension="modality",
        prompt="When you learn something new, what usually helps you most?",
        options=(
            Option("a", "Reading a clear, well-structured explanation", {"reading": 1.0}),
            Option("b", "Watching someone walk through it", {"video": 1.0}),
            Option("c", "Trying it myself and learning from mistakes", {"interactive": 1.0}),
            Option("d", "A mix of all of these", {"reading": 0.34, "video": 0.33, "interactive": 0.33}),
        ),
    ),
    Item(
        id="pref-modality-2",
        kind="preference",
        dimension="modality",
        prompt="You're stuck on a concept. What's your first move?",
        options=(
            Option("a", "Re-read my notes or the textbook section", {"reading": 1.0}),
            Option("b", "Find a video that explains it differently", {"video": 1.0}),
            Option("c", "Work through a practice problem step by step", {"interactive": 1.0}),
        ),
    ),
    Item(
        id="pref-pace",
        kind="preference",
        dimension="pace",
        prompt="Which study rhythm suits you best right now?",
        options=(
            Option("a", "Short, steady sessions with plenty of review", {"steady": 1.0}),
            Option("b", "A balanced mix of new material and review", {"balanced": 1.0}),
            Option("c", "Moving quickly, then circling back if needed", {"accelerated": 1.0}),
        ),
    ),
)

_EXPECTED = {1: 20, 2: 30, 3: 45}


def _diag(item_id: str, topic: str, difficulty: int, prompt: str, options: tuple[str, ...], correct: str) -> Item:
    return Item(
        id=item_id,
        kind="diagnostic",
        topic=topic,
        difficulty=difficulty,
        prompt=prompt,
        options=_opts(*options),
        correct=correct,
        expected_seconds=_EXPECTED[difficulty],
    )


DIAGNOSTIC_ITEMS: tuple[Item, ...] = (
    # data-literacy
    _diag("dl-1", "data-literacy", 1, "Which of these is categorical data?",
          ("Height in centimetres", "Favourite colour", "Temperature in °C", "Number of pets"), "b"),
    _diag("dl-2", "data-literacy", 2,
          "A survey rates satisfaction from 1 (very poor) to 5 (excellent). Why is averaging these codes risky?",
          ("It isn't risky at all", "The gaps between levels may not be equal", "Averages only work for money",
           "Survey data can't be analyzed"), "b"),
    _diag("dl-3", "data-literacy", 3, "Which question can data answer most directly?",
          ("Is our school the best?", "Do students who attend review sessions score higher on the final than those who don't?",
           "Should everyone study more?", "Is learning fun?"), "b"),
    # statistics
    _diag("st-1", "statistics", 1, "What is the median of 3, 7, 9, 12, 40?", ("9", "14.2", "12", "7"), "a"),
    _diag("st-2", "statistics", 2, "A few very large values are added to a dataset. Which summary changes most?",
          ("Median", "Mean", "Mode", "Number of categories"), "b"),
    _diag("st-3", "statistics", 3,
          "Two classes have the same mean score, but class A has a much larger standard deviation. What does that tell you?",
          ("Class A did better", "Class A's scores are more spread out", "Class A has more students",
           "Nothing useful"), "b"),
    # probability
    _diag("pr-1", "probability", 1, "A fair six-sided die is rolled. What is the probability of rolling a 6?",
          ("1/6", "1/3", "1/2", "6"), "a"),
    _diag("pr-2", "probability", 2, "Two fair coins are flipped. What is the probability of at least one head?",
          ("1/4", "1/2", "3/4", "1"), "c"),
    _diag("pr-3", "probability", 3,
          "1% of people have a condition. A test is 90% accurate for both sick and healthy people. "
          "You test positive. Roughly how likely is it that you have the condition?",
          ("About 90%", "About 50%", "About 8%", "About 1%"), "c"),
    # visualization
    _diag("vz-1", "visualization", 1, "Which chart best shows how a value changes over time?",
          ("Pie chart", "Line chart", "Word cloud", "Table of contents"), "b"),
    _diag("vz-2", "visualization", 2, "A bar chart's y-axis starts at 95 instead of 0. What's the risk?",
          ("None", "Small differences look much larger than they are", "Bars become invisible",
           "It turns into a line chart"), "b"),
    _diag("vz-3", "visualization", 3,
          "You want to show the relationship between hours studied and exam score for 200 students. Best choice?",
          ("Pie chart", "Scatter plot", "Stacked bar of averages", "A single summary number"), "b"),
    # modeling
    _diag("md-1", "modeling", 1, "A model predicts house prices from their size. In this model, 'size' is…",
          ("The target", "An input feature", "The error", "The dataset"), "b"),
    _diag("md-2", "modeling", 2, "A model is 99% accurate on its training data but 60% on new data. This is called…",
          ("Underfitting", "Overfitting", "Regularization", "Sampling"), "b"),
    _diag("md-3", "modeling", 3,
          "Only 1 in 100 transactions is fraud. A model predicts 'not fraud' for everything and scores 99% accuracy. "
          "What's the problem?",
          ("Nothing, it's excellent", "Accuracy hides that it catches zero fraud", "The dataset is too large",
           "Models can't predict fraud"), "b"),
)

REASONING_ITEMS: tuple[Item, ...] = (
    Item(id="rs-1", kind="reasoning", topic="critical-thinking", difficulty=2, expected_seconds=40, correct="c",
         prompt="What comes next: 2, 6, 12, 20, 30, …?", options=_opts("36", "40", "42", "44")),
    Item(id="rs-2", kind="reasoning", topic="critical-thinking", difficulty=2, expected_seconds=40, correct="d",
         prompt="All bloops are razzies. Some razzies are lazzies. Which must be true?",
         options=_opts("All bloops are lazzies", "Some bloops are lazzies", "No bloops are lazzies",
                       "None of these must be true")),
    Item(id="rs-3", kind="reasoning", topic="critical-thinking", difficulty=2, expected_seconds=40, correct="c",
         prompt="Ice-cream sales and drowning incidents both rise in summer. What's the best conclusion?",
         options=_opts("Ice cream causes drowning", "Drowning causes ice-cream sales",
                       "A third factor, like warm weather, likely drives both", "The data must be wrong")),
)

TOPICS: tuple[str, ...] = ("data-literacy", "statistics", "probability", "visualization", "modeling")

ALL_ITEMS: dict[str, Item] = {i.id: i for i in (*PREFERENCE_ITEMS, *DIAGNOSTIC_ITEMS, *REASONING_ITEMS)}


def diagnostic_for(topic: str, difficulty: int) -> Item:
    return next(i for i in DIAGNOSTIC_ITEMS if i.topic == topic and i.difficulty == difficulty)
