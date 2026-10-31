"""Exercise two real clients using synthetic media, without opening any devices."""
import asyncio
from array import array
import json
import logging
import math
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen
import uuid

import jwt

from install_video import HOST


def room_token(values, identity, room, publish):
    now = int(time.time())
    return jwt.encode({"iss": values["api_key"], "sub": identity, "name": identity,
        "nbf": now - 5, "exp": now + 180,
        "video": {"roomJoin": True, "room": room, "canPublish": publish,
                  "canSubscribe": True, "canPublishData": True}},
        values["api_secret"], algorithm="HS256")


async def verify(values):
    from livekit import rtc
    logging.disable(logging.CRITICAL)
    name = "tflow-transport-qa-" + uuid.uuid4().hex
    viewer, host = rtc.Room(), rtc.Room()
    audio_received, video_received, data_received = asyncio.Event(), asyncio.Event(), asyncio.Event()
    counts = {"audio_frames": 0, "video_frames": 0, "audio_peak": 0}
    tasks = []
    audio_source = video_source = None
    phase = "viewer connection"

    async def consume(track):
        audio = track.kind == rtc.TrackKind.KIND_AUDIO
        stream = rtc.AudioStream(track, sample_rate=48000, num_channels=1) if audio else rtc.VideoStream(track)
        try:
            async for event in stream:
                if audio:
                    counts["audio_frames"] += 1
                    counts["audio_peak"] = max(counts["audio_peak"], max(map(abs, event.frame.data), default=0))
                    if counts["audio_frames"] >= 30 and counts["audio_peak"] > 500:
                        audio_received.set()
                else:
                    counts["video_frames"] += 1
                    if counts["video_frames"] >= 3:
                        video_received.set()
        finally:
            await stream.aclose()

    @viewer.on("track_subscribed")
    def subscribed(track, publication, participant):
        tasks.append(asyncio.create_task(consume(track)))

    @viewer.on("data_received")
    def received(packet):
        if packet.topic == "tflow-qa" and packet.data == b"synthetic transport check":
            data_received.set()

    try:
        url = values.get("url", "wss://" + HOST + ":8080").rstrip("/")
        options = rtc.RoomOptions(connect_timeout=15)
        await asyncio.wait_for(viewer.connect(url, room_token(values, "qa-viewer", name, False), options=options), 25)
        phase = "host connection"
        await asyncio.wait_for(host.connect(url, room_token(values, "qa-host", name, True), options=options), 25)
        phase = "track publication"
        audio_source, video_source = rtc.AudioSource(48000, 1), rtc.VideoSource(16, 16)
        await asyncio.wait_for(host.local_participant.publish_track(rtc.LocalAudioTrack.create_audio_track("synthetic-audio", audio_source)), 15)
        await asyncio.wait_for(host.local_participant.publish_track(rtc.LocalVideoTrack.create_video_track("synthetic-video", video_source)), 15)
        phase = "media transmission"
        for index in range(400):
            samples = array("h", (int(10000 * math.sin(2 * math.pi * 440 * (index * 480 + i) / 48000)) for i in range(480)))
            await audio_source.capture_frame(rtc.AudioFrame(samples.tobytes(), 48000, 1, 480))
            if index % 10 == 0:
                pixels = bytes([200 if index % 20 else 30, 100, 80, 255]) * 256
                video_source.capture_frame(rtc.VideoFrame(16, 16, rtc.VideoBufferType.RGBA, pixels))
            await asyncio.sleep(0.01)
        phase = "chat transmission"
        await asyncio.wait_for(host.local_participant.publish_data(b"synthetic transport check", reliable=True, topic="tflow-qa"), 15)
        await asyncio.wait_for(asyncio.gather(audio_received.wait(), video_received.wait(), data_received.wait()), 15)
        return {"ok": True, **counts, "chat_received": True}
    except Exception as error:
        return {"ok": False, "phase": phase, "exception": type(error).__name__}
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.gather(viewer.disconnect(), host.disconnect(), return_exceptions=True)
        if audio_source:
            await audio_source.aclose()
        if video_source:
            await video_source.aclose()
        # Delete only this uniquely named technical room, never an application event.
        now = int(time.time())
        token = jwt.encode({"iss": values["api_key"], "sub": "tflow-qa-cleanup", "nbf": now - 5,
                            "exp": now + 60, "video": {"roomAdmin": True, "room": name}},
                           values["api_secret"], algorithm="HS256")
        origin = values.get("url", "wss://" + HOST + ":8080").replace("wss://", "https://", 1).rstrip("/")
        request = Request(origin + "/twirp/livekit.RoomService/DeleteRoom",
                          data=json.dumps({"room": name}).encode(),
                          headers={"Content-Type": "application/json", "Authorization": "Bearer " + token})
        try:
            with urlopen(request, timeout=5):
                pass
        except Exception:
            pass  # Empty technical rooms also expire automatically on the server.


if __name__ == "__main__":
    try:
        result = asyncio.run(verify(json.loads(Path(sys.argv[1]).read_text())))
    except Exception as error:
        result = {"ok": False, "phase": "SDK initialization", "exception": type(error).__name__}
    print(json.dumps(result), flush=True)
    raise SystemExit(0 if result["ok"] else 1)
