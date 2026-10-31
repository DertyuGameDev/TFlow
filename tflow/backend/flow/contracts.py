from datetime import datetime, timezone as dt_timezone
from django import forms
from django.core.exceptions import ValidationError
from .names import full_name, split_name


def validate_text(value):
    if "\x00" in value or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise ValidationError("Текст содержит недопустимые символы")


class FlowError(Exception):
    def __init__(self, code, message, status=409):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


class MillisecondsField(forms.Field):
    def to_python(self, value):
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not 0 < value < 253402300799000
        ):
            raise ValidationError("Укажите корректную дату")
        try:
            return datetime.fromtimestamp(value / 1000, dt_timezone.utc)
        except (ValueError, OverflowError, OSError) as error:
            raise ValidationError("Укажите корректную дату") from error


class EventInput(forms.Form):
    title = forms.CharField(min_length=3, max_length=160)
    description = forms.CharField(min_length=10, max_length=5000)
    starts_at = MillisecondsField()
    ends_at = MillisecondsField()
    city = forms.CharField(min_length=2, max_length=80)
    venue = forms.CharField(min_length=2, max_length=160)
    address = forms.CharField(required=False, max_length=240)
    format = forms.ChoiceField(choices=[(v, v) for v in ["Очно", "Онлайн", "Гибрид"]])
    topic = forms.CharField(min_length=2, max_length=80)
    kind = forms.CharField(min_length=2, max_length=60)
    cover = forms.ChoiceField(
        choices=[(v, v) for v in ["yellow", "photo", "blue", "mint", "peach", "violet"]]
    )
    community_id = forms.CharField(required=False, max_length=100)
    capacity = forms.IntegerField(required=False, min_value=1, max_value=100000)

    def clean(self):
        data = super().clean()
        if (
            data.get("starts_at")
            and data.get("ends_at")
            and data["starts_at"] >= data["ends_at"]
        ):
            self.add_error("ends_at", "Окончание должно быть позже начала")
        data["community_id"] = data.get("community_id") or None
        data["capacity"] = data.get("capacity") or 500
        return data


class CommunityInput(forms.Form):
    name = forms.CharField(min_length=3, max_length=160)
    description = forms.CharField(min_length=10, max_length=1000)
    topic = forms.CharField(min_length=2, max_length=80)


class ActivityInput(forms.Form):
    title = forms.CharField(min_length=3, max_length=160)
    description = forms.CharField(required=False, max_length=5000)
    speaker = forms.CharField(required=False, max_length=160)
    room_id = forms.CharField(max_length=100)
    starts_at = MillisecondsField()
    ends_at = MillisecondsField()
    capacity = forms.IntegerField(min_value=1, max_value=10000)

    def clean(self):
        data = super().clean()
        if (
            data.get("starts_at")
            and data.get("ends_at")
            and data["starts_at"] >= data["ends_at"]
        ):
            self.add_error("ends_at", "Окончание должно быть позже начала")
        return data


class RoomInput(forms.Form):
    name = forms.CharField(min_length=2, max_length=120)
    capacity = forms.IntegerField(min_value=1, max_value=10000)


class ProfileInput(forms.Form):
    # The legacy name payload stays supported for existing API clients.
    name = forms.CharField(required=False, min_length=2, max_length=80)
    first_name = forms.CharField(required=False, max_length=80)
    last_name = forms.CharField(required=False, max_length=80)
    city = forms.CharField(min_length=2, max_length=80)
    about = forms.CharField(required=False, max_length=1000)
    interests = forms.CharField(required=False, max_length=300)

    def clean(self):
        data = super().clean()
        if "first_name" in self.data or "last_name" in self.data:
            for field, label in [("first_name", "имя"), ("last_name", "фамилию")]:
                if not data.get(field):
                    self.add_error(field, f"Укажите {label}")
            data["name"] = full_name(
                data.get("first_name", ""), data.get("last_name", "")
            )
            if len(data["name"]) > 80:
                self.add_error(
                    "last_name",
                    "Имя и фамилия вместе должны быть не длиннее 80 символов",
                )
        elif data.get("name"):
            data["first_name"], data["last_name"] = split_name(data["name"])
        else:
            self.add_error("first_name", "Укажите имя")
            self.add_error("last_name", "Укажите фамилию")
        return data


class MoveEventInput(forms.Form):
    starts_at = MillisecondsField()
    ends_at = MillisecondsField()
    city = forms.CharField(min_length=2, max_length=80)
    venue = forms.CharField(min_length=2, max_length=160)
    address = forms.CharField(required=False, max_length=240)

    def clean(self):
        data = super().clean()
        if (
            data.get("starts_at")
            and data.get("ends_at")
            and data["starts_at"] >= data["ends_at"]
        ):
            self.add_error("ends_at", "Окончание должно быть позже начала")
        return data


def validate(form_type, body):
    form = form_type(body)
    form.full_clean()
    # Django forms accept HTML strings; this API receives typed JSON instead.
    for name, field in form.fields.items():
        value = body.get(name)
        if value is None:
            continue
        if isinstance(field, (forms.CharField, forms.ChoiceField)) and not isinstance(
            value, str
        ):
            form.add_error(name, "Ожидается строка")
        elif isinstance(field, forms.IntegerField) and type(value) is not int:
            form.add_error(name, "Ожидается целое число")
        if isinstance(value, str):
            try:
                validate_text(value)
            except ValidationError as error:
                form.add_error(name, error)
    if not form.is_valid():
        error = FlowError(
            "VALIDATION", "Проверьте поля формы: названия, даты и вместимость", 400
        )
        error.fields = {
            field: list(messages) for field, messages in form.errors.items()
        }
        raise error
    return form.cleaned_data
