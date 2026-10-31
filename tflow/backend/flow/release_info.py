"""Public, non-secret identity of the frontend loaded by this process."""
import json
import re
from django.conf import settings


def release_info():
    try:
        info = json.loads((settings.PROJECT_DIR / "dist" / "version.json").read_text())
        if not isinstance(info, dict):
            return {"id": "development"}
        version = info.get("id", "")
        if re.fullmatch(r"[a-f0-9]{40}", version):
            return {"id": version}
    except (OSError, ValueError, TypeError):
        pass
    return {"id": "development"}
