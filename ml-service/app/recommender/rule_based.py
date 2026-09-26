"""Transparent, rule-based ranking.

score = Σ weight_i · feature_i, every feature in [0, 1]. Kept deliberately simple and
explainable: each suggestion comes with the reasons that contributed most, so a
learner (or instructor) can see *why* something was suggested.
"""

from __future__ import annotations

from app.recommender.base import Candidate, RankRequest, Scored

WEIGHTS = {
    "gap": 0.32,  # how much the lesson's weakest topic needs work
    "difficulty_fit": 0.22,  # closeness to the learner's current level (zone of proximal development)
    "continuity": 0.18,  # in-progress lessons and course order
    "modality": 0.13,  # preferred format
    "growth": 0.10,  # targets a named growth area
    "freshness": 0.05,  # rotate away from suggestions that were ignored recently
}

FORMAT_TO_MODALITY = {"READING": "reading", "VIDEO": "video", "INTERACTIVE": "interactive"}
PACE_SHIFT = {"steady": -0.5, "balanced": 0.0, "accelerated": 0.6}
DEFAULT_MASTERY = 0.5
# Lessons more than this many steps past the learner's first unfinished lesson are
# held back for "steady" learners (they may lack prerequisites).
LOOKAHEAD = {"steady": 3, "balanced": 5, "accelerated": 8}
DIVERSITY_PENALTY = 0.06


def _label(topic: str) -> str:
    return topic.replace("-", " ")


class RuleBasedRecommender:
    name = "rule-based-v1"

    def rank(self, req: RankRequest) -> list[Scored]:
        open_lessons = [c for c in req.candidates if c.status != "COMPLETED"]
        if not open_lessons:
            return []

        strategy = self.name if req.profile else "sequential-fallback"
        pace = req.profile.pace if req.profile else "balanced"

        # Position of the first unfinished lesson per course anchors "course order".
        frontier: dict[str, int] = {}
        span: dict[str, int] = {}
        for c in req.candidates:
            span[c.course_id] = max(span.get(c.course_id, 0), c.position + 1)
            if c.status != "COMPLETED":
                frontier[c.course_id] = min(frontier.get(c.course_id, c.position), c.position)

        scored: list[tuple[float, dict[str, float], Candidate]] = []
        for c in open_lessons:
            ahead = c.position - frontier[c.course_id]
            if ahead > LOOKAHEAD.get(pace, 5) and c.status != "IN_PROGRESS":
                continue
            features = self._features(c, req, pace, ahead, span[c.course_id])
            total = sum(WEIGHTS[k] * v for k, v in features.items())
            scored.append((total, features, c))

        scored.sort(key=lambda t: t[0], reverse=True)

        # Greedy diversity: slightly penalize candidates that repeat a chosen topic.
        chosen: list[Scored] = []
        covered: set[str] = set()
        pool = scored[:]
        while pool and len(chosen) < req.limit:
            adjusted = [
                (s - DIVERSITY_PENALTY * len(covered.intersection(c.topics)), f, c) for s, f, c in pool
            ]
            best = max(adjusted, key=lambda t: t[0])
            pool = [t for t in pool if t[2].lesson_id != best[2].lesson_id]
            score, features, c = best
            covered.update(c.topics)
            chosen.append(
                Scored(
                    lesson_id=c.lesson_id,
                    score=round(max(0.0, score), 3),
                    reasons=tuple(self._reasons(c, features, req)),
                    strategy=strategy,
                )
            )
        return chosen

    # ─── Features ─────────────────────────────────────────────────────────────

    @staticmethod
    def mastery(topic: str, req: RankRequest) -> float:
        profile_m = req.profile.topic_mastery.get(topic) if req.profile else None
        exam_m = req.performance.get(topic)
        if profile_m is not None and exam_m is not None:
            return 0.4 * profile_m + 0.6 * exam_m  # recent exam evidence weighs more
        if exam_m is not None:
            return exam_m
        if profile_m is not None:
            return profile_m
        return DEFAULT_MASTERY

    def _features(self, c: Candidate, req: RankRequest, pace: str, ahead: int, course_len: int) -> dict[str, float]:
        topic_m = [self.mastery(t, req) for t in c.topics] or [DEFAULT_MASTERY]
        weakest = min(topic_m)

        # Target difficulty on the 1..5 scale rises with mastery; pace shifts it.
        target = 1 + 4 * weakest + PACE_SHIFT.get(pace, 0.0)
        difficulty_fit = max(0.0, 1 - abs(c.difficulty - target) / 4)

        # Resuming beats starting something new; unstarted lessons decay with distance
        # from the learner's frontier in course order.
        if c.status == "IN_PROGRESS":
            continuity = 1.0
        else:
            continuity = 0.85 * max(0.0, 1 - ahead / max(4, course_len))

        if req.profile:
            prefs = req.profile.modality
            top = max(prefs.values()) or 1.0
            modality = prefs.get(FORMAT_TO_MODALITY[c.format], 0.0) / top
            growth = 1.0 if set(c.topics).intersection(req.profile.growth_areas) else 0.0
        else:
            modality, growth = 0.5, 0.0

        # Without any learner evidence, lean fully on course order.
        gap = 1 - weakest if (req.profile or req.performance) else 0.0

        return {
            "gap": gap,
            "difficulty_fit": difficulty_fit,
            "continuity": continuity,
            "modality": modality,
            "growth": growth,
            "freshness": 0.0 if c.lesson_id in req.recently_shown else 1.0,
        }

    def _reasons(self, c: Candidate, f: dict[str, float], req: RankRequest) -> list[str]:
        reasons: list[tuple[float, str]] = []
        if c.status == "IN_PROGRESS":
            reasons.append((1.0, "Pick up where you left off"))
        if f["growth"] and req.profile:
            topic = next(t for t in c.topics if t in req.profile.growth_areas)
            reasons.append((0.9, f"Builds {_label(topic)}, one of your growth areas"))
        elif f["gap"] >= 0.45 and c.topics:
            weakest = min(c.topics, key=lambda t: self.mastery(t, req))
            source = "recent exam results" if weakest in req.performance else "your profile"
            reasons.append((0.8, f"Strengthens {_label(weakest)} (based on {source})"))
        if f["difficulty_fit"] >= 0.8 and (req.profile or req.performance):
            reasons.append((0.6, "Right level of challenge for you now"))
        if req.profile and f["modality"] >= 0.99:
            fmt = {"READING": "reading", "VIDEO": "video", "INTERACTIVE": "hands-on"}[c.format]
            reasons.append((0.5, f"Matches your preference for {fmt} lessons"))
        if f["continuity"] >= 0.8 and c.status != "IN_PROGRESS":
            reasons.append((0.4, "Next in your course"))
        if not reasons:
            reasons.append((0.1, "Keeps your course moving forward"))
        reasons.sort(key=lambda r: r[0], reverse=True)
        return [text for _, text in reasons[:3]]
