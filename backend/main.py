"""NeuroGait AI ML backend (FastAPI).

Run:  uvicorn main:app --reload --port 8000
Receives only the numeric feature vector computed in the browser; no audio or video.
Research prototype, not a medical device.
"""
from __future__ import annotations

import os
from typing import Literal, Optional

import numpy as np
import xgboost as xgb
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from model import FEATURES, load_or_build

app = FastAPI(title="NeuroGait AI ML API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

MODEL, MODEL_SOURCE = load_or_build()


class Features(BaseModel):
    """All fields optional: a skipped test is sent as null."""
    tapRate: Optional[float] = Field(None, ge=0, le=20, description="taps/s")
    decay: Optional[float] = Field(None, ge=-100, le=100, description="amplitude decrement %")
    rhythm: Optional[float] = Field(None, ge=0, le=300, description="inter-tap CV %")
    tremor: Optional[float] = Field(None, ge=0, le=50, description="3-7 Hz power, % hand size")
    jitter: Optional[float] = Field(None, ge=0, le=50, description="%")
    shimmer: Optional[float] = Field(None, ge=0, le=100, description="%")
    hnr: Optional[float] = Field(None, ge=-20, le=60, description="dB")
    f0sd: Optional[float] = Field(None, ge=0, le=20, description="semitones")
    latency: Optional[float] = Field(None, ge=0, le=2000, description="saccade latency ms")
    pursuit: Optional[float] = Field(None, ge=0, le=3, description="smooth pursuit gain")
    fixation: Optional[float] = Field(None, ge=0, le=20, description="fixation SD deg")


class Contribution(BaseModel):
    feature: str
    value: Optional[float]
    shap: float  # log-odds contribution (positive pushes toward Parkinsonian pattern)


class Prediction(BaseModel):
    score: float  # 0-100
    predicted_class: Literal["Typical", "Parkinsonian Pattern"]
    confidence: float  # 0-1, distance of probability from the decision boundary
    model: str
    model_source: Literal["trained", "baseline"]
    contributions: list[Contribution]


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": "xgboost", "model_source": MODEL_SOURCE, "features": FEATURES}


@app.post("/predict", response_model=Prediction)
def predict(f: Features) -> Prediction:
    data = f.model_dump()
    x = np.array([[np.nan if data[k] is None else data[k] for k in FEATURES]], dtype=float)
    prob = float(MODEL.predict_proba(x)[0, 1])
    # Native TreeSHAP values from XGBoost; last column is the bias term.
    shap = MODEL.get_booster().predict(xgb.DMatrix(x, feature_names=FEATURES), pred_contribs=True)[0]
    contribs = [Contribution(feature=k, value=data[k], shap=float(shap[i])) for i, k in enumerate(FEATURES)]
    return Prediction(
        score=round(prob * 100, 1),
        predicted_class="Parkinsonian Pattern" if prob >= 0.5 else "Typical",
        confidence=round(abs(prob - 0.5) * 2, 3),
        model="xgboost",
        model_source=MODEL_SOURCE,
        contributions=contribs,
    )
