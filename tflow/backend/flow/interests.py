import json
from pathlib import Path

# Shared with React's event topics and profile picker.
INTEREST_CATEGORIES = json.loads((Path(__file__).resolve().parents[2] / "public" / "interest-categories.json").read_text(encoding="utf-8"))
INTEREST_CHOICES = [(category, category) for category in INTEREST_CATEGORIES]
