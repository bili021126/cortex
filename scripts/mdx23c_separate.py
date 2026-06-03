"""
MDX23C-8KFFT-InstVoc HQ GPU separation using UVR5's official TFC-TDF v3 architecture.
Bypasses all UVR5 GUI/dependency issues by running directly.
Usage: python mdx23c_separate.py <input.wav> [output_dir]
"""
import sys
import os
import time
import yaml
import numpy as np
import soundfile as sf
import torch
import torch.nn as nn

# ── Add UVR5 lib_v5 to path for tfc_tdf_v3 ──
UVR_DIR = r"D:\UVR"
sys.path.insert(0, UVR_DIR)
from lib_v5.tfc_tdf_v3 import TFC_TDF_net, STFT


def load_config():
    """Load MDX23C model config from YAML."""
    config_path = os.path.join(
        UVR_DIR, "models", "MDX_Net_Models", "model_data",
        "mdx_c_configs", "model_2_stem_full_band_8k.yaml"
    )
    with open(config_path) as f:
        config = yaml.safe_load(f)
    # Wrap in ConfigDict-like object for compatibility
    class ConfigDict(dict):
        __getattr__ = dict.__getitem__
        __setattr__ = dict.__setitem__
    return _dict_to_config(config)


def _dict_to_config(d):
    """Recursively convert dict to ConfigDict."""
    class ConfigDict(dict):
        __getattr__ = dict.__getitem__
        __setattr__ = dict.__setitem__
    if isinstance(d, dict):
        cd = ConfigDict()
        for k, v in d.items():
            cd[k] = _dict_to_config(v)
        return cd
    return d


def separate(model, mix_np, device, config):
    """
    Run MDX23C GPU separation on a numpy audio array.
    Returns dict of stem_name -> numpy array.
    """
    audio = config.audio
    inference = config.inference
    n_fft = audio.n_fft
    hop_length = audio.hop_length
    dim_t = inference.dim_t
    num_overlap = inference.num_overlap

    # Convert to tensor [C, T] (sf.read returns [samples, channels])
    if mix_np.ndim == 1:
        mix_np = np.stack([mix_np, mix_np], axis=0)  # [2, T]
    elif mix_np.shape[1] <= 2:
        mix_np = mix_np.T  # [samples, ch] -> [ch, samples]
    if mix_np.shape[0] == 1:
        mix_np = np.repeat(mix_np, 2, axis=0)

    mix = torch.tensor(np.ascontiguousarray(mix_np), dtype=torch.float32, device=device)
    C, T = mix.shape

    # Chunk size in samples
    chunk_size_samples = hop_length * (dim_t - 1)

    # Calculate overlap steps
    overlap_samples = chunk_size_samples // num_overlap
    total_chunks = (T + overlap_samples - 1) // overlap_samples

    S = model.num_target_instruments  # 2 for MDX23C (Vocals + Instrumental)
    estimated = torch.zeros(S, C, T, device=device)
    count = torch.zeros(T, device=device)

    print(f"  Audio: {T/audio.sample_rate:.1f}s, {total_chunks} chunks (overlap={num_overlap})")

    with torch.no_grad():
        for i in range(total_chunks):
            start = i * overlap_samples
            end = min(start + chunk_size_samples, T)

            chunk = mix[:, start:end]

            # Pad short chunk
            if chunk.shape[1] < chunk_size_samples:
                pad_size = chunk_size_samples - chunk.shape[1]
                chunk = nn.functional.pad(chunk, (0, pad_size))

            chunk = chunk.unsqueeze(0)  # [1, C, T_chunk]

            # Forward pass
            output = model(chunk)  # [1, S, C, T_out]

            # Handle output length mismatch (STFT may produce slightly different length)
            out_len = output.shape[-1]
            if out_len > end - start:
                output = output[..., :end - start]
            elif out_len < end - start:
                pad = end - start - out_len
                output = nn.functional.pad(output, (0, pad))

            # Hanning window for overlap-add
            window = torch.hann_window(end - start, device=device)
            for s in range(S):
                estimated[s, :, start:end] += output[0, s] * window
            count[start:end] += window

            if (i + 1) % max(1, total_chunks // 10) == 0:
                pct = (i + 1) / total_chunks * 100
                print(f"  Progress: {pct:.0f}%")

    # Normalize by overlap count
    count = count.clamp(min=1e-10)
    for s in range(S):
        estimated[s] /= count

    # Convert to numpy
    stems = {}
    instruments = config.training.instruments
    for s, name in enumerate(instruments):
        stems[name] = estimated[s].cpu().numpy()

    return stems


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    input_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(input_path)
    os.makedirs(output_dir, exist_ok=True)

    device = torch.device('cuda')
    print(f"Device: {device}")
    print(f"Torch: {torch.__version__}, CUDA: {torch.cuda.is_available()}")

    # Load config
    config = load_config()
    print(f"Config: {config.model.num_scales} scales, {config.model.num_channels} ch, {config.model.num_subbands} subbands")
    print(f"FFT: {config.audio.n_fft}, Hop: {config.audio.hop_length}, DimF: {config.audio.dim_f}")

    # Build model
    print("Building TFC-TDF v3 model...")
    model = TFC_TDF_net(config, device=device)
    model.to(device)

    # Load checkpoint
    ckpt_path = r"D:\models\uvr_models_backup\MDX_Net_Models\MDX23C-8KFFT-InstVoc_HQ.ckpt"
    print(f"Loading checkpoint: {os.path.basename(ckpt_path)} ({os.path.getsize(ckpt_path)/1024**2:.0f} MB)")
    ckpt = torch.load(ckpt_path, map_location='cpu')
    model.load_state_dict(ckpt)
    model.eval()

    # Load audio
    info = sf.info(input_path)
    print(f"\nInput: {os.path.basename(input_path)} ({info.samplerate} Hz, {info.duration:.1f}s, {info.channels}ch)")
    audio, sr = sf.read(input_path)
    if sr != 44100:
        print(f"Warning: resampling from {sr} to 44100")
        import librosa
        audio = librosa.resample(audio.T, orig_sr=sr, target_sr=44100).T
        sr = 44100

    # Separate
    print("\nSeparating...")
    t0 = time.time()
    stems = separate(model, audio, device, config)
    elapsed = time.time() - t0
    realtime = info.duration / elapsed
    print(f"Done in {elapsed:.1f}s ({realtime:.1f}x realtime)")

    # Save outputs
    base = os.path.splitext(os.path.basename(input_path))[0]
    for name, stem_audio in stems.items():
        out_path = os.path.join(output_dir, f"{base}_{name}.wav")
        sf.write(out_path, stem_audio.T, 44100)
        print(f"  Saved: {out_path}")

    # Memory clean
    del model, stems
    torch.cuda.empty_cache()
    print(f"\nGPU mem freed. All done!")


if __name__ == "__main__":
    main()
