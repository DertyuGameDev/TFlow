"""Bounded local encoder worker. No public listener or media port is opened."""
import fcntl
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time

from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone

from .broadcasts import media_dir, root, live
from .webinars import start_time
from .models import HttpBroadcast


def encoder_command(broadcast):
    directory = media_dir(broadcast)
    return [settings.HTTP_BROADCAST_FFMPEG, "-hide_banner", "-loglevel", "error", "-nostdin",
            "-max_alloc", "67108864", "-threads", "1", "-filter_threads", "1",
            "-protocol_whitelist", "pipe,file", "-f", "matroska" if broadcast.mime == "video/webm" else "mov",
            "-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0",
            "-vf", "scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2",
            "-r", "15", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
            "-threads", "1", "-pix_fmt", "yuv420p", "-b:v", "800k", "-maxrate", "1000k", "-bufsize", "2000k",
            "-g", "30", "-keyint_min", "30", "-sc_threshold", "0",
            "-c:a", "aac", "-b:a", "96k", "-ar", "48000", "-ac", "2",
            "-f", "hls", "-hls_time", "2", "-hls_list_size", "5", "-hls_delete_threshold", "2",
            "-hls_flags", "delete_segments+independent_segments+temp_file",
            "-hls_segment_filename", str(directory / "segment-%09d.ts"), str(directory / "index.m3u8")]


class Encoder:
    def __init__(self, broadcast):
        self.pk, self.session, self.directory = broadcast.pk, broadcast.session, media_dir(broadcast)
        self.sequence, self.pending, self.offset = 0, None, 0
        self.last_write = time.monotonic()
        self.process = subprocess.Popen(encoder_command(broadcast), stdin=subprocess.PIPE,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.set_blocking(self.process.stdin.fileno(), False)

    def feed(self, broadcast):
        if self.process.poll() is not None:
            raise RuntimeError("ENCODER_FAILED")
        if self.pending is None and self.sequence <= broadcast.received_seq:
            path = self.directory / f"input-{self.sequence:09d}.bin"
            if path.exists():
                self.pending, self.offset = path.read_bytes(), 0
        if self.pending is not None:
            try:
                written = os.write(self.process.stdin.fileno(), self.pending[self.offset:self.offset + 65536])
                self.offset += written
                self.last_write = time.monotonic()
            except BlockingIOError:
                if time.monotonic() - self.last_write > 20:
                    raise RuntimeError("ENCODER_STALLED") from None
            if self.offset == len(self.pending):
                (self.directory / f"input-{self.sequence:09d}.bin").unlink(missing_ok=True)
                self.sequence += 1
                self.pending = None

    def close(self):
        try: self.process.stdin.close()
        except (BrokenPipeError, OSError): pass
        try:
            self.process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=2)


def run_worker(stop=None):
    if not settings.HTTP_BROADCAST_ENABLED or not shutil.which(settings.HTTP_BROADCAST_FFMPEG):
        raise RuntimeError("Enable TFLOW_HTTP_BROADCAST and install FFmpeg before starting the worker")
    os.umask(0o077)
    root().mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = (root() / "worker.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    stopped = False
    def shutdown(*args):
        nonlocal stopped
        stopped = True
    if stop is None:
        signal.signal(signal.SIGTERM, shutdown)
        signal.signal(signal.SIGINT, shutdown)
    encoders = {}
    cleanup = 0
    queried = 0
    active = []
    try:
        while not stopped and not (stop and stop()):
            if time.monotonic() - queried > 0.5:
                close_old_connections()
                (root() / "worker").touch()
                active = list(HttpBroadcast.objects.filter(active=True).select_related("event", "activity"))
                queried = time.monotonic()
            desired = set()
            for broadcast in active:
                ends = min(broadcast.event.ends_at, broadcast.activity.ends_at if broadcast.activity else broadcast.event.ends_at)
                if broadcast.event.status != "published" or ends <= timezone.now():
                    HttpBroadcast.objects.filter(pk=broadcast.pk, session=broadcast.session).update(active=False, publisher_hash="")
                    continue
                if not live(broadcast) or timezone.now() < start_time(broadcast.event, broadcast.activity): continue
                session = (broadcast.session, broadcast.media_epoch)
                desired.add(session)
                try:
                    if session not in encoders:
                        if len(encoders) >= settings.HTTP_BROADCAST_MAX_STREAMS:
                            continue
                        if broadcast.received_seq >= 0 and not (media_dir(broadcast) / "input-000000000.bin").exists():
                            HttpBroadcast.objects.filter(pk=broadcast.pk, media_epoch=broadcast.media_epoch).update(failure="ENCODER_RESTARTED")
                            continue
                        encoders[session] = Encoder(broadcast)
                    encoders[session].feed(broadcast)
                except (OSError, RuntimeError) as error:
                    reason = str(error) if str(error) in {"ENCODER_FAILED", "ENCODER_STALLED"} else "ENCODER_FAILED"
                    HttpBroadcast.objects.filter(pk=broadcast.pk, session=broadcast.session, media_epoch=broadcast.media_epoch).update(failure=reason)
                    desired.discard(session)
            for session in set(encoders) - desired:
                encoders.pop(session).close()
            if time.monotonic() - cleanup > 30:
                current_paths = {media_dir(b) for b in active}
                for b in active:
                    for previous in (root() / str(b.session)).glob("media-*"):
                        if previous.is_dir() and previous not in current_paths and time.time() - previous.stat().st_mtime > 180:
                            shutil.rmtree(previous)
                for directory in root().iterdir():
                    if directory.is_dir() and directory.name not in {str(x[0]) for x in desired} and time.time() - directory.stat().st_mtime > 180:
                        shutil.rmtree(directory)
                cleanup = time.monotonic()
            time.sleep(0.05)
    finally:
        for encoder in encoders.values():
            encoder.close()
        (root() / "worker").unlink(missing_ok=True)
        lock.close()
