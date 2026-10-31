import json
from pathlib import Path

# The same grouped categories are used by event forms and profile interests.
CATEGORY_GROUPS = json.loads(
    Path(__file__).with_name("interest_categories.json").read_text(encoding="utf-8")
)
INTEREST_CATEGORIES = [
    category for group in CATEGORY_GROUPS for category in group["categories"]
]
INTEREST_CHOICES = [
    (group["name"], [(category, category) for category in group["categories"]])
    for group in CATEGORY_GROUPS
]
