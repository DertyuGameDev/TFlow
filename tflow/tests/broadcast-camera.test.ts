import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BroadcastCapture } from "../lib/http-broadcast";
import { deferred } from "./fixtures";

function stream(kind = "video") {
  const track = { kind, stop: vi.fn(), onended: null as null | (() => void) };
  return { getTracks: () => [track], getVideoTracks: () => kind === "video" ? [track] : [],
    getAudioTracks: () => kind === "audio" ? [track] : [], track };
}
const getUserMedia = vi.fn();
let capture: BroadcastCapture;
let preview: HTMLVideoElement[];
let drawImage: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); preview = []; getUserMedia.mockReset();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  vi.stubGlobal("MediaStream", class { constructor(private tracks: unknown[]) {} getTracks() { return this.tracks; } });
  vi.stubGlobal("AudioContext", class {
    resume = vi.fn().mockResolvedValue(undefined); close = vi.fn().mockResolvedValue(undefined);
    createMediaStreamDestination = () => ({ stream: stream("audio") });
    createConstantSource = () => ({ offset: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() });
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLVideoElement) {
    preview.push(this); return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const canvas = document.createElement("canvas");
  drawImage = vi.fn();
  canvas.getContext = vi.fn().mockReturnValue({ fillRect: vi.fn(), fillText: vi.fn(), drawImage });
  canvas.captureStream = vi.fn().mockReturnValue(stream());
  capture = new BroadcastCapture(canvas, vi.fn());
});
afterEach(() => { capture.dispose(); vi.useRealTimers(); });

describe("камера HTTPS-студии", () => {
  it("запрашивает только видео, рисует кадры и освобождает устройство при выключении", async () => {
    const camera = stream(); getUserMedia.mockResolvedValue(camera);
    expect(getUserMedia).not.toHaveBeenCalled();
    await capture.video("camera", true);
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false, video: expect.any(Object) }));
    expect(capture.cameraEnabled).toBe(true);
    Object.defineProperties(preview[0], { readyState: { value: 2 }, videoWidth: { value: 640 }, videoHeight: { value: 480 } });
    await vi.advanceTimersByTimeAsync(100);
    expect(drawImage).toHaveBeenCalledWith(preview[0], 120, 0, 720, 540);
    await capture.video("camera", false);
    expect(camera.track.stop).toHaveBeenCalledOnce();
    expect(preview[0].srcObject).toBeNull();
    expect(capture.cameraEnabled).toBe(false);
  });
  it("позволяет повторить запрос после отказа разрешения", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError")).mockResolvedValueOnce(stream());
    await expect(capture.video("camera", true)).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(capture.cameraEnabled).toBe(false);
    await capture.video("camera", true);
    expect(capture.cameraEnabled).toBe(true);
  });
  it("не оставляет камеру включённой, если страница закрыта во время запроса разрешения", async () => {
    const pending = deferred<ReturnType<typeof stream>>(), camera = stream();
    getUserMedia.mockReturnValue(pending.promise);
    const opening = capture.video("camera", true); capture.dispose(); pending.resolve(camera); await opening;
    expect(camera.track.stop).toHaveBeenCalledOnce();
    expect(preview).toHaveLength(0);
  });
  it("освобождает поток, если браузер не смог воспроизвести предпросмотр", async () => {
    const camera = stream(); getUserMedia.mockResolvedValue(camera);
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    await expect(capture.video("camera", true)).rejects.toThrow();
    expect(camera.track.stop).toHaveBeenCalledOnce(); expect(capture.cameraEnabled).toBe(false);
  });
  it("сбрасывает состояние при отключении устройства и позволяет подключить его заново", async () => {
    const camera = stream(); getUserMedia.mockResolvedValueOnce(camera).mockResolvedValueOnce(stream());
    await capture.video("camera", true); camera.track.onended?.();
    expect(capture.cameraEnabled).toBe(false);
    await capture.video("camera", true); expect(capture.cameraEnabled).toBe(true);
    capture.dispose(); expect(preview[1].srcObject).toBeNull();
  });
});
