from django.urls import path, re_path
from flow import views
from flow import openapi
from flow.deploy_hooks import dns_challenge
from flow.observability import metrics_view
from flow import broadcasts

urlpatterns = [
    path("api/<str:resource>/<str:item_id>/broadcast", broadcasts.control),
    path("api/broadcasts/<uuid:session>/chunks/<int:sequence>", broadcasts.upload),
    path("api/broadcasts/<uuid:session>/media/<str:filename>", broadcasts.media),
    path("api/broadcasts/<uuid:session>/chat", broadcasts.chat),
    path("internal/metrics", metrics_view),
    path("login/", views.login_view, name="login"),
    path("register/", views.register_view, name="register"),
    path("logout/", views.logout_view, name="logout"),
    path("api/docs/", openapi.docs_view, name="swagger-ui"),
    path("api/internal/dns-challenge", dns_challenge, name="dns-challenge"),
    path("api/openapi.json", openapi.schema_view, name="openapi-schema"),
    path("api/docs/assets/<str:filename>", openapi.swagger_asset, name="swagger-asset"),
    re_path(r"^api/(?P<path>.*?)/?$", views.api),
    path("", views.frontend),
]
