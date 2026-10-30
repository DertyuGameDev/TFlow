"""Package the tested frontend and Django source, never local data or secrets."""

import hashlib
import json
import os
from pathlib import Path
import tarfile

project = Path(__file__).resolve().parents[1]
output = project.parent / "release"
output.mkdir(exist_ok=True)
archive = output / "tflow-release.tar.gz"
allowed = [project / name for name in ("backend", "dist", "public")]
excluded_parts = {"data", "staticfiles", "__pycache__", "tests", ".venv", "node_modules"}

if not (project / "dist" / "index.html").is_file():
    raise SystemExit("Build the frontend before creating a release")

with tarfile.open(archive, "w:gz") as bundle:
    for root in allowed:
        for path in sorted(root.rglob("*")):
            relative = path.relative_to(project)
            if not path.is_file() or path.is_symlink():
                continue
            if excluded_parts.intersection(relative.parts):
                continue
            if path.name.startswith(".env") or path.suffix in {".pyc", ".sqlite3"}:
                continue
            bundle.add(path, arcname=str(Path("tflow") / relative), recursive=False)

manifest = {
    "commit": os.environ.get("CI_COMMIT_SHA", "local"),
    "pipeline_id": os.environ.get("CI_PIPELINE_ID"),
    "archive": archive.name,
    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
}
(output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Release prepared: {archive.name} ({archive.stat().st_size} bytes)")
