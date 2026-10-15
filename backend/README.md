# NeuroGait AI – Python ML backend

A small FastAPI service that scores the numeric feature vector produced by the
web app with an XGBoost model and returns per-feature SHAP contributions.
The browser never sends audio, video or landmarks, only 11 numbers.

> Research prototype. Not a medical device and not a diagnosis.

## 1. Install

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

## 2. Run

```bash
uvicorn main:app --reload --port 8000
```

Open http://localhost:8000/health and http://localhost:8000/docs to try it.

## 3. Model

- On first start, if `model/neurogait_xgb.json` does not exist, the API fits a
  baseline XGBoost model on a synthetic 252-patient cohort (188 PD / 64 controls)
  built from published reference ranges. It is a working starting point, not
  real patient data.
- To train and save a model:

```bash
python train_model.py                              # baseline cohort only
python train_model.py --uci pd_speech_features.csv # add UCI ID 470 voice data
```

  Download the UCI file from https://archive.ics.uci.edu/dataset/470. Recordings are
  averaged per subject before 5-fold stratified cross-validation. Restart uvicorn after training.

## 4. API

`POST /predict` (all fields optional, use `null` for skipped tests):

```json
{ "tapRate": 3.1, "decay": 22, "rhythm": 18, "tremor": 0.9,
  "jitter": 1.2, "shimmer": 4.5, "hnr": 18, "f0sd": 0.6,
  "latency": 260, "pursuit": 0.8, "fixation": 0.5 }
```

Returns `score` (0–100), `predicted_class` ("Typical" / "Parkinsonian Pattern"),
`confidence`, `model_source` and `contributions` (SHAP log-odds per feature).

## 5. Connecting the React app

The app calls `VITE_ML_API_URL` (default `http://localhost:8000/predict`) on the
Results page with a 2.5 s timeout. If the server is offline, the app quietly uses
its built-in rule-based score. A badge shows which one was used:
"Mode: XGBoost ML Model" or "Mode: Edge Rule Heuristic".

Note: a page served over https (the published site) cannot call an http
localhost server, so ML mode works when running the app locally or when the
backend is deployed behind https and `VITE_ML_API_URL` points to it. Set
`ALLOWED_ORIGINS` to restrict CORS in production.
