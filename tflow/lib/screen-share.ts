export type ScreenShareContext = {
  secure: boolean;
  supported: boolean;
  allowedByPolicy: boolean;
  embedded: boolean;
};

export function screenShareContext(): ScreenShareContext {
  const policyDocument = document as Document & {
    permissionsPolicy?: { allowsFeature: (feature: string) => boolean };
    featurePolicy?: { allowsFeature: (feature: string) => boolean };
  };
  const policy = policyDocument.permissionsPolicy ?? policyDocument.featurePolicy;
  return {
    secure: window.isSecureContext,
    supported: typeof navigator.mediaDevices?.getDisplayMedia === "function",
    allowedByPolicy: policy?.allowsFeature("display-capture") ?? true,
    embedded: window.self !== window.top,
  };
}

export function screenShareUnavailable(context: ScreenShareContext): string | null {
  if (!context.secure)
    return "Для показа экрана откройте сайт по HTTPS или через localhost.";
  if (!context.supported)
    return "Этот браузер не поддерживает показ экрана. Откройте комнату в обычном браузере Chrome, Edge или Firefox на компьютере.";
  if (!context.allowedByPolicy)
    return "Встроенное окно запрещает показ экрана. Откройте эту же комнату в обычном браузере.";
  return null;
}

export function screenShareError(cause: unknown, context: ScreenShareContext): string {
  const unavailable = screenShareUnavailable(context);
  if (unavailable) return unavailable;
  const name = cause && typeof cause === "object" && "name" in cause ? cause.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "AbortError")
    return context.embedded
      ? "Встроенное окно не разрешило показ экрана или выбор был отменён. Откройте комнату в обычном браузере и выберите окно или вкладку."
      : "Показ экрана отменён или доступ не разрешён. Нажмите «Показать экран» ещё раз и выберите окно или вкладку.";
  if (name === "NotReadableError")
    return "Система не разрешила захват выбранного экрана. Проверьте разрешение на запись экрана для браузера или выберите другую вкладку.";
  if (name === "InvalidStateError")
    return "Вернитесь в активную вкладку комнаты и снова нажмите «Показать экран».";
  if (name === "NotFoundError")
    return "Не найден экран или окно для показа. Откройте нужную вкладку или окно и повторите попытку.";
  if (name === "NotSupportedError" || name === "TypeError" || name === "SecurityError")
    return "Показ экрана недоступен в этом окне. Откройте комнату в обычном браузере на компьютере.";
  return "Не удалось передать экран. Проверьте соединение и повторите попытку.";
}

/** Capture must start immediately in the click handler, before any network await. */
export async function publishScreenShare<T extends { stop(): void }>({
  capture, publish, unpublish, isCurrent,
}: {
  capture: () => Promise<T[]>;
  publish: (track: T) => Promise<unknown>;
  unpublish: (track: T) => Promise<unknown>;
  isCurrent: () => boolean;
}): Promise<boolean> {
  const tracks = await capture();
  if (tracks.length === 0) throw new Error("Screen capture returned no tracks");
  const release = async () => {
    await Promise.allSettled(tracks.map(track => Promise.resolve().then(() => unpublish(track))));
    tracks.forEach(track => track.stop());
  };
  try {
    for (const track of tracks) {
      if (!isCurrent()) break;
      await publish(track);
    }
    if (isCurrent()) return true;
  } catch (cause) {
    await release();
    throw cause;
  }
  await release();
  return false;
}
