"""Reproducible training script for the NeuroGait XGBoost model.

Usage:
  python train_model.py                         # baseline synthetic cohort (252 patients)
  python train_model.py --uci pd_speech_features.csv

--uci expects the UCI "Parkinson's Disease Classification" dataset (ID 470,
252 subjects, 3 recordings each). Recordings are averaged per subject (column `id`)
so the same person never appears in both train and test folds. That dataset only
has voice features, so motor and eye features are left empty (NaN) for those rows
and the voice rows are added to the baseline multimodal cohort.

Saves model/neurogait_xgb.json, which main.py loads automatically on start.
"""
from __future__ import annotations

import argparse

import numpy as np
from sklearn.metrics import accuracy_score, f1_score, recall_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold

from model import FEATURES, MODEL_PATH, baseline_cohort, make_classifier


def load_uci(path: str) -> tuple[np.ndarray, np.ndarray]:
    import pandas as pd

    df = pd.read_csv(path, header=1) if "id" not in pd.read_csv(path, nrows=0).columns else pd.read_csv(path)
    g = df.groupby("id").mean(numeric_only=True)
    X = np.full((len(g), len(FEATURES)), np.nan)
    X[:, FEATURES.index("jitter")] = g["locPctJitter"].to_numpy() * 100   # fraction -> %
    X[:, FEATURES.index("shimmer")] = g["locShimmer"].to_numpy() * 100    # fraction -> %
    X[:, FEATURES.index("hnr")] = g["meanHarmToNoiseHarmonic"].to_numpy()
    y = g["class"].astype(int).to_numpy()
    print(f"UCI: {len(g)} subjects ({y.sum()} PD / {(1 - y).sum()} controls)")
    return X, y


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uci", help="path to pd_speech_features.csv")
    args = ap.parse_args()

    X, y = baseline_cohort()
    if args.uci:
        Xu, yu = load_uci(args.uci)
        X, y = np.vstack([X, Xu]), np.concatenate([y, yu])

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=470)
    acc, auc, sens, spec, f1 = [], [], [], [], []
    for tr, te in skf.split(X, y):
        clf = make_classifier().fit(X[tr], y[tr])
        p = clf.predict_proba(X[te])[:, 1]
        pred = (p >= 0.5).astype(int)
        acc.append(accuracy_score(y[te], pred))
        auc.append(roc_auc_score(y[te], p))
        sens.append(recall_score(y[te], pred))
        spec.append(recall_score(y[te], pred, pos_label=0))
        f1.append(f1_score(y[te], pred))
    for name, v in [("Accuracy", acc), ("ROC-AUC", auc), ("Sensitivity", sens), ("Specificity", spec), ("F1", f1)]:
        print(f"{name:12s} {np.mean(v):.3f} ± {np.std(v):.3f}")

    MODEL_PATH.parent.mkdir(exist_ok=True)
    make_classifier().fit(X, y).save_model(MODEL_PATH)
    print(f"Saved {MODEL_PATH}. Restart uvicorn to load it.")


if __name__ == "__main__":
    main()
