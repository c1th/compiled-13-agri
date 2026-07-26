"""Content-addressed cache for precomputed frozen RNA-FM embeddings."""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np

from .rnafm import embed

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / "data" / "embeddings"


def sequence_key(sequence: str) -> str:
    cleaned = "".join(sequence.upper().replace("T", "U").split())
    return hashlib.sha256(cleaned.encode("ascii")).hexdigest()


def cached_embed(sequence: str, cache_dir: Path = CACHE_DIR) -> np.ndarray:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{sequence_key(sequence)}.npy"
    if path.exists():
        return np.load(path)
    vector = embed(sequence)
    np.save(path, vector)
    return vector


def cached_similarity(left: str, right: str, cache_dir: Path = CACHE_DIR) -> float:
    left_embedding = cached_embed(left, cache_dir)
    right_embedding = cached_embed(right, cache_dir)
    denominator = np.linalg.norm(left_embedding) * np.linalg.norm(right_embedding)
    if denominator == 0:
        raise ValueError("RNA-FM produced a zero-norm embedding")
    return float(np.dot(left_embedding, right_embedding) / denominator)
