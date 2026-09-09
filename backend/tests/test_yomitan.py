import http.client
import unittest
from unittest.mock import patch

from app.services.yomitan import YomitanResponseError, YomitanService, YomitanUnavailableError


class YomitanNormalizationTests(unittest.TestCase):
    def test_uses_dictionary_headword_and_deinflection_not_fragment(self):
        payload=[{"content":[[{"text":"見","reading":"み","headwords":[[{"term":"見る","reading":"みる","sources":[{"originalText":"見た","deinflectedText":"見る"}]}]]}]]}]
        term=YomitanService.normalize_tokenize_response(payload,"見た")
        self.assertEqual((term.expression,term.reading,term.source_text,term.deinflected_text),("見る","みる","見た","見る"))

    def test_supports_hiragana_katakana_and_kanji_tokens(self):
        for text in ("映画","こんにちは","カメラ"):
            payload=[{"content":[[{"text":text,"reading":"","headwords":[[{"term":text,"reading":text,"sources":[{"originalText":text,"deinflectedText":text}]}]]}]]}]
            self.assertEqual(YomitanService.normalize_tokenize_response(payload,text).expression,text)

    def test_ignores_punctuation_tokens_and_extracts_headword(self):
        payload = [{"content": [[
            {"text": "「", "reading": ""},
            {"text": "映画", "reading": "えいが", "headwords": [[{"term": "映画", "reading": "えいが", "sources": [{"originalText": "映画", "deinflectedText": "映画"}]}]]},
            {"text": "」", "reading": ""}
        ]]}]
        term = YomitanService.normalize_tokenize_response(payload, "「映画」")
        self.assertEqual((term.expression, term.reading), ("映画", "えいが"))

    def test_rejects_empty_or_malformed_responses(self):
        for payload in ([],{},[{"content":[[]]}],[{"content":[[{"reading":"えいが"}]]}]):
            with self.subTest(payload=payload):
                with self.assertRaises(YomitanResponseError): YomitanService.normalize_tokenize_response(payload)

    def test_remote_disconnected_raises_unavailable_not_500(self):
        """RemoteDisconnected (OSError, not URLError) must not escape as a bare exception."""
        service = YomitanService()
        with patch("app.services.yomitan.urlopen", side_effect=http.client.RemoteDisconnected("closed")):
            with self.assertRaises(YomitanUnavailableError):
                service._post_json("/tokenize", {"text": "映画"})
