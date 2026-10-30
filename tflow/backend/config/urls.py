from django.urls import path, re_path
from flow import views

urlpatterns = [
    path("login/", views.login_view, name="login"),
    path("register/", views.register_view, name="register"),
    path("logout/", views.logout_view, name="logout"),
    path("demo-login/", views.demo_login_view),
    re_path(r"^api/(?P<path>.*?)/?$", views.api),
    path("", views.frontend),
]
