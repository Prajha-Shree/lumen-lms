"""Recommender contract.

Any strategy (rule-based today, a learned ranker later) implements `Recommender.rank`.
The API and the backend depend only on this interface, so swapping the strategy is a
config change (`RECOMMENDER` setting), not an API change.

Where a trained model plugs in: the backend logs every recommendation with the
features below plus `clickedAt` (set when the learner completes the lesson). That log
is a ready-made training set for a learning-to-rank model (e.g. a PyTorch or
gradient-boosted ranker on [mastery gap, difficulty fit, modality fit, position,
in-progress, pace] → followed?). Implement `rank()` with the model's scores and
register it in `registry.py`.
"""

from dataclasses import dataclass, field
from typing import Literal, Protocol

Format = Literal["READING", "VIDEO", "INTERACTIVE"]
Status = Literal["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]


@dataclass(frozen=True)
class Candidate:
    lesson_id: str
    course_id: str
    title: str
    topics: tuple[str, ...]
    difficulty: int  # 1..5
    format: Format
    duration_minutes: int
    position: int  # global order within its course (module order, then lesson order)
    status: Status


@dataclass(frozen=True)
class LearnerProfile:
    modality: dict[str, float]
    pace: str
    topic_mastery: dict[str, float]
    growth_areas: tuple[str, ...]


@dataclass(frozen=True)
class RankRequest:
    candidates: tuple[Candidate, ...]
    profile: LearnerProfile | None
    performance: dict[str, float] = field(default_factory=dict)  # topic → recent exam correctness 0..1
    recently_shown: frozenset[str] = frozenset()  # lesson ids suggested lately but not followed
    limit: int = 3


@dataclass(frozen=True)
class Scored:
    lesson_id: str
    score: float
    reasons: tuple[str, ...]
    strategy: str


class Recommender(Protocol):
    name: str

    def rank(self, req: RankRequest) -> list[Scored]: ...
