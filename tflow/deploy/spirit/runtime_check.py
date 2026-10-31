"""Verify the exact process, HTML and entry assets, rather than any healthy app."""
import hashlib
import json
from urllib.request import Request, urlopen


def verify_runtime(manifest, host, base="http://127.0.0.1:8000", open_url=urlopen):
    def read(path):
        request = Request(base + path, headers={"Host": host, "X-Forwarded-Proto": "https", "Cache-Control": "no-cache"})
        with open_url(request, timeout=3) as response:
            if response.status != 200:
                raise RuntimeError("Runtime endpoint returned an unexpected status")
            return response.read()
    if json.loads(read("/api/version")).get("id") != manifest["commit"]:
        raise RuntimeError("Running application does not identify the requested release")
    frontend = manifest["frontend"]
    if hashlib.sha256(read("/")).hexdigest() != frontend["index_sha256"]:
        raise RuntimeError("Running application serves another frontend HTML")
    for path, expected in frontend["assets"].items():
        if not path.startswith("/assets/") or ".." in path or "?" in path or "#" in path:
            raise RuntimeError("Unsupported release asset path")
        if hashlib.sha256(read(path)).hexdigest() != expected:
            raise RuntimeError("Running application serves a stale frontend asset")
