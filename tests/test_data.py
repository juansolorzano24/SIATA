import gzip
import json
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch
from urllib.error import HTTPError

import server
from wsgi import application


class DataTests(unittest.TestCase):
    def observation(self, amount=0, stamp="2026-10-04 19:55:00"):
        feature = {"geometry": {"type": "Point", "coordinates": [-75.56616, 6.20661]},
                   "properties": {"codigo": 41, "nombre": "Comisaría El Poblado",
                                  "fecha_ultima_actualizacion": stamp, "acumulado_15min": amount}}
        return server.observation_record("Pluviometrica", feature,
                                         datetime(2026, 10, 5, 1, 0, tzinfo=timezone.utc))

    def test_zero_rain_is_a_valid_recent_reading(self):
        record = self.observation()
        self.assertEqual(record["readings"][0]["value"], 0)
        self.assertTrue(record["recent"])
        self.assertEqual(record["age_minutes"], 5)
        self.assertTrue(record["observed_at"].endswith("-05:00"))

    def test_old_or_missing_readings_are_not_current_rain(self):
        self.assertFalse(self.observation(stamp="2026-10-03 19:55:00")["recent"])
        self.assertFalse(self.observation(stamp=None)["recent"])
        self.assertEqual(self.observation(amount=-999)["readings"], [])

    def test_radar_keeps_original_bytes_and_matches_its_timestamp(self):
        metadata = {"available": True, "observed_at": "2026-10-05T00:49:00+00:00"}
        original = b"\x89PNG\r\n\x1a\noriginal-pixels"
        with patch.object(server, "get_radar", return_value=metadata), \
             patch.object(server, "radar_cache", {"image_path": "/data/radar/10_DBZH/20261005/202610050049.png"}), \
             patch.object(server, "read_operational", return_value=original):
            self.assertEqual(server.get_radar_image(metadata["observed_at"]), original)
            with self.assertRaises(ValueError):
                server.get_radar_image("2026-10-05T00:40:00+00:00")

    def radar_clock(self, stamp="2026-10-05T20:00:00+00:00"):
        clock = Mock(wraps=datetime)
        clock.now.return_value = datetime.fromisoformat(stamp)
        return clock

    def test_recent_original_radar_is_preferred(self):
        def source(base, path, **options):
            self.assertIn("/10_DBZH/", path)
            return b'<a href="202610051955.png">image</a>'
        with patch.object(server, "datetime", self.radar_clock()), \
             patch.object(server, "radar_cache", {}), \
             patch.object(server, "read_operational", side_effect=source):
            metadata = server.get_radar()
        self.assertTrue(metadata["available"])
        self.assertEqual(metadata["product"], "10_DBZH")
        self.assertEqual(metadata["bounds"], server.RADAR_BOUNDS)

    def test_stopped_original_uses_recent_backup_with_its_own_bounds_and_pixels(self):
        original = b"\x89PNG\r\n\x1a\nbackup-original-pixels"
        def source(base, path, **options):
            if path.endswith('.png'):
                self.assertEqual(path, "/data/radar/05_DBZH/20261005/202610051954.png")
                return original
            stamp = "202610051310" if "/10_DBZH/" in path else "202610051954"
            return ("<a href='" + stamp + ".png'>image</a>").encode()
        with patch.object(server, "datetime", self.radar_clock()), \
             patch.object(server, "radar_cache", {"image_path": "/old.png", "image": b"old-pixels"}), \
             patch.object(server, "read_operational", side_effect=source):
            metadata = server.get_radar()
            body = server.get_radar_image(metadata["observed_at"])
        self.assertTrue(metadata["available"])
        self.assertEqual(metadata["product"], "05_DBZH")
        self.assertEqual(metadata["bounds"], [[4.2, -77.67], [8.3, -73.34]])
        self.assertEqual(metadata["age_minutes"], 6)
        self.assertEqual(body, original)

    def test_original_connection_failure_does_not_hide_available_backup(self):
        def source(base, path, **options):
            if "/10_DBZH/" in path:
                raise TimeoutError("original unavailable")
            return b'<a href="202610051954.png">image</a>'
        with patch.object(server, "datetime", self.radar_clock()), \
             patch.object(server, "radar_cache", {}), \
             patch.object(server, "read_operational", side_effect=source):
            metadata = server.get_radar()
        self.assertTrue(metadata["available"])
        self.assertEqual(metadata["product"], "05_DBZH")

    def test_old_or_future_radar_is_never_presented_as_current(self):
        def source(base, path, **options):
            stamp = "202610051310" if "/10_DBZH/" in path else "202610052010"
            return ('<a href="' + stamp + '.png">image</a>').encode()
        with patch.object(server, "datetime", self.radar_clock()), \
             patch.object(server, "radar_cache", {}), \
             patch.object(server, "read_operational", side_effect=source):
            metadata = server.get_radar()
        self.assertFalse(metadata["available"])
        self.assertIsNone(metadata["image"])
        self.assertEqual(metadata["observed_at"], "2026-10-05T13:10:00+00:00")

    def test_radar_before_midnight_remains_available_on_the_next_utc_day(self):
        def source(base, path, **options):
            self.assertIn("/10_DBZH/", path)
            if path.endswith("20261006/"):
                raise HTTPError(base + path, 404, "not created yet", {}, None)
            return b'<a href="202610052357.png">image</a>'
        with patch.object(server, "datetime", self.radar_clock("2026-10-06T00:04:00+00:00")), \
             patch.object(server, "radar_cache", {}), \
             patch.object(server, "read_operational", side_effect=source):
            metadata = server.get_radar()
        self.assertTrue(metadata["available"])
        self.assertEqual(metadata["age_minutes"], 7)

    def test_non_image_response_is_rejected(self):
        metadata = {"available": True, "observed_at": "2026-10-05T19:54:00+00:00"}
        with patch.object(server, "get_radar", return_value=metadata), \
             patch.object(server, "radar_cache", {"image_path": "/data/radar/05_DBZH/20261005/202610051954.png"}), \
             patch.object(server, "read_operational", return_value=b"<html>unavailable</html>"):
            with self.assertRaisesRegex(ValueError, "imagen PNG"):
                server.get_radar_image(metadata["observed_at"])

    def test_radar_bounds_include_requested_sectors(self):
        (south, west), (north, east) = server.RADAR_BOUNDS
        for lat, lon in [(6.20661, -75.56616), (6.232, -75.611), (6.215262, -75.586992),
                         (6.2505, -75.5674), (6.233, -75.546)]:
            self.assertTrue(south < lat < north and west < lon < east)

        # Comprobar el territorio completo de las 16 comunas y los 5 corregimientos.
        sectors = json.loads((server.ROOT / "data" / "medellin_sectors.geojson").read_text(encoding="utf-8"))
        def assert_coordinates(coordinates):
            if isinstance(coordinates[0], (int, float)):
                lon, lat = coordinates[:2]
                self.assertTrue(south < lat < north and west < lon < east)
            else:
                for child in coordinates:
                    assert_coordinates(child)
        for sector in sectors["features"]:
            with self.subTest(sector=sector["properties"]["name"]):
                assert_coordinates(sector["geometry"]["coordinates"])

    def test_private_files_and_traversal_are_not_served(self):
        for path in ["/server.py", "/serve.py", "/.git/config", "/.aws/credentials",
                     "/vendor/../server.py", "/%2e%2e/server.py", "/data/", "/data/Iguana.tif"]:
            self.assertEqual(server.response_for_url(path)[0], 404, path)

    def test_manifest_and_compressed_geography_are_valid(self):
        status, headers, body = server.response_for_url("/manifest.webmanifest")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/manifest+json")
        self.assertEqual(json.loads(body)["display"], "standalone")
        status, headers, body = server.response_for_url("/data/forecast_zones.geojson", "gzip")
        self.assertEqual(headers["Content-Encoding"], "gzip")
        self.assertEqual(len(json.loads(gzip.decompress(body))["features"]), 13)

    def test_wsgi_serves_head_and_rejects_writes(self):
        captured = []
        def start(status, headers):
            captured.append((status, dict(headers)))
        self.assertEqual(application({"REQUEST_METHOD": "HEAD", "PATH_INFO": "/healthz"}, start), [])
        self.assertEqual(captured[-1][0], "200 OK")
        self.assertEqual(captured[-1][1]["Cache-Control"], "no-store")
        application({"REQUEST_METHOD": "POST", "PATH_INFO": "/api/radar"}, start)
        self.assertEqual(captured[-1][0], "405 Method Not Allowed")


if __name__ == "__main__":
    unittest.main()
