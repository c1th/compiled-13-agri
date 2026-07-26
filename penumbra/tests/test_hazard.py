import unittest

from corpus.evidence import load_corpus
from hazard.fit import prepare_training_data


class HazardPreparationTests(unittest.TestCase):
    def test_preparation_preserves_study_structure(self):
        data, metadata = prepare_training_data(load_corpus())
        self.assertEqual(len(data["y"]), metadata["n_rows"])
        self.assertEqual(metadata["n_studies"], 22)
        self.assertEqual(len(data["sequence_sd"]), metadata["n_rows"])
