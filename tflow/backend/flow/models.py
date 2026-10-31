import uuid
from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import F, Q
from django.utils import timezone


def new_id():
    return str(uuid.uuid4())


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("Email is required")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("role", "organizer")
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        if not extra["is_staff"] or not extra["is_superuser"]:
            raise ValueError("Superuser must have is_staff and is_superuser")
        return self.create_user(email, password, **extra)


class User(AbstractUser):
    id = models.CharField(
        primary_key=True, max_length=100, default=new_id, editable=False
    )
    username = None
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=80)
    city = models.CharField(max_length=80, blank=True, default="")
    phone = models.CharField(max_length=32, blank=True)
    birth_date = models.DateField(null=True, blank=True)
    telegram = models.CharField(max_length=64, blank=True)
    organization = models.CharField(max_length=160, blank=True)
    job_title = models.CharField(max_length=160, blank=True)
    education = models.CharField(max_length=240, blank=True)
    website = models.URLField(max_length=300, blank=True)
    about = models.TextField(blank=True, max_length=1000)
    interests = models.CharField(blank=True, max_length=300)
    role = models.CharField(
        max_length=16,
        choices=[("participant", "Участник"), ("organizer", "Организатор")],
        default="participant",
    )
    pass_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]
    objects = UserManager()

    class Meta(AbstractUser.Meta):
        constraints = [
            models.CheckConstraint(
                condition=Q(role__in=["participant", "organizer"]),
                name="user_valid_role",
            )
        ]

    def __str__(self):
        return self.name or self.email


class ScheduleLock(models.Model):
    """A shared write lock: SQLite IMMEDIATE; row lock on PostgreSQL."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1)


class UserAvatar(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="avatar")
    image = models.BinaryField()
    updated_at = models.DateTimeField(default=timezone.now)


class Community(models.Model):
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    name = models.CharField(max_length=160)
    description = models.TextField(max_length=5000)
    topic = models.CharField(max_length=80)
    color = models.CharField(max_length=30)
    owner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_clubs",
    )


class Event(models.Model):
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    owner = models.ForeignKey(User, on_delete=models.PROTECT, related_name="events")
    title = models.CharField(max_length=160)
    description = models.TextField(max_length=5000)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    city = models.CharField(max_length=80)
    venue = models.CharField(max_length=160)
    address = models.CharField(max_length=240, blank=True)
    format = models.CharField(
        max_length=10, choices=[(v, v) for v in ["Очно", "Онлайн", "Гибрид"]]
    )
    topic = models.CharField(max_length=80)
    kind = models.CharField(max_length=60)
    cover = models.CharField(max_length=20, default="yellow")
    status = models.CharField(
        max_length=10,
        choices=[("draft", "Черновик"), ("published", "Опубликовано")],
        default="draft",
    )
    community = models.ForeignKey(
        Community, on_delete=models.SET_NULL, null=True, blank=True
    )
    updated_at = models.DateTimeField(default=timezone.now)
    capacity = models.PositiveIntegerField(default=500)
    required_profile_fields = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["starts_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(ends_at__gt=F("starts_at")), name="event_positive_duration"
            ),
            models.CheckConstraint(
                condition=Q(capacity__gte=1, capacity__lte=100000),
                name="event_valid_capacity",
            ),
        ]


class Webinar(models.Model):
    event = models.OneToOneField(
        Event, on_delete=models.CASCADE, related_name="webinar"
    )
    room = models.UUIDField(default=uuid.uuid4, unique=True)
    active = models.BooleanField(default=False)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)


class Room(models.Model):
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="rooms")
    name = models.CharField(max_length=120)
    capacity = models.PositiveIntegerField()

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(capacity__gte=1, capacity__lte=10000),
                name="room_valid_capacity",
            )
        ]


class Activity(models.Model):
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name="activities"
    )
    room = models.ForeignKey(Room, on_delete=models.PROTECT, related_name="activities")
    title = models.CharField(max_length=160)
    description = models.TextField(blank=True, max_length=5000)
    speaker = models.CharField(max_length=160, blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    capacity = models.PositiveIntegerField()
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["starts_at", "title"]
        indexes = [models.Index(fields=["room", "starts_at", "ends_at"])]
        constraints = [
            models.CheckConstraint(
                condition=Q(ends_at__gt=F("starts_at")),
                name="activity_positive_duration",
            ),
            models.CheckConstraint(
                condition=Q(capacity__gte=1, capacity__lte=10000),
                name="activity_valid_capacity",
            ),
        ]


class Registration(models.Model):
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="registrations"
    )
    activity = models.ForeignKey(
        Activity, on_delete=models.CASCADE, related_name="registrations"
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "activity"], name="unique_registration"
            )
        ]


class WaitlistEntry(models.Model):
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="waitlist_entries"
    )
    activity = models.ForeignKey(
        Activity, on_delete=models.CASCADE, related_name="waitlist"
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        # IDs give an unambiguous FIFO order even when timestamps are equal.
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "activity"], name="unique_waitlist_entry"
            )
        ]
        indexes = [
            models.Index(fields=["activity", "id"], name="waitlist_activity_order")
        ]


class EventRegistration(models.Model):
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="event_registrations"
    )
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name="enrollments"
    )
    created_at = models.DateTimeField(default=timezone.now)
    profile_data = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "event"], name="unique_event_registration"
            )
        ]


class CheckIn(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="check_ins")
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="check_ins")
    checked_by = models.ForeignKey(
        User, on_delete=models.PROTECT, related_name="performed_check_ins"
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "event"], name="unique_event_check_in"
            )
        ]


class Bookmark(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="bookmarks")
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="bookmarks")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "event"], name="unique_bookmark")
        ]


class Membership(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    community = models.ForeignKey(
        Community, on_delete=models.CASCADE, related_name="memberships"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "community"], name="unique_membership"
            )
        ]


class Notification(models.Model):
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="notifications"
    )
    event = models.ForeignKey(Event, on_delete=models.SET_NULL, null=True, blank=True)
    kind = models.CharField(
        max_length=24,
        choices=[("info", "Обновление"), ("event_cancelled", "Отмена мероприятия")],
        default="info",
    )
    message = models.TextField(max_length=1000)
    created_at = models.DateTimeField(default=timezone.now)
    read = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at", "id"]


class NotificationEmail(models.Model):
    notification = models.OneToOneField(
        Notification, on_delete=models.CASCADE, related_name="email_delivery"
    )
    recipient = models.EmailField()
    sent_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField(default=timezone.now, db_index=True)
    locked_until = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=80, blank=True)
