from datetime import timedelta
from unittest.mock import patch
from django.test import Client, TestCase, override_settings
from flow import services
from flow.models import (
    CheckIn,
    Event,
    EventRegistration,
    Notification,
    NotificationEmail,
    Registration,
    User,
    WaitlistEntry,
)
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class NotificationTests(Scenario, TestCase):
    def test_cancellation_notifies_all_tickets_activity_queue_and_legacy_arrivals(self):
        people = User.objects.bulk_create(
            [
                User(email=f"guest-{index}@example.test", name=f"Участник {index}")
                for index in range(60)
            ]
        )
        EventRegistration.objects.bulk_create(
            [EventRegistration(user=person, event=self.event) for person in people[:-1]]
        )
        Registration.objects.create(user=self.person, activity=self.a)
        WaitlistEntry.objects.create(user=self.other, activity=self.a)
        CheckIn.objects.create(user=people[-1], event=self.event, checked_by=self.owner)
        self.request(f"events/{self.event.pk}", "delete")
        notices = Notification.objects.filter(kind="event_cancelled")
        self.assertEqual(notices.count(), 62)
        self.assertEqual(NotificationEmail.objects.count(), 62)
        self.assertEqual(
            set(notices.values_list("user_id", flat=True)),
            {person.pk for person in people} | {self.person.pk, self.other.pk},
        )
        self.assertFalse(notices.filter(read=True).exists())
        self.assertFalse(notices.exclude(event=None).exists())
        self.assertIn("Организатор отменил", notices.first().message)

    def test_notification_failure_rolls_back_deletion(self):
        EventRegistration.objects.create(user=self.person, event=self.event)
        with patch(
            "flow.services.Notification.objects.bulk_create",
            side_effect=RuntimeError("notification failure"),
        ):
            with self.assertRaises(RuntimeError):
                services.delete_event(self.owner, self.event.pk)
        self.assertTrue(Event.objects.filter(pk=self.event.pk).exists())
        self.assertTrue(self.event.activities.exists())
        self.assertTrue(self.event.enrollments.filter(user=self.person).exists())
        self.assertFalse(Notification.objects.filter(kind="event_cancelled").exists())

    def test_full_history_pagination_and_unread_count_beyond_bootstrap_preview(self):
        notices = Notification.objects.bulk_create(
            [
                Notification(
                    user=self.person,
                    event=self.event,
                    created_at=self.start,
                    message=f"Сообщение {index}",
                )
                for index in range(55)
            ]
        )
        state = self.request("bootstrap", client=self.participant)
        self.assertEqual(len(state["notifications"]), 50)
        self.assertEqual(state["unread_notification_count"], 55)
        page = self.request("notifications", client=self.participant)
        seen = [notice["id"] for notice in page["items"]]
        # A newer notification arriving between pages must not shift the cursor.
        Notification.objects.create(
            user=self.person,
            event=self.event,
            created_at=self.start + timedelta(seconds=1),
            message="Новое сообщение",
        )
        while page["next_cursor"]:
            page = self.request(
                f"notifications?before={page['next_cursor']}", client=self.participant
            )
            seen.extend(notice["id"] for notice in page["items"])
        self.assertEqual(len(seen), 55)
        self.assertEqual(set(seen), {notice.pk for notice in notices})

    def test_read_one_and_all_are_private_and_filter_unread(self):
        first = Notification.objects.create(
            user=self.person, event=self.event, message="Первое"
        )
        second = Notification.objects.create(
            user=self.person, event=self.event, message="Второе"
        )
        foreign = Notification.objects.create(
            user=self.other, event=self.event, message="Чужое"
        )
        self.request(
            f"notifications/{foreign.pk}", "patch", client=self.participant, status=404
        )
        self.request(
            f"notifications?before={foreign.pk}", client=self.participant, status=404
        )
        self.request(
            f"notifications/{first.pk}",
            "patch",
            {"user_id": self.other.pk},
            client=self.participant,
        )
        page = self.request("notifications?unread=1", client=self.participant)
        self.assertEqual([notice["id"] for notice in page["items"]], [second.pk])
        self.assertEqual(
            self.request("bootstrap", client=self.participant)[
                "unread_notification_count"
            ],
            1,
        )
        self.request("notifications", "patch", client=self.participant)
        self.assertEqual(
            self.request("notifications?unread=1", client=self.participant)["items"], []
        )
        self.assertEqual(
            self.request("bootstrap", client=self.participant)[
                "unread_notification_count"
            ],
            0,
        )
        foreign.refresh_from_db()
        self.assertFalse(foreign.read)

    def test_authentication_and_csrf(self):
        self.request("notifications", client=Client(), status=401)
        notice = Notification.objects.create(
            user=self.person, message="Личное сообщение"
        )
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.person)
        for path in ["notifications", f"notifications/{notice.pk}"]:
            self.assertEqual(
                client.patch(
                    f"/api/{path}", data="{}", content_type="application/json"
                ).status_code,
                403,
            )
        notice.refresh_from_db()
        self.assertFalse(notice.read)
