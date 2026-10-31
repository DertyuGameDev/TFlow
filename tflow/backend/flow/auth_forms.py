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


class OrganizerSwitch(forms.CheckboxInput):
    def __init__(self, attrs=None):
        super().__init__(
            attrs={"role": "switch", **(attrs or {})},
            check_test=lambda value: value == "organizer",
        )

    def format_value(self, value):
        return "organizer"

    def value_from_datadict(self, data, files, name):
        # An unchecked HTML switch is omitted from POST. Keep role validation
        # and existing explicit participant/organizer form submissions intact.
        return data.get(name, "participant")


class InterestCategoriesWidget(forms.CheckboxSelectMultiple):
    template_name = "widgets/interest_categories.html"


class RegisterForm(UserCreationForm):
    role = forms.ChoiceField(
        label="Организовывать",
        required=False,
        choices=[
            ("participant", "Участвовать"),
            ("organizer", "Организовывать"),
        ],
        initial="participant",
        widget=OrganizerSwitch(
            attrs={
                "aria-label": "Организовывать",
                "aria-describedby": "role-description",
            }
        ),
    )
    email = forms.EmailField(
        label="Электронная почта",
        validators=[validate_text],
        widget=forms.EmailInput(attrs={"autocomplete": "email", "autofocus": True}),
    )
    first_name = forms.CharField(
        label="Имя",
        required=False,
        validators=[validate_text],
        min_length=1,
        max_length=80,
        widget=forms.TextInput(attrs={"autocomplete": "given-name"}),
    )
    last_name = forms.CharField(
        label="Фамилия",
        required=False,
        validators=[validate_text],
        min_length=1,
        max_length=80,
        widget=forms.TextInput(attrs={"autocomplete": "family-name"}),
    )
    interests = forms.MultipleChoiceField(
        label="Интересы",
        required=False,
        choices=INTEREST_CHOICES,
        widget=InterestCategoriesWidget,
        help_text="Выберите несколько тегов или оставьте на потом.",
    )
    password1 = forms.CharField(
        label="Пароль",
        validators=[validate_text],
        strip=False,
        widget=forms.PasswordInput(attrs={
            "autocomplete": "new-password",
            "minlength": 8,
            "aria-describedby": "id_password1_helptext",
        }),
    )
    password2 = forms.CharField(
        label="Повторите пароль",
        required=False,
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

    def validate_password_for_user(self, user, password_field_name="password1"):
        # The compact form has one password field; keep Django's full policy.
        super().validate_password_for_user(user, password_field_name)

    def save(self, commit=True):
        user = super().save(commit=False)
        user.name = full_name(user.first_name, user.last_name)
        if commit:
            user.save()
            self.save_m2m()
        return user

    def clean_interests(self):
        value = ", ".join(dict.fromkeys(self.cleaned_data["interests"]))
        if len(value) > 300:
            raise forms.ValidationError(
                "Выберите меньше интересов — оставьте самые важные для вас."
            )
        return value

    def clean_role(self):
        return self.cleaned_data.get("role") or "participant"

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError(
                "Этот адрес уже зарегистрирован. Войдите в свой аккаунт."
            )
        return email
