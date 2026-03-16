# Eval: MJ — Scenario 15 — ML Pipeline Architecture (Very Hard)

## Overview

Tests MJ's ability to design an architecture for a machine learning pipeline, including training, serving, feature stores, and model versioning — a domain requiring specialized architectural knowledge.

---

category: capability

graders:
  - type: contains
    values: ["feature store", "model serving", "trade_off", "risk", "versioning"]
  - type: section_present
    sections: ["Trade", "Risk", "Implementation"]
  - type: length_bounds
    min: 600

prompt: |
  A logistics platform wants to build an ML-based delivery time estimation system:

  - Input: order details (weight, distance, zone, time of day, weather, current courier load)
  - Output: predicted delivery time in minutes
  - The prediction must be returned within 100ms at P99 (called during checkout)
  - The model must be retrained weekly with new delivery data
  - The business needs to be able to roll back to the previous model version if the new model degrades
  - Team: 2 ML engineers, 2 platform engineers, total of 4 people

  Design the architecture for this ML pipeline. Use your full output schema.

expected_behavior: |
  - MJ designs a two-path architecture: training pipeline (offline, batch) and serving pipeline (online, real-time)
  - Training pipeline:
    - Weekly batch job reads historical delivery data
    - Feature engineering (transforms raw data into ML features)
    - Model training and validation
    - Model versioning: at minimum, current model and previous model are retained
  - Serving pipeline:
    - Feature store for low-latency feature retrieval (avoids recomputing features at serving time)
    - Model server (e.g., TensorFlow Serving, TorchServe, or simpler REST model server) with sub-100ms P99 constraint
    - Model version management: A/B testing or blue/green deployment capability for rollback
  - MJ identifies the 100ms P99 constraint as a hard constraint on the serving path: model inference must be fast enough; ensemble models or very large models may not fit; this may constrain model complexity
  - MJ notes: feature computation must be pre-computed (feature store) not real-time (would add latency)
  - trade_offs: feature store adds infrastructure complexity but is necessary for latency; model versioning adds storage cost but is necessary for rollback
  - risks: feature store becoming stale (features updated less frequently than orders are placed); model drift if weekly retraining doesn't catch distribution shifts
  - For 4-person team: recommend managed services where possible (SageMaker, Vertex AI) rather than self-hosted training infrastructure

failure_modes: |
  - Designing only the training pipeline without the serving pipeline
  - Not addressing the 100ms P99 constraint on serving
  - Missing feature store as a necessary component
  - No model versioning or rollback mechanism
  - Recommending self-hosted training infrastructure for a 4-person team without acknowledging complexity

scoring_rubric: |
  pass:
    - Both training and serving pipelines designed
    - 100ms P99 constraint addressed (feature store, model complexity guidance)
    - Feature store identified as necessary
    - Model versioning and rollback mechanism designed
    - Team size factored (managed services recommendation)
    - trade_offs and risks present

  partial:
    - Both pipelines mentioned but one is vague
    - 100ms constraint mentioned but not fully addressed
    - Feature store mentioned
    - Model versioning mentioned but rollback not designed

  fail:
    - Only training pipeline designed
    - 100ms constraint not addressed
    - No feature store
    - No model versioning
    - Self-hosted infrastructure recommended for small team without caveat
