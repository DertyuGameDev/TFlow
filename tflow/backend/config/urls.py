from django.urls import path, re_path
from flow import views
from flow import openapi

urlpatterns = [
    path("login/", views.login_view, name="login"),
    path("register/", views.register_view, name="register"),
    path("logout/", views.logout_view, name="logout"),
    path("api/docs/", openapi.docs_view, name="swagger-ui"),
    path("api/openapi.json", openapi.schema_view, name="openapi-schema"),
    path("api/docs/assets/<str:filename>", openapi.swagger_asset, name="swagger-asset"),
    re_path(r"^api/(?P<path>.*?)/?$", views.api),
    path("", views.frontend),
]
