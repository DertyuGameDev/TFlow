/** LiveKit reports microphone level and speech activity after receiving audio. */
export function microphoneSignal(enabled: boolean, level: number, speaking: boolean) {
  const volume = enabled && Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const active = enabled && speaking;
  return { active, volume, bars: active ? Math.max(1, Math.ceil(volume * 5)) : 0 };
}

export function microphoneError(cause: unknown) {
  const name = cause && typeof cause === "object" && "name" in cause ? cause.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError")
    return "Разрешите доступ к микрофону в браузере. Во встроенном предпросмотре VS Code может понадобиться открыть комнату в обычном браузере.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "Микрофон не найден. Подключите его и снова нажмите «Включить микрофон».";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "Не удалось прочитать звук с микрофона. Проверьте, что устройство доступно, или выберите другой микрофон.";
  return "Не удалось включить микрофон. Проверьте выбранное устройство и повторите попытку.";
}
