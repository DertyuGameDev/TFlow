from django.db.models import Count, Exists, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce
from .models import (
    Activity,
    Bookmark,
    CheckIn,
    Community,
    Event,
    EventRegistration,
    Membership,
    Registration,
)


def milliseconds(value):
    return round(value.timestamp() * 1000)


def identity(user):
    if not user.is_authenticated:
        return None
    return {
        "userId": user.pk,
        "displayName": user.name or user.email,
        "email": user.email,
        "fullName": user.name or None,
        "role": user.role,
    }


def profile(user):
    if not user.is_authenticated:
        return None
    return {
        "id": user.pk,
        "name": user.name,
        "email": user.email,
        "city": user.city,
        "about": user.about,
        "interests": user.interests,
        "role": user.role,
        "pass_token": str(user.pass_token),
    }


def visible_events(user):
    condition = Q(status="published")
    if user.is_authenticated:
        condition |= Q(owner=user)
    return (
        Event.objects.filter(condition)
        .select_related("owner")
        .annotate(
            saved=Exists(
                Bookmark.objects.filter(
                    event_id=OuterRef("pk"),
                    user_id=user.pk if user.is_authenticated else "",
                )
            ),
            activity_count=Count("activities", distinct=True),
            participant_count=Coalesce(
                Subquery(
                    EventRegistration.objects.filter(event_id=OuterRef("pk"))
                    .values("event_id")
                    .annotate(n=Count("id"))
                    .values("n")
                ),
                Value(0),
            ),
            checked_in_count=Coalesce(
                Subquery(
                    CheckIn.objects.filter(event_id=OuterRef("pk"))
                    .values("event_id")
                    .annotate(n=Count("id"))
                    .values("n")
                ),
                Value(0),
            ),
            enrolled=Exists(
                EventRegistration.objects.filter(
                    event_id=OuterRef("pk"),
                    user_id=user.pk if user.is_authenticated else "",
                )
            ),
            checked_in=Exists(
                CheckIn.objects.filter(
                    event_id=OuterRef("pk"),
                    user_id=user.pk if user.is_authenticated else "",
                )
            ),
        )
        .order_by("starts_at", "id")
    )


def event_json(event):
    keys = [
        "id",
        "owner_id",
        "title",
        "description",
        "city",
        "venue",
        "address",
        "format",
        "topic",
        "kind",
        "cover",
        "status",
        "community_id",
    ]
    data = {key: getattr(event, key) for key in keys}
    data.update(
        starts_at=milliseconds(event.starts_at),
        ends_at=milliseconds(event.ends_at),
        updated_at=milliseconds(event.updated_at),
        organizer=event.owner.name,
        saved=int(event.saved),
        activity_count=event.activity_count,
        participant_count=event.participant_count,
        capacity=event.capacity,
        checked_in_count=event.checked_in_count,
        enrolled=int(event.enrolled),
        checked_in=int(event.checked_in),
    )
    return data


def activities_for(user):
    return Activity.objects.select_related("room", "event").annotate(
        taken=Count("registrations"),
        registered=Exists(
            Registration.objects.filter(
                activity_id=OuterRef("pk"),
                user_id=user.pk if user.is_authenticated else "",
            )
        ),
    ).order_by("starts_at", "id")


def activity_json(activity, schedule=False):
    data = {
        key: getattr(activity, key)
        for key in [
            "id",
            "event_id",
            "room_id",
            "title",
            "description",
            "speaker",
            "capacity",
        ]
    }
    data.update(
        starts_at=milliseconds(activity.starts_at),
        ends_at=milliseconds(activity.ends_at),
        updated_at=milliseconds(activity.updated_at),
        room_name=activity.room.name,
        taken=activity.taken,
        registered=int(activity.registered),
    )
    if schedule:
        data.update(
            event_title=activity.event.title,
            city=activity.event.city,
            venue=activity.event.venue,
            event_cover=activity.event.cover,
        )
    return data


def bootstrap(user):
    communities = Community.objects.annotate(
        member_count=Count("memberships"),
        joined=Exists(
            Membership.objects.filter(
                community_id=OuterRef("pk"),
                user_id=user.pk if user.is_authenticated else "",
            )
        ),
    ).order_by("name")
    schedule = (
        activities_for(user).filter(registrations__user=user)
        if user.is_authenticated
        else []
    )
    notifications = user.notifications.all()[:50] if user.is_authenticated else []
    return {
        "events": [event_json(event) for event in visible_events(user)],
        "schedule": [activity_json(activity, schedule=True) for activity in schedule],
        "communities": [
            {
                "id": c.pk,
                "name": c.name,
                "description": c.description,
                "topic": c.topic,
                "color": c.color,
                "member_count": c.member_count,
                "joined": int(c.joined),
            }
            for c in communities
        ],
        "notifications": [
            {
                "id": n.pk,
                "event_id": n.event_id,
                "message": n.message,
                "created_at": milliseconds(n.created_at),
                "read": int(n.read),
            }
            for n in notifications
        ],
        "profile": profile(user),
        "tickets": (
            [
                event_json(event)
                for event in visible_events(user).filter(enrollments__user=user)
            ]
            if user.is_authenticated
            else []
        ),
    }
