"""Shared feature schema, baseline cohort generator and XGBoost helpers.

Feature keys match the browser app (src/lib/neuro/scoring.ts) so the
frontend can send its numeric feature vector unchanged. Missing modalities
are sent as null and handled natively by XGBoost as NaN.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import xgboost as xgb

FEATURES: list[str] = [
    "tapRate", "decay", "rhythm", "tremor",          # motor
    "jitter", "shimmer", "hnr", "f0sd",              # voice
    "latency", "pursuit", "fixation",                # oculomotor
]

MODEL_PATH = Path(__file__).parent / "model" / "neurogait_xgb.json"

# (typical mean, typical sd, parkinsonian mean, parkinsonian sd) per feature.
# Ranges follow published reference values used by the frontend heuristic.
_DIST = {
    "tapRate": (4.2, 0.8, 2.6, 0.8),
    "decay": (8, 6, 30, 12),
    "rhythm": (10, 4, 25, 10),
    "tremor": (0.3, 0.2, 1.4, 0.7),
    "jitter": (0.6, 0.25, 1.4, 0.6),
    "shimmer": (3.0, 1.0, 6.0, 2.0),
    "hnr": (22, 3, 16, 4),
    "f0sd": (0.35, 0.15, 0.9, 0.4),
    "latency": (210, 30, 300, 60),
    "pursuit": (0.9, 0.06, 0.68, 0.12),
    "fixation": (0.3, 0.12, 0.8, 0.35),
}


def baseline_cohort(n_pd: int = 188, n_ctrl: int = 64, seed: int = 470) -> tuple[np.ndarray, np.ndarray]:
    """Synthetic multimodal cohort sized like the 252-patient UCI study (188 PD / 64 controls).

    It is a calibrated starting point so the API works out of the box. It is NOT real
    patient data; replace it by running train_model.py with a real dataset.
    """
    rng = np.random.default_rng(seed)
    rows, labels = [], []
    for label, n in ((1, n_pd), (0, n_ctrl)):
        for _ in range(n):
            severity = rng.uniform(0.4, 1.0) if label else 0.0
            row = []
            for f in FEATURES:
                tm, ts, pm, ps = _DIST[f]
                mean = tm + (pm - tm) * severity
                sd = ts + (ps - ts) * severity
                row.append(rng.normal(mean, sd))
            row = np.array(row, dtype=float)
            row[rng.random(len(FEATURES)) < 0.1] = np.nan  # simulate skipped tests
            rows.append(row)
            labels.append(label)
    return np.vstack(rows), np.array(labels)


def make_classifier() -> xgb.XGBClassifier:
    return xgb.XGBClassifier(
        n_estimators=200, max_depth=3, learning_rate=0.08, subsample=0.9,
        colsample_bytree=0.9, scale_pos_weight=64 / 188, eval_metric="logloss",
        random_state=470,
    )


def load_or_build() -> tuple[xgb.XGBClassifier, str]:
    """Load a trained model if present, otherwise fit the baseline in about a second."""
    clf = make_classifier()
    if MODEL_PATH.exists():
        clf.load_model(MODEL_PATH)
        return clf, "trained"
    X, y = baseline_cohort()
    clf.fit(X, y)
    return clf, "baseline"
