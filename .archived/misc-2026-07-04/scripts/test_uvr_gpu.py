"""Test UVR5 GPU separation directly using its separate.py module."""
import sys
sys.path.insert(0, r"D:\UVR")

import torch
print(f"Torch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"CUDA device: {torch.cuda.get_device_name(0)}")
    print(f"CUDA memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")

# Test importing separate module
from separate import cuda_available, mps_available
print(f"\nUVR5 separate.cuda_available: {cuda_available}")
print(f"UVR5 separate.mps_available: {mps_available}")

# Try loading MDX23C model
print("\n--- Testing MDX23C model load ---")
model_path = r"D:\UVR\models\MDX23C-8KFFT-InstVoc_HQ.pth"

import os
if not os.path.exists(model_path):
    print(f"Model not found: {model_path}")
    # List available MDX models
    mdx_models = [f for f in os.listdir(r"D:\UVR\models") if 'MDX' in f.upper()]
    print(f"Available MDX models: {mdx_models}")
    sys.exit(1)

print(f"Model found: {model_path}")
print(f"Model size: {os.path.getsize(model_path) / 1024**2:.1f} MB")

# Try to load the model
try:
    checkpoint = torch.load(model_path, map_location='cpu', weights_only=False)
    print(f"Checkpoint keys: {len(checkpoint)}")
    print(f"First 5 keys: {list(checkpoint.keys())[:5]}")
    print(f"Last 5 keys: {list(checkpoint.keys())[-5:]}")
except Exception as e:
    print(f"Failed to load checkpoint: {e}")

print("\nDone. UVR5 Python environment is ready for GPU separation.")
