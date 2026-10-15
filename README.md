# Gait Voice Ai

Produce a comprehensive, formal Final Year Project (FYP) proposal document in PDF format for 'NeuroGait AI: Non-Invasive Neurological & Motor Disorder Screening via Multimodal Computer Vision and Vocal Biomarkers' for student Manan.

Write the report in clear, natural, professional English that sounds authentic, articulate, and academic, avoiding artificial filler or awkward punctuation. Detail thoroughly how AI is integrated and applied across each module:
1. Executive Summary & Clinical Problem Statement (early detection of Parkinson's and motor disorders, lack of accessible screening in developing regions).
2. Computer Vision Kinematic Analysis (MediaPipe 3D hand and pose tracking at 30-60 FPS, measuring 4-6 Hz tremor frequency, movement amplitude, and velocity decay for bradykinesia using standardized UPDRS finger-tapping protocols).
3. Acoustic Vocal Biomarker Analysis (Web Audio / Librosa extracting sustained vowel phonation features: jitter, shimmer, harmonics-to-noise ratio).
4. Machine Learning & Risk Scoring Engine (classification models combining kinematic and acoustic features into a clinical risk probability score with explainability heatmaps).
5. Data Sourcing & Verification (benchmarking against the open-source UCI Parkinson's Telemonitoring Dataset and mPower mobile dataset).
6. System Architecture & Complete Technology Stack (React frontend, MediaPipe, Web Audio API, Python FastAPI backend, Scikit-learn/PyTorch, Supabase).
7. 3-Month Implementation & Evaluation Timeline.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://gait-voice-ai.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b7ddd681-696e-4565-8faf-f9f74afa9422).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
