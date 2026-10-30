from io import BytesIO
from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from flow.models import UserAvatar
from .test_api import FAST_HASHER, Scenario


def photo(*, size=(600, 400), format="PNG", color=(240, 150, 20)):
    stream = BytesIO()
    Image.new("RGB", size, color).save(stream, format=format)
    return SimpleUploadedFile("photo.png", stream.getvalue(), content_type="image/png")


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class AvatarTests(Scenario, TestCase):
    path = "/api/profile/avatar"

    def test_upload_resize_persist_and_profile_link(self):
        response = self.participant.post(self.path, {"avatar": photo()})
        self.assertEqual(response.status_code, 200, response.content)
        avatar = UserAvatar.objects.get(user=self.person)
        image = Image.open(BytesIO(bytes(avatar.image)))
        self.assertEqual(image.format, "WEBP")
        self.assertEqual(image.size, (384, 384))
        self.assertFalse(image.getexif())
        data = self.request("bootstrap", client=self.participant)
        self.assertTrue(data["profile"]["avatar_url"].startswith(self.path + "?v="))
        self.assertNotIn("image", data["profile"])
        fresh_session = Client(); fresh_session.force_login(self.person)
        result = fresh_session.get(data["profile"]["avatar_url"])
        self.assertEqual(result.content, bytes(avatar.image))
        self.assertEqual(result["Content-Type"], "image/webp")
        self.assertEqual(result["X-Content-Type-Options"], "nosniff")
        self.assertIn("private", result["Cache-Control"])

    def test_replace_changes_version_and_delete_restores_initial(self):
        self.participant.post(self.path, {"avatar": photo()})
        old = self.request("bootstrap", client=self.participant)["profile"]["avatar_url"]
        self.participant.post(self.path, {"avatar": photo(color=(0, 20, 100))})
        new = self.request("bootstrap", client=self.participant)["profile"]["avatar_url"]
        self.assertNotEqual(old, new)
        self.assertEqual(UserAvatar.objects.filter(user=self.person).count(), 1)
        self.assertEqual(self.participant.delete(self.path).status_code, 200)
        self.assertEqual(self.participant.delete(self.path).status_code, 200)
        self.assertIsNone(self.request("bootstrap", client=self.participant)["profile"]["avatar_url"])
        self.assertEqual(self.participant.get(self.path).status_code, 404)

    def test_authentication_and_only_own_avatar(self):
        self.assertEqual(Client().get(self.path).status_code, 401)
        self.assertEqual(Client().post(self.path, {"avatar": photo()}).status_code, 401)
        self.participant.post(self.path, {"avatar": photo(), "user_id": self.other.pk})
        self.assertTrue(UserAvatar.objects.filter(user=self.person).exists())
        self.assertFalse(UserAvatar.objects.filter(user=self.other).exists())
        self.assertEqual(self.stranger.get(self.path + "?user_id=" + self.person.pk).status_code, 404)
        self.stranger.delete(self.path, {"user_id": self.person.pk})
        self.assertTrue(UserAvatar.objects.filter(user=self.person).exists())

    def test_csrf_is_required_for_upload_and_delete(self):
        client = Client(enforce_csrf_checks=True); client.force_login(self.person)
        self.assertEqual(client.post(self.path, {"avatar": photo()}).status_code, 403)
        self.assertEqual(client.delete(self.path).status_code, 403)
        token = client.get("/api/auth/me").json()["csrfToken"]
        self.assertEqual(client.post(self.path, {"avatar": photo()}, HTTP_X_CSRFTOKEN=token).status_code, 200)

    def test_invalid_or_missing_upload_does_not_replace_existing(self):
        self.participant.post(self.path, {"avatar": photo()})
        original = bytes(UserAvatar.objects.get(user=self.person).image)
        for data, code in [({}, "AVATAR_REQUIRED"),
                           ({"avatar": SimpleUploadedFile("fake.jpg", b"<svg onload='alert(1)'></svg>", content_type="image/jpeg")}, "AVATAR_FORMAT"),
                           ({"avatar": photo(format="GIF")}, "AVATAR_FORMAT")]:
            response = self.participant.post(self.path, data)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["code"], code)
        self.assertEqual(bytes(UserAvatar.objects.get(user=self.person).image), original)

    def test_upload_size_and_pixel_limits(self):
        large = SimpleUploadedFile("large.png", b"0" * (5 * 1024 * 1024 + 1), content_type="image/png")
        response = self.participant.post(self.path, {"avatar": large})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "AVATAR_TOO_LARGE")
        response = self.participant.post(self.path, {"avatar": photo(size=(4096, 4096))})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "AVATAR_DIMENSIONS")
        self.assertFalse(UserAvatar.objects.exists())

    def test_jpeg_and_webp_inputs_are_supported(self):
        for format in ["JPEG", "WEBP"]:
            response = self.participant.post(self.path, {"avatar": photo(format=format)})
            self.assertEqual(response.status_code, 200, response.content)
