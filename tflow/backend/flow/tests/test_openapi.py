from django.test import Client, TestCase
from flow.openapi import build_schema


class OpenApiTests(TestCase):
    def test_schema_is_public_and_references_resolve_with_unique_operation_ids(self):
        response = self.client.get("/api/openapi.json")
        self.assertEqual(response.status_code, 200)
        schema = response.json()
        self.assertEqual(schema["openapi"], "3.0.3")
        ids = []
        def inspect(value):
            if isinstance(value, list):
                for child in value:
                    inspect(child)
            elif isinstance(value, dict):
                if "$ref" in value:
                    target = schema
                    for part in value["$ref"].removeprefix("#/").split("/"):
                        target = target[part]
                for child in value.values():
                    inspect(child)
        inspect(schema)
        for path, operations in schema["paths"].items():
            for operation in operations.values():
                ids.append(operation["operationId"])
                for param in operation.get("parameters", []):
                    if param["in"] == "path":
                        self.assertTrue(param["required"])
                        self.assertIn("{" + param["name"] + "}", path)
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreater(len(ids), 45)

    def test_new_features_and_real_form_constraints_are_documented(self):
        schema = build_schema()
        models = schema["components"]["schemas"]
        self.assertIn("new_room_name", models["ActivityInput"]["properties"])
        self.assertNotIn("new_room_name", models["Activity"]["properties"])
        self.assertEqual(models["Subscription"]["properties"]["enabled"]["type"], "boolean")
        self.assertIn("subscribed", models["Community"]["properties"])
        self.assertNotIn("minLength", models["RegisterForm"]["properties"]["first_name"])
        self.assertIn("/communities/{community_id}/subscription", schema["paths"])
        self.assertEqual(schema["paths"]["/events"]["post"]["security"], [{"sessionCookie": []}])

    def test_docs_sets_csrf_and_uses_only_local_assets(self):
        client = Client(enforce_csrf_checks=True)
        page = client.get("/api/docs/")
        self.assertEqual(page.status_code, 200)
        self.assertIn("csrftoken", page.cookies)
        self.assertContains(page, "/api/docs/assets/swagger-ui-bundle.js")
        self.assertContains(page, "/api/openapi.json")
        self.assertContains(page, "X-CSRFToken")
        self.assertContains(page, "validatorUrl:null")
        self.assertNotContains(page, "https://")
        self.assertIn("no-store", page.headers["Cache-Control"])

    def test_only_whitelisted_assets_are_served(self):
        for filename, mime in [("swagger-ui-bundle.js", "application/javascript"), ("swagger-ui.css", "text/css")]:
            response = self.client.get("/api/docs/assets/" + filename)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["Content-Type"], mime)
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            response.close()
        self.assertEqual(self.client.get("/api/docs/assets/package.json").status_code, 404)
        self.assertEqual(self.client.post("/api/openapi.json").status_code, 405)
