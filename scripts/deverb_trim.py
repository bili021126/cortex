"""
VR De-Echo GPU inference + VAD silence trimming.
Loads UVR-De-Echo-Aggressive model using UVR5's v5.1 CascadedNet architecture.
Usage: python deverb_trim.py <vocals.wav> [output_dir]
"""
import sys
import os
import time
import json
import math
import numpy as np
import soundfile as sf
import torch
import torch.nn as nn
import torch.nn.functional as F

# ── Setup UVR5 import path ──
UVR_DIR = r"D:\UVR"
sys.path.insert(0, UVR_DIR)
from lib_v5.vr_network import nets_new, layers_new
from lib_v5 import spec_utils

# ── Config ──
MODEL_PATH = r"D:\models\uvr_models_backup\VR_Models\UVR-De-Echo-Aggressive.pth"
MODEL_PARAMS_PATH = os.path.join(UVR_DIR, "lib_v5", "vr_network", "modelparams", "1band_sr44100_hl1024.json")

# VAD config
VAD_THRESHOLD_DB = -32
VAD_MIN_SILENCE_S = 0.3
VAD_MIN_SPEECH_S = 0.5
VAD_PAD_S = 0.15


def load_model(device):
    """Load VR De-Echo CascadedNet model."""
    # Load model parameters
    with open(MODEL_PARAMS_PATH) as f:
        mp = json.load(f)

    n_fft = mp['band']['1']['n_fft']
    bins = mp['bins']

    # Determine architecture size from model file size
    model_size_kb = math.ceil(os.path.getsize(MODEL_PATH) / 1024)
    nn_arch_sizes = [31191, 33966, 56817, 123821, 123812, 129605, 218409, 537238, 537227]
    nn_arch_size = min(nn_arch_sizes, key=lambda x: abs(x - model_size_kb))
    print(f"  Model size: {model_size_kb} KB, arch: {nn_arch_size}")

    # Build model (v5.1 CascadedNet) with checkpoint-compatible params
    nout = 48
    nout_lstm = 128
    # nin_lstm = 336 from checkpoint LSTM shapes
    # nin_lstm = max_bin // 2, so max_bin = 672, n_fft = 1344
    n_fft_from_ckpt = 672 * 2  # 1344

    model = nets_new.CascadedNet(
        n_fft=n_fft_from_ckpt,
        nn_arch_size=nn_arch_size,
        nout=nout,
        nout_lstm=nout_lstm
    )

    # Load checkpoint
    ckpt = torch.load(MODEL_PATH, map_location='cpu')

    # Log key count and clean state dict
    print(f"  Checkpoint: {len(ckpt)} keys")

    model.load_state_dict(ckpt, strict=True)
    model.to(device)
    model.eval()

    print(f"  Model loaded on {device}")
    return model, mp, n_fft_from_ckpt


def stft_complex(audio, n_fft, hop_length):
    """Compute STFT, return real+imaginary as 2-channel tensor [1, 2, F, T]."""
    window = torch.hann_window(n_fft, device=audio.device)

    if audio.dim() == 1:
        audio = audio.unsqueeze(0)

    # STFT per channel and average
    specs = []
    for c in range(audio.shape[0]):
        X = torch.stft(
            audio[c], n_fft=n_fft, hop_length=hop_length,
            window=window, return_complex=True, center=True
        )
        specs.append(X)

    X = torch.stack(specs, dim=0)
    X = torch.mean(X, dim=0)  # [F, T]

    # Stack real and imaginary as 2 channels
    real = X.real.unsqueeze(0).unsqueeze(0)  # [1, 1, F, T]
    imag = X.imag.unsqueeze(0).unsqueeze(0)
    spec = torch.cat([real, imag], dim=1)  # [1, 2, F, T]

    return spec, X  # Return 2ch spec and complex spectrum


def istft_from_mask(masked_spec, n_fft, hop_length, length=None):
    """Inverse STFT from complex spectrum."""
    window = torch.hann_window(n_fft, device=masked_spec.device)

    if masked_spec.dim() == 4:
        masked_spec = masked_spec.squeeze(0).squeeze(0)  # [F, T]

    audio = torch.istft(
        masked_spec, n_fft=n_fft, hop_length=hop_length,
        window=window, center=True, length=length
    )
    return audio


def deverb(model, audio_np, sr, n_fft, hop_length, device):
    """Apply VR De-Echo model to audio."""
    max_bin = n_fft // 2

    # Convert to tensor
    audio = torch.tensor(audio_np.T.copy() if audio_np.ndim == 2 else audio_np.copy(),
                         dtype=torch.float32, device=device)
    if audio.dim() == 1:
        audio = audio.unsqueeze(0)

    # STFT (2-channel: real + imaginary)
    spec, complex_spec = stft_complex(audio, n_fft, hop_length)
    # spec: [1, 2, F, T], complex_spec: [F, T] (complex)

    # Crop to max_bin
    spec = spec[:, :, :max_bin, :]

    # Run model to get mask
    with torch.no_grad():
        mask = model(spec)  # [1, 2, F, T] or [1, 1, F, T]

    # Extract dry mask (first channel is usually the processed output)
    if mask.shape[1] >= 2:
        dry_mask = mask[:, 0:1, :, :]
    else:
        dry_mask = mask

    # Pad mask to full frequency bins
    full_bins = complex_spec.shape[0]
    pad_bottom = full_bins - dry_mask.shape[2]
    dry_mask = F.pad(dry_mask, (0, 0, 0, pad_bottom), mode='replicate')

    # Apply mask to complex spectrum: dry = original * mask
    dry_mask = dry_mask.squeeze(0).squeeze(0)  # [F, T]
    dry_spec = complex_spec * dry_mask

    # Inverse STFT
    audio_len = audio.shape[-1]
    dry = istft_from_mask(dry_spec, n_fft, hop_length, length=audio_len)

    return dry.cpu().numpy()


def find_speech_segments(audio, sr):
    """Find speech segments using RMS energy."""
    if audio.ndim == 2:
        mono = np.mean(audio, axis=1)
    else:
        mono = audio

    frame_ms = 20
    frame_len = int(sr * frame_ms / 1000)
    hop = frame_len // 2

    # Compute per-frame RMS in dB
    n_frames = (len(mono) - frame_len) // hop + 1
    rms_db = np.zeros(n_frames)
    for i in range(n_frames):
        start = i * hop
        frame = mono[start:start + frame_len]
        rms = np.sqrt(np.mean(frame ** 2))
        rms_db[i] = 20 * np.log10(rms + 1e-10)

    is_speech = rms_db > VAD_THRESHOLD_DB

    # Find segments
    min_speech_frames = int(VAD_MIN_SPEECH_S * sr / hop)
    min_silence_frames = int(VAD_MIN_SILENCE_S * sr / hop)
    pad_frames = int(VAD_PAD_S * sr / hop)

    segments = []
    in_speech = False
    speech_start = 0
    silence_count = 0

    for i, s in enumerate(is_speech):
        if s:
            silence_count = 0
            if not in_speech:
                speech_start = i
                in_speech = True
        else:
            if in_speech:
                silence_count += 1
                if silence_count >= min_silence_frames:
                    speech_end = i - silence_count + 1
                    seg_frames = speech_end - speech_start
                    if seg_frames >= min_speech_frames:
                        start_frame = max(0, speech_start - pad_frames)
                        end_frame = min(n_frames, speech_end + pad_frames)
                        segments.append((start_frame * hop, end_frame * hop + frame_len))
                    in_speech = False

    # Last segment
    if in_speech:
        seg_frames = n_frames - speech_start
        if seg_frames >= min_speech_frames:
            start_frame = max(0, speech_start - pad_frames)
            segments.append((start_frame * hop, len(mono)))

    return segments


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    input_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(input_path)
    os.makedirs(output_dir, exist_ok=True)

    device = torch.device('cuda')
    print(f"Device: {device} | Torch: {torch.__version__}, CUDA: {torch.cuda.is_available()}")

    # Load VR De-Echo model
    print("\n[1/3] Loading VR De-Echo model...")
    t0 = time.time()
    model, mp, n_fft_model = load_model(device)
    print(f"  Loaded in {time.time() - t0:.1f}s")

    # Use model's n_fft and mp's hop_length
    hop_length = mp['band']['1']['hl']
    print(f"  n_fft={n_fft_model}, hop={hop_length}")

    # Load audio
    print(f"\n[2/3] Loading audio: {os.path.basename(input_path)}")
    audio, sr = sf.read(input_path)
    if sr != 44100:
        print(f"  Resampling {sr} -> 44100")
        import librosa
        audio = librosa.resample(audio.T, orig_sr=sr, target_sr=44100).T
        sr = 44100

    # Convert to mono for VR processing
    if audio.ndim == 2 and audio.shape[1] > 1:
        mono = np.mean(audio, axis=1)
    else:
        mono = audio if audio.ndim == 1 else audio[:, 0]

    print(f"  {len(mono)/sr:.1f}s, {sr} Hz")

    # De-reverb
    print("\n[2/3] De-reverb (VR De-Echo Aggressive)...")
    t0 = time.time()

    # Process in chunks to avoid OOM
    chunk_seconds = 60
    chunk_samples = chunk_seconds * sr
    dry_parts = []

    for start in range(0, len(mono), chunk_samples):
        end = min(start + chunk_samples, len(mono))
        chunk = mono[start:end]
        dry_chunk = deverb(model, chunk, sr, n_fft_model, hop_length, device)
        dry_parts.append(dry_chunk)

        pct = min(100, (end / len(mono)) * 100)
        print(f"  Progress: {pct:.0f}%")

    dry_mono = np.concatenate(dry_parts)
    elapsed = time.time() - t0
    realtime = len(mono) / sr / elapsed
    print(f"  Done in {elapsed:.1f}s ({realtime:.1f}x realtime)")

    # Reconstruct stereo
    if audio.ndim == 2 and audio.shape[1] > 1:
        dry = np.column_stack([dry_mono, dry_mono])
    else:
        dry = dry_mono

    # VAD trimming
    print(f"\n[3/3] VAD trimming (threshold={VAD_THRESHOLD_DB} dB)...")
    segments = find_speech_segments(dry, sr)
    print(f"  Found {len(segments)} speech segments")

    base = os.path.splitext(os.path.basename(input_path))[0]

    if len(segments) == 0:
        print("  No speech detected, saving full audio")
        out_path = os.path.join(output_dir, f"{base}_dry.wav")
        sf.write(out_path, dry.T if dry.ndim == 2 else dry, sr)
        print(f"  Saved: {out_path}")
    else:
        # Save individual segments
        for i, (seg_start, seg_end) in enumerate(segments):
            seg_start = max(0, seg_start)
            seg_end = min(len(dry), seg_end)
            seg = dry[seg_start:seg_end] if dry.ndim == 1 else dry[seg_start:seg_end, :]
            dur = len(seg) / sr
            out_path = os.path.join(output_dir, f"{base}_{i+1:03d}.wav")
            sf.write(out_path, seg.T if seg.ndim == 2 else seg, sr)
            print(f"  [{i+1}/{len(segments)}] {dur:.1f}s -> {out_path}")

        # Also save the full dry audio
        full_path = os.path.join(output_dir, f"{base}_dry.wav")
        sf.write(full_path, dry.T if dry.ndim == 2 else dry, sr)
        print(f"  Full dry: {full_path}")

    # Cleanup
    del model
    torch.cuda.empty_cache()
    print("\nAll done!")


if __name__ == "__main__":
    main()
