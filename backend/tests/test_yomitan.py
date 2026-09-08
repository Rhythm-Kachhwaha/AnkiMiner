import unittest

from app.services.yomitan import YomitanResponseError, YomitanService


class YomitanNormalizationTests(unittest.TestCase):
    def test_normalizes_first_token(self):
        term = YomitanService.normalize_tokenize_response([{"content": [[{"text": "映画", "reading": "えいが"}]]}])
        self.assertEqual((term.expression, term.reading), ("映画", "えいが"))

    def test_allows_empty_reading_from_scanning_parser(self):
        term = YomitanService.normalize_tokenize_response([{"content": [[{"text": "映画", "reading": ""}]]}])
        self.assertEqual((term.expression, term.reading), ("映画", ""))

    def test_rejects_empty_or_malformed_responses(self):
        for payload in ([], {}, [{"content": [[]]}], [{"content": [[{"reading": "えいが"}]]}]):
            with self.subTest(payload=payload):
                with self.assertRaises(YomitanResponseError):
                    YomitanService.normalize_tokenize_response(payload)
