from app.recommender.base import Recommender
from app.recommender.rule_based import RuleBasedRecommender

# Register learned rankers here, e.g. "ltr-v1": LearnedRanker.load("models/ltr-v1.pt").
_REGISTRY: dict[str, Recommender] = {"rule-based": RuleBasedRecommender()}


def get_recommender(name: str) -> Recommender:
    try:
        return _REGISTRY[name]
    except KeyError as e:
        raise ValueError(f"Unknown recommender '{name}'. Available: {', '.join(_REGISTRY)}") from e
