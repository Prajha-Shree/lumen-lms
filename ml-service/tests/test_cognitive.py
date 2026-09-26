from app.cognitive import engine
from app.cognitive.items import ALL_ITEMS


def run(client, choose, rt_ms=20_000, confidence=3):
    """Drives the API end to end. `choose(item)` returns the option id to answer."""
    responses: list[dict] = []
    while True:
        res = client.post("/cognitive/next", json={"responses": responses})
        assert res.status_code == 200, res.text
        body = res.json()
        if body["done"]:
            return body["profile"], responses
        item = body["item"]
        assert "correct" not in item  # never leak the answer key
        responses.append({
            "itemId": item["id"],
            "answer": choose(ALL_ITEMS[item["id"]]),
            "responseTimeMs": rt_ms,
            "confidence": confidence if item["asksConfidence"] else None,
        })


def correct(item):
    return item.correct or item.options[0].id


def wrong(item):
    if item.correct is None:
        return item.options[-1].id
    return next(o.id for o in item.options if o.id != item.correct)


def test_requires_internal_token(client):
    res = client.post("/cognitive/next", json={"responses": []}, headers={"X-Internal-Token": "nope"})
    assert res.status_code == 401


def test_full_run_asks_every_planned_item_once(client):
    _, responses = run(client, correct)
    assert len(responses) == engine.TOTAL_ITEMS
    assert len({r["itemId"] for r in responses}) == engine.TOTAL_ITEMS


def test_staircase_goes_harder_after_correct_and_easier_after_wrong(client):
    _, right = run(client, correct)
    _, missed = run(client, wrong)
    assert "st-3" in {r["itemId"] for r in right} and "st-1" not in {r["itemId"] for r in right}
    assert "st-1" in {r["itemId"] for r in missed} and "st-3" not in {r["itemId"] for r in missed}


def test_mastery_reflects_performance(client):
    strong, _ = run(client, correct)
    weak, _ = run(client, wrong)
    for topic in ("statistics", "probability", "modeling"):
        assert strong["topicMastery"][topic] > 0.7
        assert weak["topicMastery"][topic] < 0.3
    assert strong["strengths"] and weak["growthAreas"]


def test_preferences_drive_modality(client):
    def prefer_video(item):
        if item.kind == "preference" and item.dimension == "modality":
            return "b"
        return correct(item)

    profile, _ = run(client, prefer_video)
    assert profile["modality"]["video"] == max(profile["modality"].values())


def test_calibration_sign(client):
    under, _ = run(client, correct, confidence=1)  # right but unsure
    over, _ = run(client, wrong, confidence=4)  # wrong but certain
    assert under["calibration"] > 0.3
    assert over["calibration"] < -0.3


def test_rapid_guesses_are_counted_and_dampened(client):
    fast, _ = run(client, correct, rt_ms=500)
    normal, _ = run(client, correct)
    assert fast["rapidGuesses"] == engine.TOTAL_ITEMS - 3
    assert fast["topicMastery"]["statistics"] < normal["topicMastery"]["statistics"]


def test_rejects_skipped_or_forged_items(client):
    skip = client.post("/cognitive/next", json={"responses": [{"itemId": "st-3", "answer": "b", "responseTimeMs": 1000}]})
    assert skip.status_code == 422
    bad_option = client.post(
        "/cognitive/next", json={"responses": [{"itemId": "pref-modality-1", "answer": "z", "responseTimeMs": 1000}]}
    )
    assert bad_option.status_code == 422


def test_rasch_estimate_is_monotonic_and_finite():
    all_right = engine.rasch_ability([(0.0, True, 1.0), (1.2, True, 1.0)])
    one_right = engine.rasch_ability([(0.0, True, 1.0), (1.2, False, 1.0)])
    all_wrong = engine.rasch_ability([(0.0, False, 1.0), (-1.2, False, 1.0)])
    assert all_right > one_right > all_wrong
    assert abs(all_right) < 5 and abs(all_wrong) < 5


def test_summary_uses_supportive_non_labeling_language(client):
    profile, _ = run(client, wrong)
    assert "not a fixed trait" in profile["summary"]
