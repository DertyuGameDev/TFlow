from django.db.models import Count, Exists, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce
from .models import (
    Activity,
    Bookmark,
    CheckIn,
    Community,
    CommunityAvatar,
    Event,
    EventRegistration,
    Membership,
    Registration,
    UserAvatar,
    WaitlistEntry,
)
from .names import split_name
from .profile_data import participant_profile


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
    updated = (
        UserAvatar.objects.filter(user=user)
        .values_list("updated_at", flat=True)
        .first()
    )
    avatar_url = f"/api/profile/avatar?v={updated.timestamp():.6f}" if updated else None
    first_name, last_name = (
        (user.first_name, user.last_name)
        if user.first_name or user.last_name
        else split_name(user.name)
    )
    return {
        **participant_profile(user),
        "id": user.pk,
        "name": user.name,
        "first_name": first_name,
        "last_name": last_name,
        "email": user.email,
        "city": user.city,
        "about": user.about,
        "interests": user.interests,
        "role": user.role,
        "pass_token": str(user.pass_token),
        "avatar_url": avatar_url,
    }


def visible_events(user):
    condition = Q(status="published")
    if user.is_authenticated and user.role == "organizer":
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
        "required_profile_fields",
    ]
    data = {key: getattr(event, key) for key in keys}
    data.update(
        starts_at=milliseconds(event.starts_at),
        ends_at=milliseconds(event.ends_at),
        updated_at=milliseconds(event.updated_at),
        organizer=event.owner.name or "Организатор",
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
    uid = user.pk if user.is_authenticated else ""
    return (
        Activity.objects.select_related("room", "event")
        .annotate(
            taken=Count("registrations", distinct=True),
            registered=Exists(
                Registration.objects.filter(activity_id=OuterRef("pk"), user_id=uid)
            ),
            waitlist_id=Subquery(
                WaitlistEntry.objects.filter(
                    activity_id=OuterRef("pk"), user_id=uid
                ).values("id")[:1]
            ),
            waiting_count=Coalesce(
                Subquery(
                    WaitlistEntry.objects.filter(activity_id=OuterRef("pk"))
                    .order_by()
                    .values("activity_id")
                    .annotate(n=Count("id"))
                    .values("n")
                ),
                Value(0),
            ),
        )
        .order_by("starts_at", "title", "id")
    )


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
        room_is_online=activity.room.is_online,
        taken=activity.taken,
        registered=int(activity.registered),
        waiting_count=activity.waiting_count,
        waitlisted=int(activity.waitlist_id is not None),
        waitlist_position=(
            activity.waitlist.filter(pk__lte=activity.waitlist_id).count()
            if activity.waitlist_id
            else 0
        ),
    )
    if schedule:
        data.update(
            event_title=activity.event.title,
            city="Онлайн" if activity.room.is_online else activity.event.city,
            venue="ТФлоу" if activity.room.is_online else activity.event.venue,
            event_cover=activity.event.cover,
        )
    return data


def notice_json(notice):
    return {
        "id": notice.pk,
        "event_id": notice.event_id,
        "kind": notice.kind,
        "message": notice.message,
        "created_at": milliseconds(notice.created_at),
        "read": int(notice.read),
    }


def bootstrap(user):
    participant = user.is_authenticated and user.role == "participant"
    communities = Community.objects.annotate(
        avatar_updated=Subquery(
            CommunityAvatar.objects.filter(community_id=OuterRef("pk")).values(
                "updated_at"
            )[:1]
        ),
        member_count=Count("memberships", distinct=True),
        event_count=Count("event", filter=Q(event__status="published"), distinct=True),
        joined=Exists(
            Membership.objects.filter(
                community_id=OuterRef("pk"),
                user_id=user.pk if user.is_authenticated else "",
            )
        ),
        subscribed=Exists(Membership.objects.filter(
            community_id=OuterRef("pk"), notify_events=True,
            user_id=user.pk if user.is_authenticated else "",
        )),
    ).order_by("name")
    schedule = (
        activities_for(user).filter(registrations__user=user) if participant else []
    )
    waitlist = activities_for(user).filter(waitlist__user=user) if participant else []
    notifications = user.notifications.all()[:50] if user.is_authenticated else []
    return {
        "events": [event_json(event) for event in visible_events(user)],
        "schedule": [activity_json(activity, schedule=True) for activity in schedule],
        "waitlist": [activity_json(activity, schedule=True) for activity in waitlist],
        "communities": [
            {
                "id": c.pk,
                "name": c.name,
                "description": c.description,
                "topic": c.topic,
                "color": c.color,
                "member_count": c.member_count,
                "joined": int(c.joined),
                "subscribed": bool(c.subscribed),
                "owner_id": c.owner_id,
                "event_count": c.event_count,
                "avatar_url": (
                    f"/api/communities/{c.pk}/avatar?v={c.avatar_updated.timestamp():.6f}"
                    if c.avatar_updated
                    else None
                ),
            }
            for c in communities
        ],
        "notifications": [notice_json(n) for n in notifications],
        "unread_notification_count": (
            user.notifications.filter(read=False).count()
            if user.is_authenticated
            else 0
        ),
        "profile": profile(user),
        "tickets": (
            [
                event_json(event)
                for event in visible_events(user).filter(enrollments__user=user)
            ]
            if participant
            else []
        ),
    }
