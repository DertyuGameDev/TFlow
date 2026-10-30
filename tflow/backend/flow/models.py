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
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        if not extra["is_staff"] or not extra["is_superuser"]:
            raise ValueError("Superuser must have is_staff and is_superuser")
        return self.create_user(email, password, **extra)


class User(AbstractUser):
    id = models.CharField(primary_key=True, max_length=100, default=new_id, editable=False)
    username = None
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=80)
    city = models.CharField(max_length=80, default="Москва")
    about = models.TextField(blank=True, max_length=1000)
    interests = models.CharField(blank=True, max_length=300)
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]
    objects = UserManager()

    def __str__(self):
        return self.name or self.email


class ScheduleLock(models.Model):
    """A shared write lock: SQLite IMMEDIATE; row lock on PostgreSQL."""
    id = models.PositiveSmallIntegerField(primary_key=True, default=1)


class Community(models.Model):
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    name = models.CharField(max_length=160)
    description = models.TextField(max_length=5000)
    topic = models.CharField(max_length=80)
    color = models.CharField(max_length=30)


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
    format = models.CharField(max_length=10, choices=[(v, v) for v in ["Очно", "Онлайн", "Гибрид"]])
    topic = models.CharField(max_length=80)
    kind = models.CharField(max_length=60)
    cover = models.CharField(max_length=20, default="yellow")
    status = models.CharField(max_length=10, choices=[("draft", "Черновик"), ("published", "Опубликовано")], default="draft")
    community = models.ForeignKey(Community, on_delete=models.SET_NULL, null=True, blank=True)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["starts_at", "id"]
        constraints = [models.CheckConstraint(condition=Q(ends_at__gt=F("starts_at")), name="event_positive_duration")]


class Room(models.Model):
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="rooms")
    name = models.CharField(max_length=120)
    capacity = models.PositiveIntegerField()

    class Meta:
        ordering = ["name", "id"]
        constraints = [models.CheckConstraint(condition=Q(capacity__gte=1, capacity__lte=10000), name="room_valid_capacity")]


class Activity(models.Model):
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="activities")
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
            models.CheckConstraint(condition=Q(ends_at__gt=F("starts_at")), name="activity_positive_duration"),
            models.CheckConstraint(condition=Q(capacity__gte=1, capacity__lte=10000), name="activity_valid_capacity"),
        ]


class Registration(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="registrations")
    activity = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name="registrations")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "activity"], name="unique_registration")]


class Bookmark(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="bookmarks")
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="bookmarks")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "event"], name="unique_bookmark")]


class Membership(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    community = models.ForeignKey(Community, on_delete=models.CASCADE, related_name="memberships")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "community"], name="unique_membership")]


class Notification(models.Model):
    id = models.CharField(primary_key=True, max_length=100, default=new_id)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="notifications")
    event = models.ForeignKey(Event, on_delete=models.CASCADE)
    message = models.TextField(max_length=1000)
    created_at = models.DateTimeField(default=timezone.now)
    read = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at", "id"]
