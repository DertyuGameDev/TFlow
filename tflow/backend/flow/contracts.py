from datetime import datetime, timezone as dt_timezone
from django import forms
from django.core.exceptions import ValidationError
from .names import full_name, split_name
from django.utils import timezone
import re
from .profile_data import REQUIREMENT_KEYS


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
    title = forms.CharField()
    description = forms.CharField()
    starts_at = MillisecondsField()
    ends_at = MillisecondsField()
    city = forms.CharField()
    venue = forms.CharField()
    address = forms.CharField(required=False)
    format = forms.ChoiceField(choices=[(v, v) for v in ["Очно", "Онлайн", "Гибрид"]])
    topic = forms.CharField()
    kind = forms.CharField()
    cover = forms.ChoiceField(
        choices=[(v, v) for v in ["yellow", "photo", "blue", "mint", "peach", "violet"]]
    )
    community_id = forms.CharField(required=False)
    capacity = forms.IntegerField(required=False, min_value=1, max_value=2**53 - 1)

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
    name = forms.CharField()
    description = forms.CharField()
    topic = forms.CharField()


class ActivityInput(forms.Form):
    title = forms.CharField()
    description = forms.CharField(required=False)
    speaker = forms.CharField(required=False)
    room_id = forms.CharField(required=False)
    new_room_name = forms.CharField(required=False)
    new_room_capacity = forms.IntegerField(required=False, min_value=1, max_value=2**53 - 1)
    starts_at = MillisecondsField()
    ends_at = MillisecondsField()
    capacity = forms.IntegerField(min_value=1, max_value=2**53 - 1)

    def clean(self):
        data = super().clean()
        if data.get("new_room_name") and data.get("room_id"):
            self.add_error("room_id", "Выберите существующую аудиторию или создайте новую")
        if data.get("new_room_capacity") and not data.get("new_room_name"):
            self.add_error("new_room_name", "Укажите название новой аудитории")
        if (
            data.get("starts_at")
            and data.get("ends_at")
            and data["starts_at"] >= data["ends_at"]
        ):
            self.add_error("ends_at", "Окончание должно быть позже начала")
        return data


class RoomInput(forms.Form):
    name = forms.CharField()
    capacity = forms.IntegerField(min_value=1, max_value=2**53 - 1)


class ProfileDateField(forms.DateField):
    def to_python(self, value):
        if value is not None and not isinstance(value, str):
            raise ValidationError("Укажите дату в формате ГГГГ-ММ-ДД")
        return super().to_python(value)


class ProfileInput(forms.Form):
    # The legacy name payload stays supported for existing API clients.
    name = forms.CharField(required=False)
    first_name = forms.CharField(required=False)
    last_name = forms.CharField(required=False)
    city = forms.CharField(required=False)
    phone = forms.CharField(required=False)
    birth_date = ProfileDateField(required=False, input_formats=["%Y-%m-%d"])
    telegram = forms.RegexField(r"^@?[A-Za-z][A-Za-z0-9_]*$", required=False,
                                error_messages={"invalid": "Укажите логин Telegram, например @username"})
    organization = forms.CharField(required=False)
    job_title = forms.CharField(required=False)
    education = forms.CharField(required=False)
    website = forms.URLField(required=False, assume_scheme="https")
    about = forms.CharField(required=False)
    interests = forms.CharField(required=False)

    def clean_phone(self):
        value = self.cleaned_data["phone"]
        if value and (not re.fullmatch(r"\+?[\d ()\-]+", value) or not re.search(r"\d", value)):
            raise forms.ValidationError("Укажите телефон цифрами")
        return value

    def clean_birth_date(self):
        value = self.cleaned_data["birth_date"]
        if value and value > timezone.localdate():
            raise forms.ValidationError("Дата рождения не может быть в будущем")
        return value

    def clean_website(self):
        value = self.cleaned_data["website"]
        if value and not value.startswith(("https://", "http://")):
            raise forms.ValidationError("Укажите ссылку с http:// или https://")
        return value

    def clean(self):
        data = super().clean()
        if "first_name" in self.data or "last_name" in self.data:
            if not data.get("first_name"):
                self.add_error("first_name", "Укажите имя")
            data["name"] = full_name(
                data.get("first_name", ""), data.get("last_name", "")
            )
        elif data.get("name"):
            data["first_name"], data["last_name"] = split_name(data["name"])
        else:
            self.add_error("first_name", "Укажите имя")
        return data


class ProfileRequirementsField(forms.Field):
    def to_python(self, value):
        if not isinstance(value, list) or len(value) > len(REQUIREMENT_KEYS):
            raise ValidationError("Выберите поля профиля из списка")
        if any(not isinstance(key, str) or key not in REQUIREMENT_KEYS for key in value):
            raise ValidationError("В списке есть неизвестное поле профиля")
        if len(set(value)) != len(value):
            raise ValidationError("Поля профиля не должны повторяться")
        return [key for key in REQUIREMENT_KEYS if key in value]


class RequirementsInput(forms.Form):
    required_profile_fields = ProfileRequirementsField(required=False)


class MoveEventInput(forms.Form):
    starts_at = MillisecondsField()
    ends_at = MillisecondsField()
    city = forms.CharField()
    venue = forms.CharField()
    address = forms.CharField(required=False)

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
        elif isinstance(field, forms.DateField) and not isinstance(value, str):
            form.add_error(name, "Ожидается дата в формате ГГГГ-ММ-ДД")
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
