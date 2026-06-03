"""
VR De-Echo GPU denoising using UVR5's official CascadedNet v5.1 architecture.
Usage: python deverb_separate.py <input.wav> [output_dir]
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


# ════════════════════════════════════════════════════════════════
#  UVR5 VR Network Layers (from layers_new.py, self-contained)
# ════════════════════════════════════════════════════════════════

class Conv2DBNActiv(nn.Module):
    def __init__(self, nin, nout, ksize=3, stride=1, pad=1, dilation=1, activ=nn.ReLU):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(nin, nout, ksize, stride, pad, dilation=dilation, bias=False),
            nn.BatchNorm2d(nout),
            activ()
        )

    def forward(self, x):
        return self.conv(x)


class Encoder(nn.Module):
    def __init__(self, nin, nout, ksize=3, stride=1, pad=1, activ=nn.LeakyReLU):
        super().__init__()
        self.conv1 = Conv2DBNActiv(nin, nout, ksize, stride, pad, activ=activ)
        self.conv2 = Conv2DBNActiv(nout, nout, ksize, 1, pad, activ=activ)

    def forward(self, x):
        return self.conv2(self.conv1(x))


class Decoder(nn.Module):
    def __init__(self, nin, nout, ksize=3, stride=1, pad=1, activ=nn.ReLU, dropout=False):
        super().__init__()
        self.conv1 = Conv2DBNActiv(nin, nout, ksize, 1, pad, activ=activ)
        self.dropout = nn.Dropout2d(0.1) if dropout else None

    def forward(self, x, skip=None):
        x = F.interpolate(x, scale_factor=2, mode='bilinear', align_corners=True)
        if skip is not None:
            skip = _crop_center(skip, x)
            x = torch.cat([x, skip], dim=1)
        h = self.conv1(x)
        if self.dropout is not None:
            h = self.dropout(h)
        return h


def _crop_center(img, target):
    _, _, h, w = img.size()
    _, _, th, tw = target.size()
    dh = (h - th) // 2
    dw = (w - tw) // 2
    return img[:, :, dh:dh+th, dw:dw+tw]


class ASPPModule(nn.Module):
    def __init__(self, nin, nout, dilations=(4, 8, 12), activ=nn.ReLU, dropout=False):
        super().__init__()
        self.conv1 = nn.Sequential(
            nn.AdaptiveAvgPool2d((1, None)),
            Conv2DBNActiv(nin, nout, 1, 1, 0, activ=activ)
        )
        self.conv2 = Conv2DBNActiv(nin, nout, 1, 1, 0, activ=activ)
        self.conv3 = Conv2DBNActiv(nin, nout, 3, 1, dilations[0], dilations[0], activ=activ)
        self.conv4 = Conv2DBNActiv(nin, nout, 3, 1, dilations[1], dilations[1], activ=activ)
        self.conv5 = Conv2DBNActiv(nin, nout, 3, 1, dilations[2], dilations[2], activ=activ)
        self.bottleneck = Conv2DBNActiv(nout * 5, nout, 1, 1, 0, activ=activ)
        self.dropout = nn.Dropout2d(0.1) if dropout else None

    def forward(self, x):
        _, _, h, w = x.size()
        feat1 = F.interpolate(self.conv1(x), size=(h, w), mode='bilinear', align_corners=True)
        feat2 = self.conv2(x)
        feat3 = self.conv3(x)
        feat4 = self.conv4(x)
        feat5 = self.conv5(x)
        out = torch.cat((feat1, feat2, feat3, feat4, feat5), dim=1)
        out = self.bottleneck(out)
        if self.dropout is not None:
            out = self.dropout(out)
        return out


class LSTMModule(nn.Module):
    def __init__(self, nin_conv, nin_lstm, nout_lstm):
        super().__init__()
        self.conv = Conv2DBNActiv(nin_conv, 1, 1, 1, 0)
        self.lstm = nn.LSTM(
            input_size=nin_lstm,
            hidden_size=nout_lstm // 2,
            bidirectional=True
        )
        self.dense = nn.Sequential(
            nn.Linear(nout_lstm, nin_lstm),
            nn.BatchNorm1d(nin_lstm),
            nn.ReLU()
        )

    def forward(self, x):
        N, _, nbins, nframes = x.size()
        h = self.conv(x)[:, 0]  # N, nbins, nframes
        h = h.permute(2, 0, 1)  # nframes, N, nbins
        h, _ = self.lstm(h)
        h = self.dense(h.reshape(-1, h.size()[-1]))  # nframes * N, nbins
        h = h.reshape(nframes, N, 1, nbins)
        h = h.permute(1, 2, 3, 0)
        return h


# ════════════════════════════════════════════════════════════════
#  UVR5 VR Network Models (from nets_new.py)
# ════════════════════════════════════════════════════════════════

class BaseNet(nn.Module):
    def __init__(self, nin, nout, nin_lstm, nout_lstm, dilations=((4, 2), (8, 4), (12, 6))):
        super().__init__()
        self.enc1 = Conv2DBNActiv(nin, nout, 3, 1, 1)
        self.enc2 = Encoder(nout, nout * 2, 3, 2, 1)
        self.enc3 = Encoder(nout * 2, nout * 4, 3, 2, 1)
        self.enc4 = Encoder(nout * 4, nout * 6, 3, 2, 1)
        self.enc5 = Encoder(nout * 6, nout * 8, 3, 2, 1)
        self.aspp = ASPPModule(nout * 8, nout * 8, dilations, dropout=True)
        self.dec4 = Decoder(nout * (6 + 8), nout * 6, 3, 1, 1)
        self.dec3 = Decoder(nout * (4 + 6), nout * 4, 3, 1, 1)
        self.dec2 = Decoder(nout * (2 + 4), nout * 2, 3, 1, 1)
        self.lstm_dec2 = LSTMModule(nout * 2, nin_lstm, nout_lstm)
        self.dec1 = Decoder(nout * (1 + 2) + 1, nout * 1, 3, 1, 1)

    def forward(self, x):
        e1 = self.enc1(x)
        e2 = self.enc2(e1)
        e3 = self.enc3(e2)
        e4 = self.enc4(e3)
        e5 = self.enc5(e4)
        h = self.aspp(e5)
        h = self.dec4(h, e4)
        h = self.dec3(h, e3)
        h = self.dec2(h, e2)
        h = torch.cat([h, self.lstm_dec2(h)], dim=1)
        h = self.dec1(h, e1)
        return h


class CascadedNet(nn.Module):
    def __init__(self, n_fft, nout=32, nout_lstm=128):
        super().__init__()
        self.max_bin = n_fft // 2
        self.output_bin = n_fft // 2 + 1
        self.nin_lstm = self.max_bin // 2
        self.offset = 64

        self.stg1_low_band_net = nn.Sequential(
            BaseNet(2, nout // 2, self.nin_lstm // 2, nout_lstm),
            Conv2DBNActiv(nout // 2, nout // 4, 1, 1, 0)
        )
        self.stg1_high_band_net = BaseNet(2, nout // 4, self.nin_lstm // 2, nout_lstm // 2)

        self.stg2_low_band_net = nn.Sequential(
            BaseNet(nout // 4 + 2, nout, self.nin_lstm // 2, nout_lstm),
            Conv2DBNActiv(nout, nout // 2, 1, 1, 0)
        )
        self.stg2_high_band_net = BaseNet(nout // 4 + 2, nout // 2, self.nin_lstm // 2, nout_lstm // 2)

        self.stg3_full_band_net = BaseNet(3 * nout // 4 + 2, nout, self.nin_lstm, nout_lstm)
        self.out = nn.Conv2d(nout, 2, 1, bias=False)
        self.aux_out = nn.Conv2d(3 * nout // 4, 2, 1, bias=False)

    def forward(self, x):
        x = x[:, :, :self.max_bin]
        bandw = x.size()[2] // 2
        l1_in = x[:, :, :bandw]
        h1_in = x[:, :, bandw:]
        l1 = self.stg1_low_band_net(l1_in)
        h1 = self.stg1_high_band_net(h1_in)
        aux1 = torch.cat([l1, h1], dim=2)

        l2_in = torch.cat([l1_in, l1], dim=1)
        h2_in = torch.cat([h1_in, h1], dim=1)
        l2 = self.stg2_low_band_net(l2_in)
        h2 = self.stg2_high_band_net(h2_in)
        aux2 = torch.cat([l2, h2], dim=2)

        f3_in = torch.cat([x, aux1, aux2], dim=1)
        f3 = self.stg3_full_band_net(f3_in)

        mask = torch.sigmoid(self.out(f3))
        mask = F.pad(mask, (0, 0, 0, self.output_bin - mask.size()[2]), mode='replicate')
        return mask

    def predict_mask(self, x):
        mask = self.forward(x)
        if self.offset > 0:
            mask = mask[:, :, :, self.offset:-self.offset]
        return mask


# ════════════════════════════════════════════════════════════════
#  Multi-band preprocessing (matching UVR5 4band_v3)
# ════════════════════════════════════════════════════════════════

BAND_CONFIG = {
    "bins": 672,
    "sr": 44100,
    "pre_filter_start": 668,
    "pre_filter_stop": 672,
    "band": {
        "1": {"sr": 7350, "hl": 80, "n_fft": 640, "crop_start": 0, "crop_stop": 85, "res_type": "polyphase"},
        "2": {"sr": 7350, "hl": 80, "n_fft": 320, "crop_start": 4, "crop_stop": 87, "res_type": "polyphase"},
        "3": {"sr": 14700, "hl": 160, "n_fft": 512, "crop_start": 17, "crop_stop": 216, "res_type": "polyphase"},
        "4": {"sr": 44100, "hl": 480, "n_fft": 960, "crop_start": 78, "crop_stop": 383, "res_type": "kaiser_fast"},
    }
}


def _stft(wave, n_fft, hop_length):
    """Return complex STFT tensor [C, F, T]."""
    wave_t = torch.from_numpy(wave.astype(np.float32))
    if wave_t.dim() == 1:
        wave_t = wave_t.unsqueeze(0)
    spec = torch.stft(
        wave_t, n_fft=n_fft, hop_length=hop_length,
        window=torch.hann_window(n_fft),
        return_complex=True, center=True
    )  # [C, F, T, 2] -> complex [C, F, T]
    return spec


def _istft(spec, hop_length):
    """spec: complex tensor [C, F, T] -> numpy [T, C]."""
    wave = torch.istft(
        spec, n_fft=(spec.shape[1] - 1) * 2, hop_length=hop_length,
        window=torch.hann_window((spec.shape[1] - 1) * 2),
        return_complex=False, center=True
    )  # [C, T]
    return wave.cpu().numpy().T


def combine_spectrograms(specs, band_config):
    """
    Combine multi-band spectrograms into single 672-bin spectrogram.
    Matches UVR5 combine_spectrograms with pre_filter for v5.1 models.
    specs: {band_id: complex tensor [C, F, T]}
    Returns: complex tensor [2, 672, T]
    """
    bands = sorted(int(k) for k in band_config["band"].keys())
    bands_n = len(bands)
    
    l = min(specs[i].shape[2] for i in specs)
    spec_c = np.zeros((2, band_config["bins"], l), dtype=np.complex64)
    offset = 0
    
    for d in bands:
        bp = band_config["band"][str(d)]
        h = bp["crop_stop"] - bp["crop_start"]
        spec_c[:, offset:offset+h, :l] = specs[d][:, bp["crop_start"]:bp["crop_stop"], :l].cpu().numpy()
        offset += h

    # Apply pre_filter (lowpass on highest bins) matching UVR5
    pre_start = band_config.get("pre_filter_start", 0)
    pre_stop = band_config.get("pre_filter_stop", 0)
    if pre_start > 0:
        mask_lp = _get_lp_filter_mask(spec_c.shape[1], pre_start, pre_stop)
        spec_c *= mask_lp.numpy()  # (1, 672, 1) -> broadcasts to (2, 672, T)

    combined = torch.from_numpy(np.asfortranarray(spec_c)).to(specs[bands[0]].device)
    if combined.shape[0] == 1:
        combined = combined.repeat(2, 1, 1)
    return combined


def separate_spectrograms(combined, band_config):
    """
    Inverse of combine: split 672-bin combined spec back to per-band specs.
    Returns: {band_id: complex tensor [C, F, T]} where F = n_fft//2 + 1
    """
    bands = sorted(int(k) for k in band_config["band"].keys())
    result = {}
    pos = 0
    for b in bands:
        bp = band_config["band"][str(b)]
        cs, ce = bp["crop_start"], bp["crop_stop"]
        n_bins = ce - cs
        n_total = bp["n_fft"] // 2 + 1
        # Extract crop from combined, pad to full size
        crop = combined[:, pos:pos + n_bins, :]  # [C, n_bins, T]
        padded = F.pad(crop.cpu(), (0, 0, cs, n_total - ce))
        result[b] = padded
        pos += n_bins
    return result


def build_input_spec(audio_np, sr, band_config, device):
    """
    Build multi-band combined spectrogram from audio.
    audio_np: [samples] or [samples, channels]
    Returns: [2, 672, T_frames] complex tensor
    """
    if audio_np.ndim == 2:
        audio_np = audio_np.mean(axis=1)
    bands = sorted(int(k) for k in band_config["band"].keys())
    specs = {}
    prev_wave = None

    for d in bands:
        bp = band_config["band"][str(d)]
        if d == max(bands):
            import librosa
            wave = librosa.resample(audio_np, orig_sr=sr, target_sr=bp["sr"])
        else:
            import librosa
            wave = librosa.resample(audio_np, orig_sr=sr, target_sr=bp["sr"])
        spec = _stft(wave, bp["n_fft"], bp["hl"])  # [C, F, T]
        specs[d] = spec

    # Time-align: find min frames, crop all to match
    min_frames = min(s.shape[-1] for s in specs.values())
    for d in specs:
        specs[d] = specs[d][..., :min_frames]

    combined = combine_spectrograms(specs, band_config)
    return combined.to(device)


def _get_lp_filter_mask(n_bins, bin_start, bin_stop):
    """Low-pass filter mask matching UVR5 get_lp_filter_mask."""
    mask = torch.cat([
        torch.ones(bin_start - 1, 1),
        torch.linspace(1, 0, bin_stop - bin_start + 1).unsqueeze(1),
        torch.zeros(n_bins - bin_stop, 1)
    ], dim=0)
    # Expand to [1, n_bins, 1] for broadcasting
    return mask.unsqueeze(0)  # [1, n_bins, 1]


def _get_hp_filter_mask(n_bins, bin_start, bin_stop):
    """High-pass filter mask matching UVR5 get_hp_filter_mask."""
    mask = torch.cat([
        torch.zeros(bin_stop + 1, 1),
        torch.linspace(0, 1, 1 + bin_start - bin_stop).unsqueeze(1),
        torch.ones(n_bins - bin_start - 2, 1)
    ], dim=0)
    return mask.unsqueeze(0)  # [1, n_bins, 1]


def cmb_spectrogram_to_wave(spec_m, band_config, device):
    """
    Convert combined 672-bin spectrogram back to waveform.
    Matches UVR5 cmb_spectrogram_to_wave for v5.1 models.
    spec_m: [2, 672, T] complex tensor on GPU
    Returns: numpy [T_samples] mono float32
    """
    import librosa
    bands = sorted(int(k) for k in band_config["band"].keys())
    bands_n = len(bands)
    offset = 0
    wave = None

    for d in bands:
        bp = band_config["band"][str(d)]
        n_bins_total = bp["n_fft"] // 2 + 1
        cs, ce = bp["crop_start"], bp["crop_stop"]
        h = ce - cs
        T = spec_m.shape[2]

        # Create full-band spec [2, n_bins_total, T] complex
        spec_s_cpu = np.zeros((2, n_bins_total, T), dtype=np.complex64)
        crop_cpu = spec_m[:, offset:offset+h, :].cpu().numpy()
        spec_s_cpu[:, cs:ce, :] = crop_cpu
        offset += h

        if d == bands_n:  # highest band (band 4)
            if bp.get("hpf_start", 0) > 0:
                mask = _get_hp_filter_mask(n_bins_total, bp["hpf_start"], bp["hpf_stop"] - 1)
                spec_s_cpu *= mask.numpy()  # (1, F, 1) broadcasts
            if bands_n == 1:
                wave = _istft_single_band(spec_s_cpu, bp["hl"])
            else:
                w = _istft_single_band(spec_s_cpu, bp["hl"])
                wave = w if wave is None else wave + w
        else:
            sr_next = band_config["band"][str(d + 1)]["sr"]
            if d == 1:  # lowest band
                if bp.get("lpf_start", 0) > 0:
                    mask = _get_lp_filter_mask(n_bins_total, bp["lpf_start"], bp["lpf_stop"])
                    spec_s_cpu *= mask.numpy()
                w = _istft_single_band(spec_s_cpu, bp["hl"])
                wave = librosa.resample(w, orig_sr=bp["sr"], target_sr=sr_next)
            else:  # mid bands
                if bp.get("hpf_start", 0) > 0:
                    mask_hp = _get_hp_filter_mask(n_bins_total, bp["hpf_start"], bp["hpf_stop"] - 1)
                    spec_s_cpu *= mask_hp.numpy()
                if bp.get("lpf_start", 0) > 0:
                    mask_lp = _get_lp_filter_mask(n_bins_total, bp["lpf_start"], bp["lpf_stop"])
                    spec_s_cpu *= mask_lp.numpy()
                w = _istft_single_band(spec_s_cpu, bp["hl"])
                wave = wave + w
                wave = librosa.resample(wave, orig_sr=bp["sr"], target_sr=sr_next)

    if wave is None:
        raise RuntimeError("No bands processed")
    return wave.astype(np.float32)


def _istft_single_band(spec, hop_length):
    """ISTFT a (2, F, T) complex64 numpy array -> mono numpy [samples]."""
    import librosa
    wl = librosa.istft(np.asfortranarray(spec[0]), hop_length=hop_length)
    wr = librosa.istft(np.asfortranarray(spec[1]), hop_length=hop_length)
    return (wl + wr) / 2.0


# ════════════════════════════════════════════════════════════════
#  Main
# ════════════════════════════════════════════════════════════════

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

    # Build model
    M_BINS = 672
    N_FFT = M_BINS * 2  # 1344
    NOUT = 48
    NOUT_LSTM = 128

    print(f"Building CascadedNet (n_fft={N_FFT}, nout={NOUT}, nout_lstm={NOUT_LSTM})...")
    model = CascadedNet(n_fft=N_FFT, nout=NOUT, nout_lstm=NOUT_LSTM)
    model.to(device)
    model.eval()

    # Load checkpoint
    ckpt_path = r"D:\models\uvr_models_backup\VR_Models\UVR-De-Echo-Aggressive.pth"
    print(f"Loading checkpoint: {os.path.basename(ckpt_path)} ({os.path.getsize(ckpt_path)/1024:.1f} KB)")
    ckpt = torch.load(ckpt_path, map_location='cpu')
    model.load_state_dict(ckpt)
    print("Model loaded successfully.")

    # Load audio
    info = sf.info(input_path)
    print(f"\nInput: {os.path.basename(input_path)} ({info.samplerate} Hz, {info.duration:.1f}s, {info.channels}ch)")
    audio, sr = sf.read(input_path)

    # Build multi-band input spec
    print("Building multi-band spectrogram...")
    t0 = time.time()

    # For VR, we process in forward direction
    combined_spec = build_input_spec(audio, sr, BAND_CONFIG, device)  # [2, 672, T]

    # Get magnitude and phase
    X_mag = torch.abs(combined_spec)
    X_phase = torch.angle(combined_spec)

    # Normalize magnitude
    X_mag_max = X_mag.max()
    X_mag = X_mag / X_mag_max

    n_frame = X_mag.shape[2]
    window_size = 512  # typical VR window
    offset = model.offset  # 64
    roi_size = window_size - 2 * offset  # 384

    # Pad for sliding window
    pad_l = offset
    pad_r = (roi_size - (n_frame % roi_size)) % roi_size + offset
    X_pad = F.pad(X_mag, (pad_l, pad_r), mode='constant', value=0)

    # Sliding window inference
    n_patches = (X_pad.shape[2] - 2 * offset) // roi_size
    print(f"{n_frame} frames, {n_patches} patches (window={window_size}, offset={offset})")

    with torch.no_grad():
        masks = []
        batch_size = 4
        for i in range(0, n_patches, batch_size):
            batch = []
            for j in range(i, min(i + batch_size, n_patches)):
                start = j * roi_size
                win = X_pad[:, :, start:start + window_size].unsqueeze(0)
                batch.append(win)
            X_batch = torch.cat(batch, dim=0)  # [B, 2, 672, window_size]

            pred = model.predict_mask(X_batch)  # [B, 2, 384, window_size-2*offset]
            pred = pred.cpu()

            for j in range(pred.shape[0]):
                masks.append(pred[j:j+1])

            if (i + batch_size) % max(1, n_patches // 10) == 0:
                pct = min(100, (i + batch_size) / n_patches * 100)
                print(f"  {pct:.0f}%")

    # Concatenate masks along time axis
    # predict_mask output: [1, 2, 673, roi_size] where roi_size = window_size - 2*offset
    full_mask = torch.cat(masks, dim=3)  # [1, 2, 673, n_patches * roi_size]
    full_mask = full_mask[:, :, :, :n_frame]

    # Crop to 672 freq bins (model output is 673 with Nyquist padding)
    mask_for_spec = full_mask[:, :, :672, :]

    # Apply mask: try BOTH directions since we don't know if the model
    # was trained with primary_stem='Echo' or 'No Echo'
    mask_gpu = mask_for_spec.squeeze(0).to(device)  # [2, 672, T]

    # Aggressiveness: sharpen mask with power function.
    # UVR5 uses different powers for low vs high freq bins.
    # De-Echo is NOT in NON_ACCOM_STEMS, so aggr = value * 2.
    # With aggressiveness=2: aggr=4, power_low=1+4/3≈2.3, power_high=1+4=5
    SPLIT_BIN = 256  # UVR5 default split between low/high freq treatment
    aggr_value = 2.0  # UVR5 aggressiveness (0-10 scale, lower = gentler)
    aggr = aggr_value * 2  # 4
    power_low = 1.0 + aggr / 3  # ~2.3
    power_high = 1.0 + aggr  # 5

    # Apply power: mask -> mask^power (sharper = more aggressive separation)
    mask_low = mask_gpu[:, :SPLIT_BIN, :] ** power_low
    mask_high = mask_gpu[:, SPLIT_BIN:, :] ** power_high
    mask_sharp = torch.cat([mask_low, mask_high], dim=1)

    # mask predicts No Echo (dry signal)
    y_spec_a = combined_spec * mask_sharp

    # Convert to waveform (UVR5-accurate reconstruction with HPF/LPF filters)
    print("Converting to waveform...")
    y_wave = cmb_spectrogram_to_wave(y_spec_a, BAND_CONFIG, device)

    elapsed = time.time() - t0
    dur = len(y_wave) / sr
    print(f"Done in {elapsed:.1f}s ({dur/elapsed:.1f}x realtime)")

    # Save
    base = os.path.splitext(os.path.basename(input_path))[0]
    out_path = os.path.join(output_dir, f"{base}_decho.wav")
    sf.write(out_path, y_wave, 44100)
    print(f"Saved: {out_path}")

    del model, combined_spec
    torch.cuda.empty_cache()
    print("GPU mem freed. Done!")


if __name__ == "__main__":
    main()
