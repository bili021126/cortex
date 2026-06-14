"""UVR5 人声分离——使用本地 CUDA 环境加载 UVR5 模型

用法: python uvr_separate.py <input.wav> <output_dir>
第一轮: htdemucs 拆人声 → 第二轮: VR De-Echo-Aggressive 去混响
"""
import sys, os, time
import soundfile as sf
import numpy as np
import torch
import onnxruntime as ort
from demucs.pretrained import get_model
from demucs.apply import apply_model

UVR_MODELS = r"C:\Users\origin\AppData\Local\Programs\Ultimate Vocal Remover\models"


def separate_htdemucs(input_path, output_dir):
    """第一轮: htdemucs 拆人声 (CUDA)"""
    print(f"[1/4] Loading htdemucs (CUDA)...")
    model = get_model("htdemucs")
    model.cuda()
    model.eval()

    print(f"[2/4] Reading: {input_path}")
    wav, sr = sf.read(input_path, dtype="float32")
    print(f"      {sr}Hz, {wav.shape}, {wav.shape[0]/sr:.0f}s")

    if wav.ndim == 1:
        wav = wav[None, :]
    else:
        wav = wav.T.copy()
    wav = torch.from_numpy(wav)

    if sr != model.samplerate:
        import julius
        wav = julius.resample_frac(wav, sr, model.samplerate)

    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std()
    wav = (wav - mean) / std

    print(f"[3/4] Separating (htdemucs, 5 shifts)...")
    t0 = time.time()
    with torch.no_grad():
        sources = apply_model(
            model, wav[None].cuda(),
            device="cuda", shifts=5, split=True,
            overlap=0.5, progress=True,
        )
    vocal = sources[0, 3].cpu()  # htdemucs: [drums,bass,other,vocals]
    vocal = vocal * std + mean
    vocal = vocal.numpy().T
    elapsed = time.time() - t0
    print(f"      Done in {elapsed:.1f}s ({wav.shape[1]/model.samplerate/elapsed:.1f}x realtime)")

    os.makedirs(output_dir, exist_ok=True)
    return vocal, model.samplerate


def load_vr_model(model_path):
    """加载 UVR5 VR 模型 (ONNX 格式，如果可用)"""
    print(f"[VR] Loading model: {model_path}")

    # VR 模型可能以 .pth 存 ONNX
    try:
        sess = ort.InferenceSession(
            model_path,
            providers=['CUDAExecutionProvider', 'CPUExecutionProvider']
        )
        print(f"      Loaded as ONNX, inputs: {[i.name for i in sess.get_inputs()]}")
        return sess
    except Exception as e:
        # 可能是 PyTorch 格式，尝试加载
        print(f"      Not ONNX, trying PyTorch... ({e})")
        try:
            state = torch.load(model_path, map_location='cpu')
            print(f"      PyTorch dict keys: {list(state.keys())[:5]}")
            return state
        except Exception as e2:
            print(f"      Failed: {e2}")
            return None


def test_gpu():
    """诊断 GPU 状态"""
    print("=" * 50)
    print("GPU 诊断:")
    print(f"  PyTorch CUDA: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"  GPU: {torch.cuda.get_device_name(0)}")
        print(f"  VRAM: {torch.cuda.get_device_properties(0).total_memory/1e9:.1f} GB")
        # 跑个小 tensor 测试 GPU 是否正常工作
        x = torch.randn(1000, 1000).cuda()
        y = x @ x.T
        torch.cuda.synchronize()
        print(f"  Tensor test: OK ({y.mean().item():.3f})")

    providers = ort.get_available_providers()
    print(f"  ONNX providers: {providers}")
    if 'CUDAExecutionProvider' in providers:
        print(f"  ONNX CUDA: OK")
    print("=" * 50)


if __name__ == "__main__":
    test_gpu()

    if len(sys.argv) < 2:
        print("\n用法: python uvr_separate.py <input.wav> [output_dir]")
        print("       python uvr_separate.py --test  (仅诊断)")
        sys.exit(0)

    if sys.argv[1] == "--test":
        sys.exit(0)

    input_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(input_path), "uvr_vocals"
    )

    # 第一轮: htdemucs 拆人声
    vocal, sr = separate_htdemucs(input_path, output_dir)

    base = os.path.splitext(os.path.basename(input_path))[0]
    vocal_path = os.path.join(output_dir, f"{base}_vocals.wav")
    print(f"[4/4] Writing vocals: {vocal_path}")
    sf.write(vocal_path, vocal, sr, subtype="PCM_16")
    print(f"      Size: {os.path.getsize(vocal_path)/1e6:.1f} MB")

    # 第二轮: 尝试加载 VR 模型
    vr_path = os.path.join(UVR_MODELS, "VR_Models", "UVR-De-Echo-Aggressive.pth")
    if not os.path.exists(vr_path):
        vr_path = os.path.join(UVR_MODELS, "UVR-De-Echo-Aggressive.pth")

    if os.path.exists(vr_path):
        print(f"\n[VR] Found VR model, loading...")
        vr = load_vr_model(vr_path)
        if isinstance(vr, ort.InferenceSession):
            print("      VR model ready (ONNX/CUDA)")
        else:
            print("      VR model loaded as PyTorch (inference not yet implemented)")
    else:
        print(f"\n[VR] Model not found at {vr_path}")
        print("      Skipping VR de-echo step.")

    print("\nDone! First pass vocals saved to:", vocal_path)
