import uuid
from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.core.validators import URLValidator
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
    first_name = models.TextField("имя", blank=True)
    last_name = models.TextField("фамилия", blank=True)
    name = models.TextField()
    city = models.TextField(blank=True, default="")
    phone = models.TextField(blank=True)
    birth_date = models.DateField(null=True, blank=True)
    telegram = models.TextField(blank=True)
    organization = models.TextField(blank=True)
    job_title = models.TextField(blank=True)
    education = models.TextField(blank=True)
    website = models.TextField(blank=True, validators=[URLValidator()])
    about = models.TextField(blank=True)
    interests = models.TextField(blank=True)
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


class AuthRateLimit(models.Model):
    """Shared authentication budgets; keys contain no raw email or IP address."""

    key = models.CharField(primary_key=True, max_length=64)
    attempts = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(db_index=True)


class ScheduleLock(models.Model):
    """A shared write lock: SQLite IMMEDIATE; row lock on PostgreSQL."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1)


class UserAvatar(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="avatar")
    image = models.BinaryField()
    updated_at = models.DateTimeField(default=timezone.now)


class Community(models.Model):
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    name = models.TextField()
    description = models.TextField()
    topic = models.TextField()
    color = models.CharField(max_length=30)
    owner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_clubs",
    )


class CommunityAvatar(models.Model):
    community = models.OneToOneField(
        Community, on_delete=models.CASCADE, related_name="avatar"
    )
    image = models.BinaryField()
    updated_at = models.DateTimeField(default=timezone.now)


class Event(models.Model):
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    owner = models.ForeignKey(User, on_delete=models.PROTECT, related_name="events")
    title = models.TextField()
    description = models.TextField()
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    city = models.TextField()
    venue = models.TextField()
    address = models.TextField(blank=True)
    format = models.CharField(
        max_length=10, choices=[(v, v) for v in ["Очно", "Онлайн", "Гибрид"]]
    )
    topic = models.TextField()
    kind = models.TextField()
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
    capacity = models.PositiveBigIntegerField(default=500)
    required_profile_fields = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["starts_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(ends_at__gt=F("starts_at")), name="event_positive_duration"
            ),
            models.CheckConstraint(
                condition=Q(capacity__gte=1),
                name="event_valid_capacity",
            ),
        ]


class Webinar(models.Model):
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name="webinars"
    )
    activity = models.OneToOneField(
        "Activity", on_delete=models.CASCADE, related_name="webinar", null=True, blank=True
    )
    room = models.UUIDField(default=uuid.uuid4, unique=True)
    active = models.BooleanField(default=False)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=["event"], condition=Q(activity__isnull=True), name="one_general_webinar_per_event"
        )]


class Room(models.Model):
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="rooms")
    name = models.TextField()
    capacity = models.PositiveBigIntegerField()
    is_online = models.BooleanField(default=False)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(capacity__gte=1),
                name="room_valid_capacity",
            ),
        ]


class Activity(models.Model):
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, related_name="activities"
    )
    room = models.ForeignKey(Room, on_delete=models.PROTECT, related_name="activities")
    title = models.TextField()
    description = models.TextField(blank=True)
    speaker = models.TextField(blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    capacity = models.PositiveBigIntegerField()
    registration_required = models.BooleanField(default=True)
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
                condition=Q(capacity__gte=1),
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


class EventWaitlistEntry(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="event_waitlist_entries")
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="waitlist_entries")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["id"]
        constraints = [models.UniqueConstraint(fields=["user", "event"], name="unique_event_waitlist_entry")]
        indexes = [models.Index(fields=["event", "id"], name="event_waitlist_order")]


class CheckIn(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="check_ins")
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="check_ins")
    checked_by = models.ForeignKey(
        User, on_delete=models.PROTECT, related_name="performed_check_ins", null=True, blank=True
    )
    source = models.CharField(max_length=12, choices=[("qr", "QR на входе"), ("webinar", "Подключение к вебинару")], default="qr")
    created_at = models.DateTimeField(default=timezone.now)
    access_key = models.ForeignKey("EventAccessKey", on_delete=models.SET_NULL, null=True, blank=True, related_name="check_ins")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "event"], name="unique_event_check_in"
            ),
            models.CheckConstraint(condition=(models.Q(source="qr", checked_by__isnull=False) | models.Q(source="webinar", checked_by__isnull=True)), name="check_in_source_verifier"),
        ]


class EventAccessKey(models.Model):
    """Revocable event-scanner or activity-host permission; only a hash is stored."""

    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="access_keys")
    activity = models.ForeignKey(Activity, on_delete=models.CASCADE, null=True, blank=True, related_name="access_keys")
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="issued_access_keys")
    token_hash = models.CharField(max_length=64, unique=True)
    purpose = models.CharField(max_length=16, choices=[("scan", "Сканер мероприятия"), ("webinar", "Ведущий онлайн-флоу")])
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["event"], condition=Q(activity__isnull=True, revoked_at__isnull=True), name="one_active_event_scan_key"),
            models.UniqueConstraint(fields=["activity"], condition=Q(activity__isnull=False, revoked_at__isnull=True), name="one_active_flow_access_key"),
            models.CheckConstraint(condition=Q(purpose="scan", activity__isnull=True) | Q(purpose="webinar", activity__isnull=False), name="valid_access_key_scope"),
        ]


class EventAccessUse(models.Model):
    key = models.ForeignKey(EventAccessKey, on_delete=models.CASCADE, related_name="uses")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="access_key_uses")
    last_used_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["key", "user"], name="unique_access_key_user")]


class Bookmark(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="bookmarks")
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="bookmarks")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "event"], name="unique_bookmark")
        ]


class Membership(models.Model):
    notify_events = models.BooleanField(default=True)
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
    activity = models.ForeignKey(Activity, on_delete=models.SET_NULL, null=True, blank=True)
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="notifications"
    )
    event = models.ForeignKey(Event, on_delete=models.SET_NULL, null=True, blank=True)
    kind = models.CharField(
        max_length=24,
        choices=[
            ("info", "Обновление"),
            ("event_cancelled", "Отмена мероприятия"),
            ("club_event", "Новое событие клуба"),
            ("event_waitlist", "Место на мероприятии освободилось"),
            ("activity_reminder", "Напоминание об активности"),
        ],
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


class ActivityAttendance(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="activity_attendance")
    activity = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name="attendance")
    checked_by = models.ForeignKey(User, on_delete=models.PROTECT, null=True, blank=True, related_name="performed_activity_attendance")
    access_key = models.ForeignKey(EventAccessKey, on_delete=models.SET_NULL, null=True, blank=True)
    source = models.CharField(max_length=12, choices=[("qr", "QR"), ("webinar", "Вебинар")], default="qr")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "activity"], name="unique_activity_attendance"),
            models.CheckConstraint(condition=Q(source="qr", checked_by__isnull=False) | Q(source="webinar", checked_by__isnull=True), name="activity_attendance_verifier"),
        ]


class ActivityReminder(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    activity = models.ForeignKey(Activity, on_delete=models.CASCADE)
    starts_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "activity", "starts_at"], name="unique_activity_reminder")]
