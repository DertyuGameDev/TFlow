"""Build the frontend, then apply additive schema migrations; never seed or reset."""
import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
env = {**os.environ, "VITE_ASSET_BASE": "/static/app/"}
subprocess.run(["npm", "ci", "--no-audit", "--no-fund"], cwd=root, check=True)
subprocess.run(["npm", "run", "build"], cwd=root, env=env, check=True)
subprocess.run([sys.executable, "manage.py", "migrate", "--noinput"], cwd=root, check=True)
