import unittest
from unittest.mock import patch

from app.main import capture_term
from app.schemas import CaptureRequest
from app.services.yomitan import DictionaryEntry, EnrichedTerm, IdentifiedTerm, Sense


class CaptureRouteTests(unittest.TestCase):
    @patch("app.main.YomitanService")
    def test_returns_json_compatible_example_from_service_dataclass(self, service_class):
        service = service_class.return_value
        service.identify.return_value = IdentifiedTerm("映画", "えいが", "映画", "映画")
        service.enrich.return_value = EnrichedTerm(
            "映画",
            "えいが",
            "映画",
            "映画",
            [DictionaryEntry("Jitendex", True, "映画", "えいが", ["noun"], [], [Sense(["movie"])])],
        )

        response = capture_term(CaptureRequest(text="映画"))

        self.assertEqual(response.expression, "映画")
        self.assertEqual(response.reading, "えいが")
        self.assertEqual(response.entries[0].senses[0].glosses, ["movie"])


if __name__ == "__main__":
    unittest.main()
