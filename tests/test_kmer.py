import unittest

from design.kmer import TranscriptomeIndex, canonical_kmer, reverse_complement


class KmerTests(unittest.TestCase):
    def test_reverse_complement_is_canonical_equivalent(self):
        sequence = "ATGCGTACGTTAGCTAGGCTA"
        self.assertEqual(canonical_kmer(sequence), canonical_kmer(reverse_complement(sequence)))

    def test_profile_exact_match(self):
        construct = "ATGCGTACGTTAGCTAGGCTA"
        index = TranscriptomeIndex({"transcript": "GGG" + construct + "TTT"})
        profile = index.profile(construct, "test_species")
        self.assertEqual(profile.max_contiguous_match_nt, 21)
        self.assertEqual(profile.n_21mers_perfect, 1)
        self.assertEqual(profile.matched_transcript_ids, ("transcript",))
