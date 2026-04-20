"""Deepfake image detection module.

Supports two backends, controlled by ``DEEPFAKE_PROVIDER`` in the environment:

  bitmind (default)
    Calls the Bitmind cloud API (https://api.bitmind.ai).
    Requires ``BITMIND_API_KEY`` to be set.
    No local model weights or heavy ML dependencies needed.

  local
    Loads a locally-trained EfficientNet-B0 binary classifier (Deepfake vs Real).
    Uses ``image_model/deepfake_model.pth`` — no outbound network calls.

Class mapping (local model):
    0 → Deepfake
    1 → Real
"""

from __future__ import annotations

import base64
import io
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("clarix.deepfake")


# ── Provider selection ────────────────────────────────────────────────

def _get_settings():
    from config import settings
    return settings


# ── Shared state flags ─────────────────────────────────────────────────

_local_model: Any = None          # torch.nn.Module | None
_local_device: Any = None         # torch.device | None
_local_transform: Any = None      # transforms.Compose | None
_bitmind_ready: bool = False

CLASS_LABELS = {0: "Deepfake", 1: "Real"}
DEFAULT_MODEL_PATH = Path(__file__).resolve().parent.parent / "image_model" / "deepfake_model.pth"


# ══════════════════════════════════════════════════════════════════════
# Bitmind cloud backend
# ══════════════════════════════════════════════════════════════════════

def _init_bitmind() -> None:
    """Validate that the Bitmind API key is configured."""
    global _bitmind_ready
    cfg = _get_settings()
    if not cfg.bitmind_api_key:
        raise ValueError(
            "BITMIND_API_KEY is not set. "
            "Add it to your .env file or deployment environment variables."
        )
    _bitmind_ready = True
    logger.info("Bitmind deepfake backend ready — endpoint: %s", cfg.bitmind_api_url)


def _predict_bitmind(image_bytes: bytes) -> dict:
    """Call the Bitmind API and normalise the response.

    Bitmind accepts either a URL or a base64-encoded image.
    We always send base64 so that local/private images work too.

    Expected successful response shape:
    {
        "isDeepfake": true | false,
        "confidence": 0.92,          # 0-1 float
        ...                          # extra fields ignored
    }
    """
    import httpx

    cfg = _get_settings()

    # Encode image as base64 data-URI
    b64 = base64.b64encode(image_bytes).decode("utf-8")

    headers = {
        "Authorization": f"Bearer {cfg.bitmind_api_key}",
        "Content-Type": "application/json",
    }
    payload = {"image": f"data:image/jpeg;base64,{b64}"}

    try:
        resp = httpx.post(
            cfg.bitmind_api_url,
            headers=headers,
            json=payload,
            timeout=30.0,
        )
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"Bitmind API returned HTTP {exc.response.status_code}: {exc.response.text}"
        ) from exc
    except httpx.RequestError as exc:
        raise RuntimeError(f"Bitmind API request failed: {exc}") from exc

    data = resp.json()

    # ── Normalise response → Clarix DeepfakeResponse shape ──────────
    # Bitmind returns isDeepfake (bool) + confidence (0-1 float)
    is_deepfake: bool = data.get("isDeepfake", False)
    raw_confidence: float = float(data.get("confidence", 0.5))

    label = "Deepfake" if is_deepfake else "Real"
    confidence_pct = round(raw_confidence * 100, 2)

    if is_deepfake:
        deepfake_prob = confidence_pct
        real_prob = round(100.0 - confidence_pct, 2)
    else:
        real_prob = confidence_pct
        deepfake_prob = round(100.0 - confidence_pct, 2)

    return {
        "label": label,
        "confidence": confidence_pct,
        "deepfake_probability": deepfake_prob,
        "real_probability": real_prob,
    }


# ══════════════════════════════════════════════════════════════════════
# Local EfficientNet-B0 backend (original implementation)
# ══════════════════════════════════════════════════════════════════════

def _build_transform():
    """ImageNet-standard preprocessing for EfficientNet-B0 (224×224)."""
    from torchvision import transforms
    return transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(
            mean=[0.485, 0.456, 0.406],
            std=[0.229, 0.224, 0.225],
        ),
    ])


def _init_local(model_path: str | Path | None = None) -> None:
    """Load the local EfficientNet-B0 model from disk."""
    global _local_model, _local_device, _local_transform

    import torch
    from torchvision import models

    path = Path(model_path) if model_path else DEFAULT_MODEL_PATH
    if not path.exists():
        raise FileNotFoundError(f"Local deepfake model not found at {path}")

    _local_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info("Local deepfake detector device: %s", _local_device)

    _local_model = models.efficientnet_b0(weights=None)
    in_features = _local_model.classifier[1].in_features
    _local_model.classifier[1] = torch.nn.Sequential(
        torch.nn.Linear(in_features, 256),
        torch.nn.Dropout(0.3),
        torch.nn.ReLU(),
        torch.nn.Linear(256, 2),
    )

    state_dict = torch.load(path, map_location=_local_device, weights_only=True)
    _local_model.load_state_dict(state_dict)
    _local_model.eval()
    _local_model.to(_local_device)

    _local_transform = _build_transform()
    logger.info("Local deepfake model loaded from %s", path)


def _predict_local(image_bytes: bytes) -> dict:
    """Run inference with the local EfficientNet-B0 model."""
    import torch
    import torch.nn.functional as F
    from PIL import Image

    if _local_model is None or _local_transform is None or _local_device is None:
        raise RuntimeError("Local deepfake model not loaded — call load_model() first")

    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as exc:
        raise ValueError(f"Could not decode image: {exc}") from exc

    tensor = _local_transform(image).unsqueeze(0).to(_local_device)

    with torch.no_grad():
        logits = _local_model(tensor)
        probs = F.softmax(logits, dim=1).squeeze()

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


# ══════════════════════════════════════════════════════════════════════
# Public API (unchanged signature — drop-in replacement)
# ══════════════════════════════════════════════════════════════════════

def load_model(model_path: str | Path | None = None) -> None:
    """Initialise whichever backend is configured.

    Called once during FastAPI lifespan startup.
    Controlled by the ``DEEPFAKE_PROVIDER`` environment variable:
      - ``bitmind`` (default) — validates API key; no file I/O.
      - ``local``             — loads EfficientNet-B0 weights from disk.
    """
    cfg = _get_settings()
    provider = cfg.deepfake_provider.lower()
    logger.info("Deepfake provider: %s", provider)

    if provider == "bitmind":
        _init_bitmind()
    elif provider == "local":
        _init_local(model_path)
    else:
        raise ValueError(
            f"Unknown DEEPFAKE_PROVIDER '{provider}'. "
            "Valid options: 'bitmind', 'local'."
        )


def is_loaded() -> bool:
    """Return True if the configured backend is ready for inference."""
    cfg = _get_settings()
    if cfg.deepfake_provider.lower() == "bitmind":
        return _bitmind_ready
    return _local_model is not None


def predict_deepfake(image_bytes: bytes) -> dict:
    """Run deepfake detection on raw image bytes.

    Dispatches to the configured backend (Bitmind API or local model).

    Returns a dict with:
        label                – \"Deepfake\" or \"Real\"
        confidence           – confidence % of the predicted label
        deepfake_probability – probability % the image is a deepfake
        real_probability     – probability % the image is real

    Raises:
        RuntimeError: backend not ready or API call failed.
        ValueError:   image cannot be decoded.
    """
    cfg = _get_settings()
    provider = cfg.deepfake_provider.lower()

    if provider == "bitmind":
        if not _bitmind_ready:
            raise RuntimeError("Bitmind backend not initialised — call load_model() first")
        return _predict_bitmind(image_bytes)

    if provider == "local":
        return _predict_local(image_bytes)

    raise RuntimeError(f"Unknown deepfake provider: '{provider}'")
