from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from .models import User
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
    name = forms.CharField(
        label="Имя и фамилия",
        min_length=2,
        max_length=80,
        validators=[validate_text],
        widget=forms.TextInput(attrs={"autocomplete": "name", "autofocus": True}),
    )
    password1 = forms.CharField(
        label="Пароль",
        strip=False,
        validators=[validate_text],
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
    )
    password2 = forms.CharField(
        label="Повторите пароль",
        strip=False,
        validators=[validate_text],
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
    )

    class Meta:
        model = User
        fields = ["role", "name", "email", "password1", "password2"]

    def clean_role(self):
        return self.cleaned_data.get("role") or "participant"

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError(
                "Этот адрес уже зарегистрирован. Войдите в свой аккаунт."
            )
        return email
