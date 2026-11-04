from pathlib import Path


def test_project_documents_candidate_event_limitations():
    readme = Path(__file__).parents[1] / "README.md"
    assert "candidate near-miss" in readme.read_text(encoding="utf-8").lower()
    assert "does not predict accidents" in readme.read_text(encoding="utf-8").lower()
