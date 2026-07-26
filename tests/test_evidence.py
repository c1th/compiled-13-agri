import unittest

import pandas as pd

from corpus.evidence import SOURCE_SD_NT, validate_corpus


class EvidenceTests(unittest.TestCase):
    def test_source_uncertainty_is_ordered(self):
        self.assertLess(SOURCE_SD_NT["recomputed"], SOURCE_SD_NT["reported"])
        self.assertLess(SOURCE_SD_NT["reported"], SOURCE_SD_NT["inferred"])

    def test_rejects_missing_study(self):
        frame = pd.DataFrame({"study_id": [""], "doi": ["x"]})
        self.assertTrue(validate_corpus(frame))
