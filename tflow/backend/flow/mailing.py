from datetime import timedelta
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.db.models import Q
from django.template.loader import render_to_string
from django.utils import timezone
from .models import Notification, NotificationEmail, User


def create_notifications(notices):
    """The site message and its email job commit or roll back together."""
    if not notices:
        return []
    with transaction.atomic():
        notices = Notification.objects.bulk_create(notices)
        addresses = dict(
            User.objects.filter(
                pk__in={notice.user_id for notice in notices}
            ).values_list("pk", "email")
        )
        NotificationEmail.objects.bulk_create(
            [
                NotificationEmail(
                    notification=notice, recipient=addresses[notice.user_id]
                )
                for notice in notices
            ]
        )
    return notices


def claim_email():
    with transaction.atomic():
        now = timezone.now()
        job = (
            NotificationEmail.objects.select_for_update()
            .filter(
                sent_at=None,
                next_attempt_at__lte=now,
            )
            .filter(Q(locked_until=None) | Q(locked_until__lte=now))
            .order_by("next_attempt_at", "pk")
            .first()
        )
        if not job:
            return None
        job.attempts += 1
        job.locked_until = now + timedelta(minutes=3)
        job.save(update_fields=["attempts", "locked_until"])
        return job


def send_pending_emails(limit=25):
    if not settings.NOTIFICATION_EMAIL_ENABLED or not settings.DEFAULT_FROM_EMAIL:
        return {"sent": 0, "failed": 0, "configured": False}
    sent = failed = 0
    for _ in range(limit):
        job = claim_email()
        if job is None:
            break
        notice = job.notification
        subject = (
            "ТФлоу — мероприятие отменено"
            if notice.kind == "event_cancelled"
            else (
                "ТФлоу — новое событие клуба"
                if notice.kind == "club_event"
                else "ТФлоу — место на мероприятии освободилось"
                if notice.kind == "event_waitlist"
                else "ТФлоу — изменение в вашем событии"
            )
        )
        url = (
            f"{settings.PUBLIC_APP_URL}/#notifications"
            if settings.PUBLIC_APP_URL
            else ""
        )
        context = {"subject": subject, "message": notice.message, "url": url}
        text = (
            f"{notice.message}\n\n"
            + (f"Центр уведомлений: {url}\n\n" if url else "")
            + "ТФлоу · События и люди\nЭто автоматическое уведомление о вашем мероприятии."
        )
        message = EmailMultiAlternatives(
            subject, text, settings.DEFAULT_FROM_EMAIL, [job.recipient]
        )
        message.attach_alternative(
            render_to_string("notification_email.html", context), "text/html"
        )
        try:
            if message.send(fail_silently=False) != 1:
                raise RuntimeError("EmailNotAccepted")
        except Exception as error:
            # Keep secrets and recipient addresses out of logs and the retry status.
            NotificationEmail.objects.filter(pk=job.pk).update(
                locked_until=None,
                next_attempt_at=timezone.now()
                + timedelta(seconds=min(3600, 60 * 2 ** min(job.attempts - 1, 6))),
                last_error=type(error).__name__,
            )
            failed += 1
        else:
            NotificationEmail.objects.filter(pk=job.pk).update(
                sent_at=timezone.now(), locked_until=None, last_error=""
            )
            sent += 1
    return {"sent": sent, "failed": failed, "configured": True}
