from app.recommender.base import Candidate, LearnerProfile, RankRequest
from app.recommender.rule_based import RuleBasedRecommender

rec = RuleBasedRecommender()


def lesson(i, topics=("statistics",), difficulty=2, fmt="READING", status="NOT_STARTED", course="c1"):
    return Candidate(f"l{i}", course, f"Lesson {i}", tuple(topics), difficulty, fmt, 10, i, status)


def profile(**overrides):
    base = dict(
        modality={"reading": 0.2, "video": 0.6, "interactive": 0.2},
        pace="balanced",
        topic_mastery={"statistics": 0.8, "probability": 0.2, "visualization": 0.6},
        growth_areas=("probability",),
    )
    base.update(overrides)
    return LearnerProfile(**base)


def ids(scored):
    return [s.lesson_id for s in scored]


def test_never_recommends_completed_lessons():
    out = rec.rank(RankRequest(candidates=(lesson(0, status="COMPLETED"), lesson(1)), profile=None))
    assert ids(out) == ["l1"]


def test_everything_done_returns_nothing():
    assert rec.rank(RankRequest(candidates=(lesson(0, status="COMPLETED"),), profile=None)) == []


def test_without_a_profile_follows_course_order():
    cands = tuple(lesson(i) for i in range(5))
    out = rec.rank(RankRequest(candidates=cands, profile=None, limit=3))
    assert ids(out) == ["l0", "l1", "l2"]
    assert all(s.strategy == "sequential-fallback" for s in out)


def test_in_progress_lesson_comes_first_with_reason():
    cands = (lesson(0), lesson(1, status="IN_PROGRESS"), lesson(2))
    out = rec.rank(RankRequest(candidates=cands, profile=profile()))
    assert out[0].lesson_id == "l1"
    assert "Pick up where you left off" in out[0].reasons


def test_weak_growth_topic_outranks_mastered_topic():
    cands = (lesson(0, topics=("statistics",)), lesson(1, topics=("probability",), difficulty=1))
    out = rec.rank(RankRequest(candidates=cands, profile=profile(), limit=1))
    assert ids(out) == ["l1"]
    assert any("probability" in r for r in out[0].reasons)


def test_recent_exam_performance_overrides_the_profile():
    # Profile says statistics is strong, but the learner just did badly on it.
    cands = (lesson(0, topics=("statistics",), difficulty=1), lesson(1, topics=("visualization",), difficulty=3))
    out = rec.rank(RankRequest(candidates=cands, profile=profile(growth_areas=()), performance={"statistics": 0.1}, limit=1))
    assert ids(out) == ["l0"]
    assert any("recent exam results" in r for r in out[0].reasons)


def test_difficulty_tracks_mastery():
    easy = lesson(0, topics=("probability",), difficulty=1)
    hard = lesson(1, topics=("probability",), difficulty=5)
    low = rec.rank(RankRequest(candidates=(easy, hard), profile=profile(topic_mastery={"probability": 0.1}, growth_areas=()), limit=1))
    high = rec.rank(RankRequest(candidates=(easy, hard), profile=profile(topic_mastery={"probability": 0.95}, growth_areas=()), limit=1))
    assert ids(low) == ["l0"] and ids(high) == ["l1"]


def test_modality_preference_breaks_ties():
    cands = (lesson(0, fmt="READING"), lesson(1, fmt="VIDEO"))
    out = rec.rank(RankRequest(candidates=cands, profile=profile(), limit=1))
    assert ids(out) == ["l1"]


def test_steady_learners_are_not_sent_far_ahead():
    cands = tuple(lesson(i, topics=("probability",) if i == 9 else ("statistics",)) for i in range(10))
    out = rec.rank(RankRequest(candidates=cands, profile=profile(pace="steady"), limit=5))
    assert "l9" not in ids(out)


def test_ignored_suggestions_rotate_out():
    cands = (lesson(0), lesson(1))
    first = rec.rank(RankRequest(candidates=cands, profile=profile(), limit=1))
    rotated = rec.rank(RankRequest(candidates=cands, profile=profile(), recently_shown=frozenset(ids(first)), limit=1))
    assert ids(first) != ids(rotated)


def test_diversity_breaks_near_ties_toward_a_new_topic():
    # Equally weak topics; l1 is marginally ahead of l2 only by course order.
    even = profile(topic_mastery={"probability": 0.2, "visualization": 0.2}, growth_areas=())
    cands = (
        lesson(0, topics=("probability",), difficulty=1),
        lesson(1, topics=("probability",), difficulty=1),
        lesson(2, topics=("visualization",), difficulty=1),
    )
    out = rec.rank(RankRequest(candidates=cands, profile=even, limit=2))
    assert ids(out) == ["l0", "l2"]


def test_diversity_does_not_override_a_clearly_better_match():
    cands = (
        lesson(0, topics=("probability",), difficulty=1),
        lesson(1, topics=("probability",), difficulty=1),
        lesson(2, topics=("statistics",), difficulty=1),  # already mastered
    )
    out = rec.rank(RankRequest(candidates=cands, profile=profile(), limit=2))
    assert ids(out) == ["l0", "l1"]


def test_api_contract(client):
    res = client.post(
        "/recommendations",
        json={
            "candidates": [
                {"lessonId": "a", "courseId": "c", "title": "A", "topics": ["probability"], "difficulty": 2,
                 "format": "VIDEO", "durationMinutes": 10, "position": 0, "status": "NOT_STARTED"},
                {"lessonId": "b", "courseId": "c", "title": "B", "topics": ["statistics"], "difficulty": 2,
                 "format": "READING", "durationMinutes": 10, "position": 1, "status": "COMPLETED"},
            ],
            "profile": {"modality": {"video": 1}, "pace": "balanced", "topicMastery": {"probability": 0.3},
                        "growthAreas": ["probability"]},
            "limit": 3,
        },
    )
    assert res.status_code == 200
    body = res.json()["recommendations"]
    assert [r["lessonId"] for r in body] == ["a"]
    assert body[0]["strategy"] == "rule-based-v1" and body[0]["reasons"]
