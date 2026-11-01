from django import forms
from django.conf import settings
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

    def __init__(self, request=None, *args, **kwargs):
        super().__init__(request, *args, **kwargs)
        from .jury_demo import local_jury_login
        self.jury_demo = local_jury_login(request)
        if self.jury_demo:
            self.fields["username"] = forms.CharField(
                label="Почта или логин", validators=[validate_text],
                widget=forms.TextInput(attrs={"autocomplete":"username", "autofocus":True}),
            )

    def clean_username(self):
        value = self.cleaned_data["username"].strip().lower()
        if self.jury_demo:
            from .jury_demo import ALIASES
            return ALIASES.get(value) or forms.EmailField(validators=[validate_text]).clean(value)
        return value


class RegistrationRoleSelect(forms.RadioSelect):
    template_name = "widgets/registration_role.html"

    def value_from_datadict(self, data, files, name):
        # Keep participant as the default for clients that omit the role.
        return data.get(name, "participant")


class InterestCategoriesWidget(forms.CheckboxSelectMultiple):
    template_name = "widgets/interest_categories.html"


class RegisterForm(UserCreationForm):
    role = forms.ChoiceField(
        label="Как вы хотите использовать ТФлоу?",
        required=False,
        choices=[
            ("participant", "Участвовать"),
            ("organizer", "Организовывать"),
        ],
        initial="participant",
        widget=RegistrationRoleSelect(attrs={"aria-describedby": "role-note"}),
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
        widget=forms.TextInput(attrs={"autocomplete": "given-name"}),
    )
    last_name = forms.CharField(
        label="Фамилия (необязательно)",
        required=False,
        validators=[validate_text],
        widget=forms.TextInput(attrs={"autocomplete": "family-name"}),
    )
    interests = forms.MultipleChoiceField(
        label="Интересы",
        required=False,
        choices=INTEREST_CHOICES,
        widget=InterestCategoriesWidget,
        help_text="Начните вводить тему и выберите категорию из подсказок. Можно добавить несколько.",
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

    def __init__(self, *args, participant_only=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.demo_mode = settings.DEMO_MODE
        if self.demo_mode:
            self.fields["password1"].widget.attrs.pop("minlength", None)
        if participant_only:
            self.fields["role"].widget = forms.HiddenInput()
            self.fields["role"].disabled = True
            self.initial["role"] = "participant"

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
