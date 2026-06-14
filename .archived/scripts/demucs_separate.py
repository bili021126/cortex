"""用 demucs 模型分离人声，绕过 torchaudio/torchcodec 问题

htdemucs 输出 4 轨: [drums, bass, other, vocals]
只保存 vocals（人声）和伴奏（其余三轨混合）
"""
import sys, os, soundfile as sf, torch, numpy as np
from demucs.pretrained import get_model
from demucs.apply import apply_model


def separate_vocals(input_path, output_dir, shifts=5, overlap=0.5, model_name="htdemucs"):
    print(f"Loading {model_name} model...")
    model = get_model(model_name)
    model.cuda()
    model.eval()

    print(f"Settings: shifts={shifts}, overlap={overlap}")

    print(f"Loading: {input_path}")
    wav, sr = sf.read(input_path, dtype='float32')
    print(f"  Source: {sr}Hz, shape={wav.shape}")

    # 转为 (channels, samples) float32 tensor
    if wav.ndim == 1:
        wav = wav[None, :]  # mono -> (1, samples)
    else:
        wav = wav.T  # (samples, ch) -> (ch, samples)
    wav = torch.from_numpy(wav.copy())

    # Resample to model sample rate if needed (htdemucs = 44100)
    if sr != model.samplerate:
        import julius
        wav = julius.resample_frac(wav, sr, model.samplerate)
        print(f"  Resampled: {sr} -> {model.samplerate}Hz")

    # 保存原始响度参考
    ref = wav.mean(0)
    wav_mean = ref.mean()
    wav_std = ref.std()
    wav = (wav - wav_mean) / wav_std

    n_samples = wav.shape[1]
    n_sec = n_samples / model.samplerate
    print(f"  Duration: {n_sec:.0f}s, channels: {wav.shape[0]}")
    print(f"Separating (GPU, HQ mode)...")

    with torch.no_grad():
        # apply_model returns (batch, stems, channels, samples)
        sources = apply_model(
            model, wav[None].cuda(),
            device='cuda', shifts=shifts, split=True, overlap=overlap, progress=True
        )

    # sources[0] shape: (4, channels, samples) -> [drums, bass, other, vocals]
    sources = sources[0].cpu()

    # 还原响度
    sources = sources * wav_std + wav_mean

    os.makedirs(output_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(input_path))[0]

    # htdemucs 4 轨顺序: drums(0), bass(1), other(2), vocals(3)
    stem_map = {0: "drums", 1: "bass", 2: "other", 3: "vocals"}
    vocal_idx = 3

    # 保存人声
    vocal = sources[vocal_idx].numpy().T  # -> (samples, channels)
    out_path = os.path.join(output_dir, f"{base}_vocals.wav")
    sf.write(out_path, vocal, model.samplerate, subtype='PCM_16')
    print(f"Saved: {out_path}")

    # 保存伴奏 (drums + bass + other)
    stems_list = [sources[i] for i in [0, 1, 2]]
    instrumental = torch.stack(stems_list).sum(0).numpy().T
    out_path = os.path.join(output_dir, f"{base}_instrumental.wav")
    sf.write(out_path, instrumental, model.samplerate, subtype='PCM_16')
    print(f"Saved: {out_path}")

    # 同时保存全部 4 轨用于检查
    for idx, name in stem_map.items():
        out_path = os.path.join(output_dir, f"{base}_{name}.wav")
        sf.write(out_path, sources[idx].numpy().T, model.samplerate, subtype='PCM_16')
        print(f"Saved: {out_path}")

    print("Done!")


if __name__ == "__main__":
    shifts = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    overlap = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
    separate_vocals(sys.argv[1], sys.argv[2], shifts=shifts, overlap=overlap)
