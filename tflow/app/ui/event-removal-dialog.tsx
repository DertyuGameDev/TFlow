import { useState } from "react";
import type { FlowEvent } from "../../lib/types";
import { Modal } from "./dialog";
import { FormError } from "./forms";

export function EventRemovalDialog({
  event,
  deleting,
  onClose,
  onConfirm,
}: {
  event: FlowEvent;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title={deleting ? "Удалить мероприятие?" : "Отменить регистрацию?"}
      dismissible={!busy}
      onClose={onClose}
    >
      <p className="confirmation-event-name">{event.title}</p>
      <p className="confirmation-copy">
        {deleting
          ? "Мероприятие, программа, регистрации и отметки входа будут удалены без возможности восстановления. Записанные участники получат уведомление."
          : "Вы освободите место. Записи на активности и места в очередях этого мероприятия тоже отменятся. Повторно записаться можно, если останутся свободные места. Ваш личный QR сохранится."}
      </p>
      {deleting && (
        <p className="confirmation-copy">
          Сейчас зарегистрировано: {event.participant_count}.
        </p>
      )}
      <FormError error={error} />
      <div className="confirmation-actions">
        <button
          className="button secondary"
          disabled={busy}
          onClick={onClose}
          autoFocus
        >
          {deleting ? "Оставить мероприятие" : "Оставить регистрацию"}
        </button>
        <button
          className="button danger-button"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy
            ? deleting
              ? "Удаляем…"
              : "Отменяем…"
            : deleting
              ? "Да, удалить мероприятие"
              : "Да, отменить регистрацию"}
        </button>
      </div>
    </Modal>
  );
}
