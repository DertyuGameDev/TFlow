"""The data a participant shares with an event organizer at registration."""

PROFILE_LABELS = {
    "name": "Имя и фамилия",
    "email": "Электронная почта",
    "phone": "Телефон",
    "birth_date": "Дата рождения",
    "city": "Город",
    "telegram": "Telegram",
    "organization": "Место работы",
    "job_title": "Должность",
    "education": "Образование",
    "website": "Сайт или портфолио",
    "about": "О себе",
    "interests": "Интересы",
}
REQUIREMENT_KEYS = tuple(key for key in PROFILE_LABELS if key not in {"name", "email"})


def participant_profile(user):
    values = {key: getattr(user, key) for key in PROFILE_LABELS}
    values["birth_date"] = user.birth_date.isoformat() if user.birth_date else ""
    return values


def registration_profile(registration):
    # Registrations made before this feature have no snapshot.
    return registration.profile_data or participant_profile(registration.user)
