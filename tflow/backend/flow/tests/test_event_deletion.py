from django.test import Client, TestCase, override_settings
from flow.models import (
    Activity,
    Bookmark,
    CheckIn,
    Event,
    EventRegistration,
    Notification,
    Registration,
    Room,
    WaitlistEntry,
)
from .test_api import FAST_HASHER, Scenario


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class EventDeletionTests(Scenario, TestCase):
    def test_owner_can_delete_a_draft_with_its_programme(self):
        self.request(f"events/{self.event.pk}", "delete")
        self.assertFalse(Event.objects.filter(pk=self.event.pk).exists())
        self.assertFalse(Room.objects.filter(event_id=self.event.pk).exists())
        self.assertFalse(Activity.objects.filter(event_id=self.event.pk).exists())

    def test_published_event_removes_tickets_and_notifies_each_person_once(self):
        self.publish()
        for person in [self.person, self.other]:
            EventRegistration.objects.create(user=person, event=self.event)
        Registration.objects.create(user=self.person, activity=self.a)
        WaitlistEntry.objects.create(user=self.other, activity=self.a)
        Bookmark.objects.create(user=self.person, event=self.event)
        CheckIn.objects.create(
            user=self.person, event=self.event, checked_by=self.owner
        )
        previous = Notification.objects.create(
            user=self.person, event=self.event, message="Прежнее уведомление"
        )
        other_event = Event.objects.get(pk=self.event.pk)
        other_event.pk = "another-event"
        other_event.save()
        other_ticket = EventRegistration.objects.create(
            user=self.person, event=other_event
        )

        self.request(f"events/{self.event.pk}", "delete")
        for model in [EventRegistration, Bookmark, CheckIn]:
            self.assertFalse(model.objects.filter(event_id=self.event.pk).exists())
        self.assertFalse(Registration.objects.filter(activity_id=self.a.pk).exists())
        self.assertFalse(WaitlistEntry.objects.filter(activity_id=self.a.pk).exists())
        self.assertTrue(EventRegistration.objects.filter(pk=other_ticket.pk).exists())
        previous.refresh_from_db()
        self.assertIsNone(previous.event_id)
        for client in [self.participant, self.stranger]:
            notices = self.request("bootstrap", client=client)["notifications"]
            deleted = [n for n in notices if "Организатор отменил" in n["message"]]
            self.assertEqual(len(deleted), 1)
            self.assertIn(self.event.title, deleted[0]["message"])
            self.assertIsNone(deleted[0]["event_id"])
            self.assertEqual(deleted[0]["kind"], "event_cancelled")
        self.request(f"events/{self.event.pk}", client=self.participant, status=404)

    def test_only_owner_can_delete(self):
        path = f"events/{self.event.pk}"
        self.request(path, "delete", client=Client(), status=401)
        self.request(path, "delete", client=self.participant, status=403)
        self.other.role = "organizer"
        self.other.save(update_fields=["role"])
        self.request(path, "delete", client=self.stranger, status=403)
        self.assertTrue(Event.objects.filter(pk=self.event.pk).exists())

    def test_deletion_requires_csrf_and_missing_event_returns_404(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.owner)
        self.assertEqual(client.delete(f"/api/events/{self.event.pk}").status_code, 403)
        self.assertTrue(Event.objects.filter(pk=self.event.pk).exists())
        self.request("events/missing", "delete", status=404, code="NOT_FOUND")
