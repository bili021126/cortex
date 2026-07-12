"""MDX23C 模型定义——直接加载 UVR5 权重，CUDA 推理

架构: TFC-TDF v3 U-Net, 8K FFT, 16 频带, 5 层 encoder + bottleneck + 5 层 decoder
输入: stereo 16 频带 spectrogram [B, 16, F, T]
输出: 32 通道 mask [B, 32, F, T] → 2 声道 × 16 频带 complex mask

注意: 模块名必须与 UVR5 checkpoint key 完全一致，否则 load_state_dict 会失败
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from collections import OrderedDict


def _make_tfc(channels):
    """TFC: BN(.0) → GELU(.1, no state) → Conv(.2, no bias)"""
    return nn.Sequential(OrderedDict([
        ("0", nn.BatchNorm2d(channels)),
        ("1", nn.GELU()),
        ("2", nn.Conv2d(channels, channels, 3, 1, 1, bias=False)),
    ]))


def _make_tdf(channels, f_bins, f_hidden):
    """TDF: BN(.0) → avg(freq) → Linear(.2) → GELU(.4) → BN(.3) → Linear(.5)

    UVR5 原生 forward:
      x → BN(.0) → mean(dim=-2) → [B,C,T,1] → squeeze →
      Linear(.2, now [B*C, T]→[B*C, f_hidden]) → GELU →
      reshape→[B,C,f_hidden,1] → BN(.3) → squeeze →
      Linear(.5, now [B*C, f_hidden]→[B*C, T]) →
      reshape→[B,C,1,T] → multiply with original x
    """
    return nn.Sequential(OrderedDict([
        ("0", nn.BatchNorm2d(channels)),
        ("2", nn.Linear(f_bins, f_hidden, bias=False)),
        ("3", nn.BatchNorm2d(channels)),
        ("5", nn.Linear(f_hidden, f_bins, bias=False)),
    ]))


class _TFC_TDF_Block(nn.Module):
    """Block: TFC → GELU → TDF → TFC → +shortcut → GELU

    UVR5 原生 forward (TFC_TDF_Block):
      x = tfc1(x), x = F.gelu(x)
      x = tdf(x)  # inside: mean(freq), linear, BN, linear, multiply
      x = tfc2(x)
      x = x + shortcut(orig_x)
      x = F.gelu(x)
    """

    def __init__(self, channels, f_bins, f_hidden):
        super().__init__()
        self.tfc1 = _make_tfc(channels)
        self.tdf = _make_tdf(channels, f_bins, f_hidden)
        self.tfc2 = _make_tfc(channels)
        self.shortcut = nn.Conv2d(channels, channels, 1, 1, 0, bias=False)

    def forward(self, x):
        orig = x
        # TFC1 → GELU
        x = F.gelu(self.tfc1(x))

        # TDF: avg over freq → linear → BN → linear → multiply
        B, C, F_b, T = x.shape
        h_tdf = self.tdf[0](x)              # BN: [B,C,F,T]
        h_tdf = h_tdf.mean(dim=-2)          # [B,C,T]
        h_tdf = h_tdf.reshape(B * C, T)     # [B*C,T] for Linear
        h_tdf = self.tdf[2](h_tdf)          # Linear: [B*C,f_hidden]
        h_tdf = F.gelu(h_tdf)
        h_tdf = h_tdf.reshape(B, C, -1, 1)  # [B,C,f_hidden,1]
        h_tdf = self.tdf[3](h_tdf)          # BN: [B,C,f_hidden,1]
        h_tdf = h_tdf.reshape(B * C, -1)    # [B*C,f_hidden]
        h_tdf = self.tdf[5](h_tdf)          # Linear: [B*C,T]
        h_tdf = h_tdf.reshape(B, C, 1, T)   # [B,C,1,T]
        x = x * h_tdf

        # TFC2 → +shortcut → GELU
        x = self.tfc2(x)
        x = F.gelu(x + self.shortcut(orig))
        return x


def _make_downscale(in_ch, out_ch):
    """Downscale: conv.0(BN) → conv.2(Conv, stride=2)"""
    ds = nn.Module()
    ds.conv = nn.Sequential(OrderedDict([
        ("0", nn.BatchNorm2d(in_ch)),
        ("2", nn.Conv2d(in_ch, out_ch, 2, 2, bias=False)),
    ]))
    return ds


def _make_upscale(in_ch, out_ch):
    """Upscale: conv.0(BN) → conv.2(ConvTranspose2d, stride=2)"""
    us = nn.Module()
    us.conv = nn.Sequential(OrderedDict([
        ("0", nn.BatchNorm2d(in_ch)),
        ("2", nn.ConvTranspose2d(in_ch, out_ch, 2, 2, bias=False)),
    ]))
    return us


class MDX23C(nn.Module):
    """MDX23C 8K FFT InstVoc HQ 模型

    输入: [B, 16, F, T] 16频带 spectrogram
    输出: [B, 32, F, T] 32频带 mask (2声道×16频带)
    """

    def __init__(self):
        super().__init__()
        self.first_conv = nn.Conv2d(16, 128, 1, 1, 0, bias=False)

        # Encoder blocks: encoder_blocks.N
        enc_params = [
            (128, 256, 1024, 256),
            (256, 384, 512, 128),
            (384, 512, 256, 64),
            (512, 640, 128, 32),
            (640, 768, 64, 16),
        ]
        self.encoder_blocks = nn.ModuleList()
        for in_ch, out_ch, f_b, f_h in enc_params:
            blk = nn.Module()
            blk.tfc_tdf = nn.Module()
            blk.tfc_tdf.blocks = nn.ModuleList([
                _TFC_TDF_Block(in_ch, f_b, f_h),
                _TFC_TDF_Block(in_ch, f_b, f_h),
            ])
            blk.downscale = _make_downscale(in_ch, out_ch)
            self.encoder_blocks.append(blk)

        # Bottleneck: bottleneck_block.blocks
        self.bottleneck_block = nn.Module()
        self.bottleneck_block.blocks = nn.ModuleList([
            _TFC_TDF_Block(768, 32, 8),
            _TFC_TDF_Block(768, 32, 8),
        ])

        # Decoder blocks: decoder_blocks.N
        # blocks[0] 吃拼接的双倍通道, blocks[1] 正常通道
        dec_params = [
            (768, 640, 64, 16),
            (640, 512, 128, 32),
            (512, 384, 256, 64),
            (384, 256, 512, 128),
            (256, 128, 1024, 256),
        ]
        self.decoder_blocks = nn.ModuleList()
        for in_ch, out_ch, f_b, f_h in dec_params:
            blk = nn.Module()
            blk.upscale = _make_upscale(in_ch, out_ch)
            blk.tfc_tdf = nn.Module()
            blk.tfc_tdf.blocks = nn.ModuleList([
                _TFC_TDF_Block(out_ch * 2, f_b, f_h),  # 拼接后双倍
                _TFC_TDF_Block(out_ch, f_b, f_h),
            ])
            self.decoder_blocks.append(blk)

        # final_conv
        self.final_conv = nn.Sequential(OrderedDict([
            ("0", nn.Conv2d(144, 128, 1, 1, 0, bias=False)),
            ("1", nn.GELU()),
            ("2", nn.Conv2d(128, 32, 1, 1, 0, bias=False)),
        ]))

    def forward(self, x):
        # x: [B, 16, F, T]
        x0 = self.first_conv(x)

        # Encoder with skip connections
        skips = []
        h = x0
        for i, enc in enumerate(self.encoder_blocks):
            for blk in enc.tfc_tdf.blocks:
                h = blk(h)
            skips.append(h)
            h = enc.downscale.conv(h)

        # Bottleneck
        for blk in self.bottleneck_block.blocks:
            h = blk(h)

        # Decoder with skip connections (拼接, 非加法)
        for i, dec in enumerate(self.decoder_blocks):
            h = dec.upscale.conv(h)
            skip = skips[-(i + 1)]
            # 拼接 upsample + encoder skip → 双倍通道
            h = torch.cat([h, skip[..., :h.shape[-2], :h.shape[-1]]], dim=1)
            for blk in dec.tfc_tdf.blocks:
                h = blk(h)

        # Final: concat with input skip
        h = torch.cat([h, x[..., :h.shape[-2], :h.shape[-1]]], dim=1)  # 128+16=144
        out = self.final_conv(h)
        return out


if __name__ == "__main__":
    model = MDX23C()
    print(f"Params: {sum(p.numel() for p in model.parameters())/1e6:.1f}M")
    x = torch.randn(1, 16, 256, 1024)  # [B, 16, freq_bands, time_frames]
    with torch.no_grad():
        y = model(x)
    print(f"Input:  {list(x.shape)}")
    print(f"Output: {list(y.shape)}")
