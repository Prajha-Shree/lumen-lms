from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.cognitive import engine
from app.cognitive.items import Item
from app.security import require_internal_token

router = APIRouter(prefix="/cognitive", tags=["cognitive"], dependencies=[Depends(require_internal_token)])


class ResponseIn(BaseModel):
    itemId: str = Field(min_length=1, max_length=64)
    answer: str = Field(min_length=1, max_length=8)
    responseTimeMs: int = Field(ge=0, le=3_600_000)
    confidence: int | None = Field(default=None, ge=1, le=4)


class NextRequest(BaseModel):
    responses: list[ResponseIn] = Field(default_factory=list, max_length=engine.TOTAL_ITEMS)


class OptionOut(BaseModel):
    id: str
    text: str


class ItemOut(BaseModel):
    """What the learner sees: no correct answer, no difficulty, no weights."""

    id: str
    kind: str
    prompt: str
    options: list[OptionOut]
    asksConfidence: bool


class ProfileOut(BaseModel):
    modality: dict[str, float]
    pace: str
    processingSpeed: float
    calibration: float
    topicMastery: dict[str, float]
    strengths: list[str]
    growthAreas: list[str]
    summary: str
    rapidGuesses: int


class NextResponse(BaseModel):
    done: bool
    answered: int
    total: int
    item: ItemOut | None = None
    profile: ProfileOut | None = None


def _public(item: Item) -> ItemOut:
    return ItemOut(
        id=item.id,
        kind=item.kind,
        prompt=item.prompt,
        options=[OptionOut(id=o.id, text=o.text) for o in item.options],
        asksConfidence=item.kind != "preference",
    )


@router.post("/next", response_model=NextResponse)
def next_step(body: NextRequest) -> NextResponse:
    """Validates the history, then returns the next item or, when complete, the profile."""
    history = [engine.Response(r.itemId, r.answer, r.responseTimeMs, r.confidence) for r in body.responses]
    try:
        engine.validate(history)
    except engine.SequenceError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    item = engine.next_item(history)
    if item is not None:
        return NextResponse(done=False, answered=len(history), total=engine.TOTAL_ITEMS, item=_public(item))

    p = engine.score(history)
    return NextResponse(
        done=True,
        answered=len(history),
        total=engine.TOTAL_ITEMS,
        profile=ProfileOut(
            modality=p.modality,
            pace=p.pace,
            processingSpeed=p.processing_speed,
            calibration=p.calibration,
            topicMastery=p.topic_mastery,
            strengths=p.strengths,
            growthAreas=p.growth_areas,
            summary=p.summary,
            rapidGuesses=p.rapid_guesses,
        ),
    )
