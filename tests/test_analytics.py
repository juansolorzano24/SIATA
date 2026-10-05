import json
import os
import unittest
from unittest.mock import patch

import analytics
import server


WEBSITE_ID = "a20dd303-7898-469d-8614-21b988fe0389"


class AnalyticsTests(unittest.TestCase):
    def test_missing_invalid_or_nil_id_disables_external_tracking(self):
        for value in ("", "not-an-id", "https://another.example/script.js", "00000000-0000-0000-0000-000000000000"):
            with self.subTest(value=value), patch.dict(os.environ, {"UMAMI_WEBSITE_ID": value}):
                status, headers, body = server.response_for_url("/api/analytics/config")
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(body), {"enabled": False})
                self.assertNotIn(analytics.UMAMI_ORIGIN, headers["Content-Security-Policy"])

    def test_public_configuration_is_uncached_and_contains_no_credentials(self):
        with patch.dict(os.environ, {"UMAMI_WEBSITE_ID": WEBSITE_ID, "UMAMI_DOMAINS": "siata.onrender.com",
                                     "UMAMI_API_KEY": "private-not-for-the-browser"}):
            status, headers, body = server.response_for_url("/api/analytics/config")
            self.assertEqual(status, 200)
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertEqual(json.loads(body), {"enabled": True, "website_id": WEBSITE_ID,
                            "script_url": "https://cloud.umami.is/script.js", "domains": ["siata.onrender.com"]})
            self.assertNotIn(b"private-not-for-the-browser", body)
            csp = headers["Content-Security-Policy"]
            self.assertIn("script-src 'self' https://cloud.umami.is;", csp)
            self.assertIn("connect-src 'self' https://gateway.umami.is;", csp)
            self.assertNotIn("script-src *", csp)

    def test_malformed_domains_cannot_expand_the_security_policy(self):
        for domain in ("localhost", "", "https://siata.onrender.com", "site.example; script-src *", "*.example.com"):
            with self.subTest(domain=domain), patch.dict(os.environ, {"UMAMI_WEBSITE_ID": WEBSITE_ID, "UMAMI_DOMAINS": domain}):
                self.assertEqual(analytics.public_config(), {"enabled": False})

    def test_backend_configuration_files_are_not_public(self):
        for path in ("/analytics.py", "/ESTADISTICAS.md", "/.env"):
            self.assertEqual(server.response_for_url(path)[0], 404)
        self.assertEqual(server.response_for_url("/analytics.js")[0], 200)


if __name__ == "__main__":
    unittest.main()
