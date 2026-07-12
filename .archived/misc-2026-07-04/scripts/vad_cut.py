"""
VAD-based audio segmentation: cut de-echoed vocals into speech-only segments.
Uses GPU-accelerated RMS energy detection.
Usage: python vad_cut.py <input.wav> [output_dir]
"""
import sys
import os
import numpy as np
import soundfile as sf
import torch


def vad_cut(audio_np, sr, threshold_db=-30, min_speech_ms=500, min_silence_ms=300, pad_ms=100):
    """
    Cut audio into speech segments based on RMS energy.

    Args:
        audio_np: [samples] or [samples, channels]
        sr: sample rate
        threshold_db: RMS below this (relative to global RMS) is silence
        min_speech_ms: minimum speech segment length
        min_silence_ms: minimum silence between segments
        pad_ms: padding before/after each segment

    Returns:
        List of (start_sample, end_sample, segment_numpy)
    """
    device = torch.device('cuda')

    # Convert to mono tensor [T]
    if audio_np.ndim == 2:
        sig_np = audio_np.mean(axis=1)
    else:
        sig_np = audio_np
    sig = torch.from_numpy(sig_np.astype(np.float32)).to(device)

    # Compute RMS in short windows
    hop_ms = 10  # 10ms hop
    hop_samples = int(sr * hop_ms / 1000)
    frame_samples = int(sr * 25 / 1000)  # 25ms frame

    # Pad for convolution
    pad = frame_samples // 2
    sig_sq = sig ** 2
    rms = torch.sqrt(
        torch.nn.functional.avg_pool1d(
            sig_sq.unsqueeze(0).unsqueeze(0),
            kernel_size=frame_samples, stride=hop_samples,
            padding=pad
        ).squeeze()
    )

    # Global RMS threshold
    global_rms = torch.sqrt(torch.mean(sig_sq))
    threshold = global_rms * (10 ** (threshold_db / 20))

    # Speech detection
    is_speech = rms > threshold
    is_speech_np = is_speech.cpu().numpy()

    # Morphological: merge close speech segments
    min_speech_frames = max(1, int(min_speech_ms / hop_ms))
    min_silence_frames = max(1, int(min_silence_ms / hop_ms))
    pad_frames = max(1, int(pad_ms / hop_ms))

    # Find speech regions
    segments = []
    in_speech = False
    speech_start = 0
    silence_count = 0
    speech_count = 0

    for i, s in enumerate(is_speech_np):
        if s:
            if not in_speech:
                speech_start = i
                in_speech = True
                speech_count = 1
            else:
                speech_count += 1
            silence_count = 0
        else:
            if in_speech:
                silence_count += 1
                if silence_count >= min_silence_frames:
                    if speech_count >= min_speech_frames:
                        # Record segment
                        start_frame = max(0, speech_start - pad_frames)
                        end_frame = min(len(is_speech_np), i)
                        segments.append((start_frame, end_frame))
                    in_speech = False

    # Handle trailing speech
    if in_speech and speech_count >= min_speech_frames:
        start_frame = max(0, speech_start - pad_frames)
        end_frame = len(is_speech_np)
        segments.append((start_frame, end_frame))

    # Convert frame indices to sample indices and merge overlapping segments
    raw_result = []
    for sf_idx, ef_idx in segments:
        start_sample = sf_idx * hop_samples
        end_sample = min(len(sig_np), ef_idx * hop_samples)
        if end_sample - start_sample >= sr * min_speech_ms / 1000:
            seg = sig_np[start_sample:end_sample] if audio_np.ndim == 1 else audio_np[start_sample:end_sample]
            raw_result.append((start_sample, end_sample, seg))

    # Merge overlapping/touching segments
    if not raw_result:
        return []
    result = [raw_result[0]]
    for seg in raw_result[1:]:
        prev = result[-1]
        if seg[0] <= prev[1]:  # Overlap or touch
            merged_start = prev[0]
            merged_end = max(prev[1], seg[1])
            merged_audio = sig_np[merged_start:merged_end] if audio_np.ndim == 1 else audio_np[merged_start:merged_end]
            result[-1] = (merged_start, merged_end, merged_audio)
        else:
            result.append(seg)

    return result


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    input_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(input_path)
    os.makedirs(output_dir, exist_ok=True)

    print(f"Loading: {os.path.basename(input_path)}")
    audio, sr = sf.read(input_path)
    print(f"  {sr} Hz, {len(audio)/sr:.1f}s, {'stereo' if audio.ndim == 2 else 'mono'}")

    # VAD
    segments = vad_cut(audio, sr, threshold_db=-30)
    print(f"\nFound {len(segments)} speech segments:")

    base = os.path.splitext(os.path.basename(input_path))[0]
    total_speech = 0

    for i, (start_s, end_s, seg) in enumerate(segments, 1):
        dur = len(seg) / sr
        total_speech += dur
        out_path = os.path.join(output_dir, f"{base}_{i:03d}.wav")
        sf.write(out_path, seg, sr)
        print(f"  [{i:03d}] {start_s/sr:.1f}s - {end_s/sr:.1f}s ({dur:.1f}s) -> {os.path.basename(out_path)}")

    original_dur = len(audio) / sr
    print(f"\nTotal: {total_speech:.1f}s / {original_dur:.1f}s ({total_speech/original_dur*100:.1f}%)")
    print(f"Saved {len(segments)} segments to {output_dir}")


if __name__ == "__main__":
    main()
