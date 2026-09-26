from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.recommender.base import Candidate, LearnerProfile, RankRequest
from app.recommender.registry import get_recommender
from app.security import require_internal_token

router = APIRouter(tags=["recommendations"], dependencies=[Depends(require_internal_token)])


class CandidateIn(BaseModel):
    lessonId: str
    courseId: str
    title: str
    topics: list[str] = Field(default_factory=list, max_length=20)
    difficulty: int = Field(ge=1, le=5)
    format: Literal["READING", "VIDEO", "INTERACTIVE"]
    durationMinutes: int = Field(ge=0)
    position: int = Field(ge=0)
    status: Literal["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]


class ProfileIn(BaseModel):
    modality: dict[str, float]
    pace: str
    topicMastery: dict[str, float]
    growthAreas: list[str] = Field(default_factory=list)


class RecommendRequest(BaseModel):
    candidates: list[CandidateIn] = Field(max_length=2000)
    profile: ProfileIn | None = None
    performance: dict[str, float] = Field(default_factory=dict)
    recentlyShown: list[str] = Field(default_factory=list)
    limit: int = Field(default=3, ge=1, le=20)


class RecommendationOut(BaseModel):
    lessonId: str
    score: float
    reasons: list[str]
    strategy: str


class RecommendResponse(BaseModel):
    recommendations: list[RecommendationOut]


@router.post("/recommendations", response_model=RecommendResponse)
def recommend(body: RecommendRequest, settings: Annotated[Settings, Depends(get_settings)]) -> RecommendResponse:
    req = RankRequest(
        candidates=tuple(
            Candidate(
                lesson_id=c.lessonId,
                course_id=c.courseId,
                title=c.title,
                topics=tuple(c.topics),
                difficulty=c.difficulty,
                format=c.format,
                duration_minutes=c.durationMinutes,
                position=c.position,
                status=c.status,
            )
            for c in body.candidates
        ),
        profile=LearnerProfile(
            modality=body.profile.modality,
            pace=body.profile.pace,
            topic_mastery=body.profile.topicMastery,
            growth_areas=tuple(body.profile.growthAreas),
        )
        if body.profile
        else None,
        performance=body.performance,
        recently_shown=frozenset(body.recentlyShown),
        limit=body.limit,
    )
    ranked = get_recommender(settings.recommender).rank(req)
    return RecommendResponse(
        recommendations=[
            RecommendationOut(lessonId=r.lesson_id, score=r.score, reasons=list(r.reasons), strategy=r.strategy)
            for r in ranked
        ]
    )
