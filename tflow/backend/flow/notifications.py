from django.db import transaction
from django.db.models import Q
from .contracts import FlowError
from .models import Notification
from .serializers import notice_json


def notification_page(user, *, before=None, unread=False):
    notices = user.notifications.all()
    if before:
        try:
            cursor = notices.get(pk=before)
        except Notification.DoesNotExist as error:
            raise FlowError("NOT_FOUND", "Уведомление не найдено", 404) from error
        notices = notices.filter(
            Q(created_at__lt=cursor.created_at)
            | Q(created_at=cursor.created_at, pk__gt=cursor.pk)
        )
    if unread:
        notices = notices.filter(read=False)
    page = list(notices[:21])
    return {
        "items": [notice_json(notice) for notice in page[:20]],
        "next_cursor": page[19].pk if len(page) > 20 else None,
    }


def create_notifications(notices):
    """Persist site notifications in the caller's business transaction."""
    if not notices:
        return []
    with transaction.atomic():
        return Notification.objects.bulk_create(notices)
