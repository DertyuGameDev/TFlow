from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from .models import User


class LoginForm(AuthenticationForm):
    username = forms.EmailField(label="Электронная почта", widget=forms.EmailInput(attrs={"autocomplete": "email", "autofocus": True}))
    password = forms.CharField(label="Пароль", strip=False, widget=forms.PasswordInput(attrs={"autocomplete": "current-password"}))

    def clean_username(self):
        return self.cleaned_data["username"].strip().lower()


class RegisterForm(UserCreationForm):
    email = forms.EmailField(label="Электронная почта", widget=forms.EmailInput(attrs={"autocomplete": "email"}))
    name = forms.CharField(label="Имя и фамилия", min_length=2, max_length=80, widget=forms.TextInput(attrs={"autocomplete": "name", "autofocus": True}))
    password1 = forms.CharField(label="Пароль", strip=False, widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}))
    password2 = forms.CharField(label="Повторите пароль", strip=False, widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}))

    class Meta:
        model = User
        fields = ["name", "email", "password1", "password2"]

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError("Этот адрес уже зарегистрирован. Войдите в свой аккаунт.")
        return email
