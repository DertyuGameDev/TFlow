import { csrfToken } from "./session";

export async function broadcastRequest<T>(path: string, options: RequestInit = {}, accessKey?: string): Promise<T> {
  const controller = options.signal ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), 12000) : null;
  try {
  const response = await fetch(`/api/${path}`, {
    ...options, credentials: "same-origin", cache: "no-store",
    signal: options.signal ?? controller?.signal,
    headers: { ...(options.method && options.method !== "GET" ? { "X-CSRFToken": csrfToken() } : {}),
      ...(accessKey ? { "X-TFlow-Access-Key": accessKey } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({ error: "Сервер временно недоступен" }));
  if (!response.ok) throw Object.assign(new Error(data.error ?? "Не удалось подключиться к эфиру"), { status: response.status });
  return data as T;
  } catch (cause) {
    if ((cause as Error).name === "AbortError") throw new Error("Соединение задерживается. Проверьте интернет и попробуйте ещё раз.");
    if ((cause as Error).name === "TypeError") throw new Error("Нет связи с сервером. Проверьте интернет и повторите подключение.");
    throw cause;
  } finally { if (timeout) clearTimeout(timeout); }
}

export function recordingMime() {
  if (typeof MediaRecorder === "undefined") throw new Error("Для студии нужен современный Chrome, Firefox или Safari.");
  for (const mime of ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  throw new Error("Браузер не поддерживает передачу видео. Откройте студию в Chrome или Safari.");
}

export class BroadcastCapture {
  private context: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private silent: ConstantSourceNode;
  private camera?: HTMLVideoElement;
  private screen?: HTMLVideoElement;
  private microphone?: MediaStream;
  private microphoneSource?: MediaStreamAudioSourceNode;
  private timer: ReturnType<typeof setInterval>;
  private disposed = false;
  private generation = { camera: 0, screen: 0, microphone: 0 };
  readonly stream: MediaStream;
  constructor(private canvas: HTMLCanvasElement, private changed: () => void) {
    this.context = new AudioContext();
    void this.context.resume().catch(() => {});
    this.destination = this.context.createMediaStreamDestination();
    this.silent = this.context.createConstantSource();
    this.silent.offset.value = 0;
    this.silent.connect(this.destination); this.silent.start();
    canvas.width = 960; canvas.height = 540;
    this.draw();
    this.stream = new MediaStream([...canvas.captureStream(15).getVideoTracks(), ...this.destination.stream.getAudioTracks()]);
    this.timer = setInterval(() => this.draw(), 1000 / 15);
  }
  get cameraEnabled() { return !!this.camera; }
  get screenEnabled() { return !!this.screen; }
  get microphoneEnabled() { return !!this.microphone; }
  private draw() {
    const ctx = this.canvas.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#17191b"; ctx.fillRect(0, 0, 960, 540);
    const source = this.screen ?? this.camera;
    if (source && source.readyState >= 2 && source.videoWidth) {
      const ratio = Math.min(960 / source.videoWidth, 540 / source.videoHeight);
      const width = source.videoWidth * ratio, height = source.videoHeight * ratio;
      ctx.drawImage(source, (960 - width) / 2, (540 - height) / 2, width, height);
    } else {
      ctx.fillStyle = "#fff"; ctx.font = "bold 40px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("ТФлоу · Прямой эфир", 480, 265);
      ctx.font = "24px sans-serif"; ctx.fillStyle = "#b8bbc0";
      ctx.fillText(this.microphone ? "Ведущий в эфире" : "Камера и микрофон выключены", 480, 310);
    }
  }
  private stopVideo(video?: HTMLVideoElement) {
    (video?.srcObject as MediaStream | null)?.getTracks().forEach(track => track.stop());
    if (video) { video.pause(); video.srcObject = null; }
  }
  async video(kind: "camera" | "screen", enabled: boolean) {
    const generation = ++this.generation[kind];
    this.stopVideo(this[kind]); this[kind] = undefined; this.changed();
    if (!enabled || this.disposed) return;
    // Invoke display capture immediately from the click, before network work.
    const media = await (kind === "screen" ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      : navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 15, max: 20 } }, audio: false }));
    if (this.disposed || this.generation[kind] !== generation) { media.getTracks().forEach(track => track.stop()); return; }
    const video = document.createElement("video"); video.muted = true; video.playsInline = true; video.srcObject = media;
    try { await video.play(); } catch (cause) { this.stopVideo(video); throw cause; }
    if (this.disposed || this.generation[kind] !== generation) { this.stopVideo(video); return; }
    this[kind] = video;
    media.getVideoTracks()[0].onended = () => { if (this[kind] === video) { this.stopVideo(video); this[kind] = undefined; this.changed(); } };
    this.changed();
  }
  async microphoneInput(enabled: boolean) {
    const generation = ++this.generation.microphone;
    this.microphoneSource?.disconnect(); this.microphone?.getTracks().forEach(track => track.stop());
    this.microphoneSource = undefined; this.microphone = undefined; this.changed();
    if (!enabled || this.disposed) return;
    const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    if (this.disposed || this.generation.microphone !== generation) { media.getTracks().forEach(track => track.stop()); return; }
    this.microphone = media; this.microphoneSource = this.context.createMediaStreamSource(media);
    this.microphoneSource.connect(this.destination); this.changed();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; clearInterval(this.timer);
    this.stopVideo(this.camera); this.stopVideo(this.screen);
    this.microphone?.getTracks().forEach(track => track.stop());
    this.stream.getTracks().forEach(track => track.stop());
    this.microphoneSource?.disconnect(); this.silent.stop(); this.silent.disconnect();
    void this.context.close().catch(() => {});
  }
}

export class BroadcastUpload {
  private recorder: MediaRecorder;
  private queue: Blob[] = [];
  private queuedBytes = 0;
  private sequence = 0;
  private sending = false;
  private stopped = false;
  private controller?: AbortController;
  constructor(stream: MediaStream, private session: string, private publisher: string,
              private failed: (message: string) => void, private accessKey?: string) {
    this.recorder = new MediaRecorder(stream, { mimeType: recordingMime(), videoBitsPerSecond: 900_000, audioBitsPerSecond: 96_000 });
    this.recorder.ondataavailable = event => {
      if (this.stopped || !event.data.size) return;
      if (event.data.size > 2 * 1024 * 1024 || this.queuedBytes + event.data.size > 8 * 1024 * 1024 || this.queue.length >= 8) {
        this.fail("Передача видео отстаёт. Проверьте интернет и запустите эфир заново."); return;
      }
      this.queue.push(event.data); this.queuedBytes += event.data.size;
      void this.flush();
    };
    this.recorder.onerror = () => this.fail("Браузер остановил запись. Запустите эфир заново.");
    this.recorder.start(1000);
  }
  private fail(message: string) { if (!this.stopped) { this.stop(); this.failed(message); } }
  private async flush() {
    if (this.sending || this.stopped) return;
    this.sending = true;
    try {
      while (this.queue.length && !this.stopped) {
        const blob = this.queue[0]; let success = false;
        for (let attempt = 0; attempt < 4 && !this.stopped; attempt++) {
          this.controller = new AbortController();
          const timeout = setTimeout(() => this.controller?.abort(), 8000);
          try {
            const result = await broadcastRequest<{ next: number }>(`broadcasts/${this.session}/chunks/${this.sequence}`, {
              method: "POST", body: blob, signal: this.controller.signal,
              headers: { "Content-Type": "application/octet-stream", "X-TFlow-Publisher": this.publisher },
            }, this.accessKey);
            if (result.next !== this.sequence + 1) throw Object.assign(new Error("Последовательность видео нарушена"), { status: 409 });
            success = true; break;
          } catch (cause) {
            if (this.stopped) return;
            const status = (cause as Error & { status?: number }).status;
            if (status && status !== 429 && status < 500) throw cause;
            if (attempt === 3) throw cause;
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
          } finally { clearTimeout(timeout); }
        }
        if (!success || this.stopped) return;
        this.queue.shift(); this.queuedBytes -= blob.size; this.sequence++;
      }
    } catch (cause) { this.fail((cause as Error).message || "Передача прервалась. Перезапустите эфир."); }
    finally { this.sending = false; }
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; this.controller?.abort();
    this.recorder.ondataavailable = null; this.recorder.onerror = null;
    if (this.recorder.state !== "inactive") this.recorder.stop();
    this.queue = []; this.queuedBytes = 0;
  }
}
