"""Offline, frozen RNA-FM embeddings.

The checkpoint is downloaded by ``scripts/fetch_data.py`` into the gitignored
``data/models/rna-fm`` directory. This module never downloads weights: live
demo paths must work in airplane mode.
"""

from __future__ import annotations

import argparse
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT = ROOT / "data" / "models" / "rna-fm" / "RNA-FM_pretrained.pth"


@lru_cache(maxsize=1)
def load_model():
    """Load RNA-FM once in deterministic CPU inference mode."""
    if not CHECKPOINT.exists():
        raise FileNotFoundError(
            f"Missing RNA-FM checkpoint: {CHECKPOINT}. "
            "Run `uv run python scripts/fetch_data.py` while online first."
        )

    import fm

    # RNA-FM's official checkpoint contains this harmless configuration object.
    # PyTorch 2.6+ defaults to safe weight-only deserialization, so allowlist it
    # rather than broadly disabling the safe loader.
    torch.serialization.add_safe_globals([argparse.Namespace])
    model, alphabet = fm.pretrained.rna_fm_t12(model_location=str(CHECKPOINT))
    model.eval()
    return model, alphabet


def embed(sequence: str) -> np.ndarray:
    """Mean-pool RNA-FM's final-layer nucleotide embeddings for one sequence."""
    cleaned = sequence.upper().replace("T", "U").strip()
    if not cleaned:
        raise ValueError("RNA sequence must not be empty")

    model, alphabet = load_model()
    _, _, tokens = alphabet.get_batch_converter()([("query", cleaned)])
    with torch.inference_mode():
        result = model(tokens, repr_layers=[12])

    nucleotide_embeddings = result["representations"][12][0, 1 : len(cleaned) + 1]
    return nucleotide_embeddings.mean(dim=0).cpu().numpy().astype(np.float32)


def similarity(left: str, right: str) -> float:
    """Cosine similarity for two pooled RNA-FM sequence embeddings."""
    left_embedding = embed(left)
    right_embedding = embed(right)
    denominator = np.linalg.norm(left_embedding) * np.linalg.norm(right_embedding)
    if denominator == 0:
        raise ValueError("RNA-FM produced a zero-norm embedding")
    return float(np.dot(left_embedding, right_embedding) / denominator)
