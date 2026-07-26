"""Exact, strand-aware construct profiling with optional persisted indices.

Bloom filters are useful as a conservative prefilter, but every reported hit is
verified against the transcript sequence. The profile therefore never contains
a Bloom-filter false positive.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from Bio import SeqIO

from corpus.contracts import MatchProfile, MatchSource

DNA_COMPLEMENT = str.maketrans("ACGTU", "TGCAA")


def normalize(sequence: str) -> str:
    sequence = "".join(sequence.upper().split()).replace("U", "T")
    if not sequence or set(sequence) - set("ACGTN"):
        raise ValueError("Sequence must contain only A/C/G/T/U/N")
    return sequence


def reverse_complement(sequence: str) -> str:
    return normalize(sequence).translate(DNA_COMPLEMENT)[::-1]


def canonical_kmer(sequence: str) -> str:
    sequence = normalize(sequence)
    return min(sequence, reverse_complement(sequence))


def _hamming(left: str, right: str) -> int:
    return sum(a != b for a, b in zip(left, right))


@dataclass(frozen=True)
class TranscriptHit:
    transcript_id: str
    start: int
    strand: str
    matched_window: str
    contiguous_match_nt: int


class TranscriptomeIndex:
    """Exact seed index for one non-target transcriptome."""

    def __init__(self, sequences: dict[str, str], seed_nt: int = 11) -> None:
        if seed_nt < 6:
            raise ValueError("seed_nt must be at least 6")
        self.seed_nt = seed_nt
        self.sequences = {key: normalize(value) for key, value in sequences.items()}
        self._seeds: dict[str, list[tuple[str, int]]] = defaultdict(list)
        for transcript_id, sequence in self.sequences.items():
            for start in range(max(0, len(sequence) - seed_nt + 1)):
                seed = sequence[start : start + seed_nt]
                if "N" not in seed:
                    self._seeds[seed].append((transcript_id, start))

    @classmethod
    def from_fasta(cls, path: Path | str, seed_nt: int = 11) -> "TranscriptomeIndex":
        records = {
            record.id: str(record.seq)
            for record in SeqIO.parse(str(path), "fasta")
            if len(record.seq) >= seed_nt
        }
        if not records:
            raise ValueError(f"No usable FASTA records in {path}")
        return cls(records, seed_nt=seed_nt)

    def _extend(self, query: str, query_start: int, target: str, target_start: int) -> tuple[int, int]:
        left = 0
        while (
            query_start - left - 1 >= 0
            and target_start - left - 1 >= 0
            and query[query_start - left - 1] == target[target_start - left - 1]
        ):
            left += 1
        right = self.seed_nt
        while (
            query_start + right < len(query)
            and target_start + right < len(target)
            and query[query_start + right] == target[target_start + right]
        ):
            right += 1
        return query_start - left, left + right

    def _seed_hits(self, query: str, strand: str) -> Iterable[TranscriptHit]:
        for query_start in range(max(0, len(query) - self.seed_nt + 1)):
            seed = query[query_start : query_start + self.seed_nt]
            if "N" in seed:
                continue
            for transcript_id, target_start in self._seeds.get(seed, []):
                target = self.sequences[transcript_id]
                window_start, length = self._extend(query, query_start, target, target_start)
                target_window_start = target_start - (query_start - window_start)
                yield TranscriptHit(
                    transcript_id=transcript_id,
                    start=target_window_start,
                    strand=strand,
                    matched_window=target[target_window_start : target_window_start + length],
                    contiguous_match_nt=length,
                )

    def profile(self, construct: str, nontarget_species: str) -> MatchProfile:
        construct = normalize(construct)
        if len(construct) < 21:
            raise ValueError("Construct must be at least 21 nt")

        hits = [*self._seed_hits(construct, "+"), *self._seed_hits(reverse_complement(construct), "-")]
        best_by_locus: dict[tuple[str, int, str], TranscriptHit] = {}
        for hit in hits:
            key = (hit.transcript_id, hit.start, hit.strand)
            if key not in best_by_locus or hit.contiguous_match_nt > best_by_locus[key].contiguous_match_nt:
                best_by_locus[key] = hit

        construct_windows = [construct[i : i + 21] for i in range(len(construct) - 20)]
        def contains_exact_21(candidate: str) -> bool:
            """Verify a candidate against sequence, avoiding a giant 21-mer set."""
            for oriented in (candidate, reverse_complement(candidate)):
                seed = oriented[: self.seed_nt]
                for transcript_id, start in self._seeds.get(seed, []):
                    if self.sequences[transcript_id][start : start + 21] == oriented:
                        return True
            return False

        n_perfect = sum(contains_exact_21(window) for window in construct_windows)

        # Neighbour enumeration is exact because lookup is followed by the actual
        # canonical sequence set rather than trusting a probabilistic filter.
        n_1mm = 0
        n_2mm = 0
        alphabet = "ACGT"
        for query in construct_windows:
            neighbours_1 = set()
            for position, base in enumerate(query):
                for replacement in alphabet:
                    if replacement != base:
                        neighbours_1.add(query[:position] + replacement + query[position + 1 :])
            if any(contains_exact_21(candidate) for candidate in neighbours_1):
                n_1mm += 1
            found_2mm = False
            for first in range(21):
                for second in range(first + 1, 21):
                    for a in alphabet:
                        for b in alphabet:
                            if a == query[first] or b == query[second]:
                                continue
                            candidate = list(query)
                            candidate[first], candidate[second] = a, b
                            if contains_exact_21("".join(candidate)):
                                found_2mm = True
                                break
                        if found_2mm:
                            break
                    if found_2mm:
                        break
                if found_2mm:
                    break
            n_2mm += int(found_2mm)

        ranked = sorted(best_by_locus.values(), key=lambda item: item.contiguous_match_nt, reverse=True)
        return MatchProfile(
            nontarget_species=nontarget_species,
            max_contiguous_match_nt=max((item.contiguous_match_nt for item in ranked), default=0),
            n_21mers_perfect=n_perfect,
            n_21mers_1mm=n_1mm,
            n_21mers_2mm=n_2mm,
            matched_windows=tuple(item.matched_window for item in ranked[:10]),
            matched_transcript_ids=tuple(item.transcript_id for item in ranked[:10]),
            match_source=MatchSource.RECOMPUTED,
            sequence_evidence_level="verified",
        )
