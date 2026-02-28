"""Deepfake image detection module.

Loads an EfficientNet-B0 binary classifier (Deepfake vs Real) and exposes
a single `predict_deepfake()` function for inference.

Class mapping:
    0 → Deepfake
    1 → Real

Architecture decisions:
    - Model loaded once at startup via `load_model()` — avoids per-request I/O.
    - Preprocessing uses ImageNet normalization (EfficientNet standard).
    - Softmax applied to raw logits for calibrated probabilities.
    - All inference runs under `torch.no_grad()` for speed + memory efficiency.
    - GPU auto-detection: uses CUDA when available, falls back to CPU.
"""

from __future__ import annotations

import io
import logging
from pathlib import Path

import torch
import torch.nn.functional as F
from PIL import Image
from torchvision import transforms, models

logger = logging.getLogger("clarix.deepfake")

# ── Module-level state (populated by load_model) ──────────────────────

_model: torch.nn.Module | None = None
_device: torch.device | None = None
_transform: transforms.Compose | None = None

# Class index → label
CLASS_LABELS = {0: "Deepfake", 1: "Real"}

# Default model path (relative to project root)
DEFAULT_MODEL_PATH = Path(__file__).resolve().parent.parent / "image_model" / "deepfake_model.pth"


# ── Preprocessing pipeline ─────────────────────────────────────────────

def _build_transform() -> transforms.Compose:
    """ImageNet-standard preprocessing for EfficientNet-B0 (224×224)."""
    return transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(
            mean=[0.485, 0.456, 0.406],
            std=[0.229, 0.224, 0.225],
        ),
    ])


# ── Model loading ──────────────────────────────────────────────────────

def load_model(model_path: str | Path | None = None) -> None:
    """Load the EfficientNet-B0 deepfake classifier from disk.

    Called once during FastAPI lifespan startup.  Sets module-level
    ``_model``, ``_device``, and ``_transform``.
    """
    global _model, _device, _transform

    path = Path(model_path) if model_path else DEFAULT_MODEL_PATH

    if not path.exists():
        raise FileNotFoundError(f"Deepfake model not found at {path}")

    # Device selection — GPU when available
    _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info("Deepfake detector device: %s", _device)

    # Build EfficientNet-B0 with modified classifier head (2 classes)
    _model = models.efficientnet_b0(weights=None)
    in_features = _model.classifier[1].in_features
    _model.classifier[1] = torch.nn.Sequential(
        torch.nn.Linear(in_features, 256),
        torch.nn.Dropout(0.3),
        torch.nn.ReLU(),
        torch.nn.Linear(256, 2),
    )

    # Load trained weights
    state_dict = torch.load(path, map_location=_device, weights_only=True)
    _model.load_state_dict(state_dict)

    # Eval mode — disables dropout / batchnorm training behaviour
    _model.eval()
    _model.to(_device)

    # Build preprocessing transform
    _transform = _build_transform()

    logger.info("Deepfake detection model loaded successfully from %s", path)


def is_loaded() -> bool:
    """Check whether the model is ready for inference."""
    return _model is not None


# ── Inference ──────────────────────────────────────────────────────────

def predict_deepfake(image_bytes: bytes) -> dict:
    """Run deepfake detection on raw image bytes.

    Returns a dict with:
        label             – "Deepfake" or "Real"
        confidence        – confidence % of the predicted label
        deepfake_probability – probability % the image is a deepfake
        real_probability     – probability % the image is real

    Raises:
        RuntimeError: if the model has not been loaded yet.
        ValueError:   if the image cannot be read / decoded.
    """
    if _model is None or _transform is None or _device is None:
        raise RuntimeError("Deepfake model not loaded — call load_model() first")

    # ── Read & preprocess image ────────────────────────────────────────
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as exc:
        raise ValueError(f"Could not decode image: {exc}") from exc

    tensor = _transform(image).unsqueeze(0).to(_device)  # [1, 3, 224, 224]

    # ── Forward pass ───────────────────────────────────────────────────
    with torch.no_grad():
        logits = _model(tensor)                        # [1, 2]
        probs = F.softmax(logits, dim=1).squeeze()     # [2]

    deepfake_prob = float(probs[0]) * 100
    real_prob = float(probs[1]) * 100
    predicted_idx = int(torch.argmax(probs))
    label = CLASS_LABELS[predicted_idx]
    confidence = float(probs[predicted_idx]) * 100

    return {
        "label": label,
        "confidence": round(confidence, 2),
        "deepfake_probability": round(deepfake_prob, 2),
        "real_probability": round(real_prob, 2),
    }
