import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from corpus.evidence import load_corpus, lock_external_benchmark


class ExternalBenchmarkTests(unittest.TestCase):
    def test_missing_external_data_never_falls_back_to_development(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "external.csv"
            with self.assertRaises(FileNotFoundError):
                lock_external_benchmark(load_corpus(), path)
