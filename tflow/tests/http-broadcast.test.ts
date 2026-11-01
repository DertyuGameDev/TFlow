import { afterEach, describe, expect, it, vi } from "vitest";
import { BroadcastUpload, recordingMime } from "../lib/http-broadcast";

const recorders: TestRecorder[] = [];
class TestRecorder {
  static isTypeSupported = (mime: string) => mime.startsWith("video/webm");
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { recorders.push(this); }
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; }
  data() { this.ondataavailable?.({ data: new Blob(["media"]) }); }
}
afterEach(() => { vi.useRealTimers(); recorders.length = 0; });

describe("HTTPS publishing lifecycle", () => {
  it("retries the same fragment after a lost response and advances once", async () => {
    vi.useFakeTimers(); vi.stubGlobal("MediaRecorder", TestRecorder);
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValue({ ok: true, json: async () => ({ next: 1 }) });
    vi.stubGlobal("fetch", fetch);
    const failed = vi.fn(), upload = new BroadcastUpload({} as MediaStream, "session", "publisher", failed);
    recorders[0].data(); await vi.advanceTimersByTimeAsync(600);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe("/api/broadcasts/session/chunks/0");
    expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0]);
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
    expect(fetch.mock.calls[0][1].headers["X-TFlow-Publisher"]).toBe("publisher");
    expect(failed).not.toHaveBeenCalled(); upload.stop();
  });
  it("stops on revoked access and does not retry forbidden uploads", async () => {
    vi.stubGlobal("MediaRecorder", TestRecorder);
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Доступ отозван" }) });
    vi.stubGlobal("fetch", fetch); const failed = vi.fn();
    new BroadcastUpload({} as MediaStream, "session", "publisher", failed);
    recorders[0].data(); await vi.waitFor(() => expect(failed).toHaveBeenCalledWith("Доступ отозван"));
    expect(recorders[0].state).toBe("inactive"); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds unsent media and releases a stalled recorder", () => {
    vi.stubGlobal("MediaRecorder", TestRecorder);
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const failed = vi.fn(), upload = new BroadcastUpload({} as MediaStream, "session", "publisher", failed);
    for (let i = 0; i < 10; i++) recorders[0].data();
    expect(failed).toHaveBeenCalledOnce(); expect(recorders[0].state).toBe("inactive"); upload.stop();
  });
  it("reports unsupported recorders before opening a server session", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(() => recordingMime()).toThrow("современный");
  });
});
