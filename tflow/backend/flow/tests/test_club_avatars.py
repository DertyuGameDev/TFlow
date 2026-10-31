from io import BytesIO
from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from flow.models import Community, CommunityAvatar, UserAvatar
from .test_api import FAST_HASHER, Scenario
from .test_avatar import photo


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class ClubAvatarTests(Scenario, TestCase):
    def setUp(self):
        super().setUp()
        self.club = Community.objects.create(
            owner=self.person,
            name="Клуб встреч",
            description="Встречаемся и обсуждаем интересные темы",
            topic="Общение и знакомства",
            color="yellow",
        )
        self.path = f"/api/communities/{self.club.pk}/avatar"

    def club_data(self, client=None):
        return next(
            item
            for item in (client or self.participant)
            .get("/api/bootstrap")
            .json()["communities"]
            if item["id"] == self.club.pk
        )

    def test_owner_upload_is_public_and_normalized_without_changing_personal_avatar(
        self,
    ):
        self.participant.post(
            "/api/profile/avatar", {"avatar": photo(color=(200, 20, 20))}
        )
        personal = bytes(UserAvatar.objects.get(user=self.person).image)
        response = self.participant.post(self.path, {"avatar": photo()})
        self.assertEqual(response.status_code, 200, response.content)
        saved = CommunityAvatar.objects.get(community=self.club)
        decoded = Image.open(BytesIO(bytes(saved.image)))
        self.assertEqual(decoded.format, "WEBP")
        self.assertEqual(decoded.size, (384, 384))
        self.assertFalse(decoded.getexif())
        data = self.club_data(Client())
        self.assertTrue(data["avatar_url"].startswith(self.path + "?v="))
        self.assertNotIn("image", data)
        public = Client().get(data["avatar_url"])
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public.content, bytes(saved.image))
        self.assertEqual(public["Content-Type"], "image/webp")
        self.assertEqual(public["X-Content-Type-Options"], "nosniff")
        self.assertIn("no-store", public["Cache-Control"])
        self.assertEqual(
            bytes(UserAvatar.objects.get(user=self.person).image), personal
        )

    def test_replacement_and_removal_update_the_catalog(self):
        self.participant.post(self.path, {"avatar": photo()})
        first = self.club_data()["avatar_url"]
        self.participant.post(self.path, {"avatar": photo(color=(20, 100, 210))})
        self.assertNotEqual(self.club_data()["avatar_url"], first)
        self.assertEqual(self.participant.delete(self.path).status_code, 200)
        self.assertIsNone(self.club_data()["avatar_url"])
        self.assertEqual(Client().get(self.path).status_code, 404)
        self.assertFalse(CommunityAvatar.objects.filter(community=self.club).exists())

    def test_only_owner_can_change_a_club_avatar(self):
        self.assertEqual(Client().post(self.path, {"avatar": photo()}).status_code, 401)
        self.assertEqual(
            self.stranger.post(self.path, {"avatar": photo()}).status_code, 403
        )
        self.participant.post(self.path, {"avatar": photo()})
        self.assertEqual(self.stranger.delete(self.path).status_code, 403)
        self.assertTrue(CommunityAvatar.objects.filter(community=self.club).exists())
        self.assertEqual(
            Client().get("/api/communities/missing/avatar").status_code, 404
        )

    def test_invalid_images_preserve_the_previous_photo(self):
        self.participant.post(self.path, {"avatar": photo()})
        original = bytes(CommunityAvatar.objects.get(community=self.club).image)
        invalid = [
            None,
            SimpleUploadedFile(
                "fake.jpg", b"<svg onload='alert(1)'/>", content_type="image/jpeg"
            ),
            photo(format="GIF"),
            SimpleUploadedFile(
                "large.png", b"0" * (5 * 1024 * 1024 + 1), content_type="image/png"
            ),
        ]
        for upload in invalid:
            with self.subTest(upload=upload.name if upload else "missing"):
                result = self.participant.post(
                    self.path, {"avatar": upload} if upload else {}
                )
                self.assertEqual(result.status_code, 400)
                self.assertEqual(
                    bytes(CommunityAvatar.objects.get(community=self.club).image),
                    original,
                )

    def test_csrf_and_cascade_cleanup(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.person)
        self.assertEqual(client.post(self.path, {"avatar": photo()}).status_code, 403)
        token = client.get("/api/auth/me").json()["csrfToken"]
        self.assertEqual(
            client.post(
                self.path, {"avatar": photo()}, HTTP_X_CSRFTOKEN=token
            ).status_code,
            200,
        )
        self.assertEqual(client.delete(self.path).status_code, 403)
        self.club.delete()
        self.assertFalse(CommunityAvatar.objects.exists())
