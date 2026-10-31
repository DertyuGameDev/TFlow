"""Package the tested frontend and Django source, never local data or secrets."""

import hashlib
import json
import os
from pathlib import Path
import tarfile
import re

project = Path(__file__).resolve().parents[1]
output = project.parent / "release"
output.mkdir(exist_ok=True)
archive = output / "tflow-release.tar.gz"
allowed = [project / name for name in ("backend", "dist", "public", "monitoring")]
excluded_parts = {"data", "staticfiles", "__pycache__", "tests", ".venv", "node_modules", "secrets"}

if not (project / "dist" / "index.html").is_file():
    raise SystemExit("Build the frontend before creating a release")

build_id = json.loads((project / "dist" / "version.json").read_text())["id"]
expected = os.environ.get("CI_COMMIT_SHA") or os.environ.get("GITHUB_SHA") or build_id
if not re.fullmatch(r"[a-f0-9]{40}", expected) or build_id != expected:
    raise SystemExit("Frontend was built from a different commit; rebuild before packaging")
html = (project / "dist" / "index.html").read_bytes()
assets = {}
for asset in re.findall(r'(?:src|href)="(/assets/[^"?#]+)"', html.decode()):
    if ".." in asset:
        raise SystemExit("Unsupported frontend asset path")
    assets[asset] = hashlib.sha256((project / "dist" / asset.lstrip("/")).read_bytes()).hexdigest()
if not assets:
    raise SystemExit("No frontend entry assets found")

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
    "commit": expected,
    "frontend": {"index_sha256": hashlib.sha256(html).hexdigest(), "assets": assets},
    "pipeline_id": os.environ.get("CI_PIPELINE_ID"),
    "archive": archive.name,
    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
}
(output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Release prepared: {archive.name} ({archive.stat().st_size} bytes)")
