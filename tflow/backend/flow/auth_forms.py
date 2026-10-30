from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from .models import User
from .interests import INTEREST_CHOICES
from .names import full_name
from .contracts import validate_text


class LoginForm(AuthenticationForm):
    username = forms.EmailField(
        label="Электронная почта",
        validators=[validate_text],
        widget=forms.EmailInput(attrs={"autocomplete": "email", "autofocus": True}),
    )
    password = forms.CharField(
        label="Пароль",
        strip=False,
        validators=[validate_text],
        widget=forms.PasswordInput(attrs={"autocomplete": "current-password"}),
    )

    def clean_username(self):
        return self.cleaned_data["username"].strip().lower()


class RegisterForm(UserCreationForm):
    role = forms.ChoiceField(
        label="Я хочу",
        required=False,
        choices=[
            ("participant", "Участвовать"),
            ("organizer", "Организовывать события"),
        ],
        initial="participant",
        widget=forms.RadioSelect,
    )
    email = forms.EmailField(
        label="Электронная почта",
        validators=[validate_text],
        widget=forms.EmailInput(attrs={"autocomplete": "email"}),
    )
    first_name = forms.CharField(
        label="Имя",
        validators=[validate_text],
        min_length=1,
        max_length=80,
        widget=forms.TextInput(attrs={"autocomplete": "given-name", "autofocus": True}),
    )
    last_name = forms.CharField(
        label="Фамилия",
        validators=[validate_text],
        min_length=1,
        max_length=80,
        widget=forms.TextInput(attrs={"autocomplete": "family-name"}),
    )
    interests = forms.MultipleChoiceField(
        label="Интересы",
        required=False,
        choices=INTEREST_CHOICES,
        widget=forms.CheckboxSelectMultiple,
        help_text="Можно выбрать несколько категорий или пропустить этот шаг.",
    )
    password1 = forms.CharField(
        label="Пароль",
        validators=[validate_text],
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
    )
    password2 = forms.CharField(
        label="Повторите пароль",
        validators=[validate_text],
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
    )

    class Meta:
        model = User
        fields = [
            "role",
            "first_name",
            "last_name",
            "email",
            "interests",
            "password1",
            "password2",
        ]

    def clean(self):
        data = super().clean()
        if len(full_name(data.get("first_name", ""), data.get("last_name", ""))) > 80:
            self.add_error(
                "last_name", "Имя и фамилия вместе должны быть не длиннее 80 символов"
            )
        return data

    def save(self, commit=True):
        user = super().save(commit=False)
        user.name = full_name(user.first_name, user.last_name)
        if commit:
            user.save()
            self.save_m2m()
        return user

    def clean_interests(self):
        return ", ".join(dict.fromkeys(self.cleaned_data["interests"]))

    def clean_role(self):
        return self.cleaned_data.get("role") or "participant"

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError(
                "Этот адрес уже зарегистрирован. Войдите в свой аккаунт."
            )
        return email
