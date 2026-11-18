#!/usr/bin/env python3
"""
Generate a 4096x4096 single-channel Signed Distance Field (SDF) font atlas
(64x64 grid, 64x64 px per cell) and a matching glyph index JSON shared
between ekac-bubble (Node/TS OSC sender) and the Unity VRC bubble plugin.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt

ATLAS_SIZE = 4096
GRID = 64
CELL = ATLAS_SIZE // GRID  # 64
FONT_SIZE = 40
BASELINE_Y = 47
SPREAD_PX = 8.0

REPO_ROOT = Path(__file__).resolve().parent.parent
WIN_FONTS = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
DEFAULT_NOTO = str(WIN_FONTS / "NotoSansSC-VF.ttf")
DEFAULT_MSYH = str(WIN_FONTS / "msyh.ttc")
DEFAULT_YUGOTH = str(WIN_FONTS / "YuGothM.ttc")

DEFAULT_OUT_JSON = REPO_ROOT / "web" / "bubble-glyphs.json"
DEFAULT_OUT_PNG = Path(
    os.environ.get("EKAC_OUT_PNG", str(REPO_ROOT / "scripts" / "out" / "EkacGlyphAtlas.png"))
)


def _notdef_signature(font: ImageFont.FreeTypeFont) -> bytes:
    cached = getattr(font, "_notdef_sig", None)
    if cached is None:
        try:
            cached = bytes(font.getmask("\uffff"))
        except Exception:
            cached = b""
        font._notdef_sig = cached
    return cached


def _has_real_glyph(font: ImageFont.FreeTypeFont, ch: str) -> bool:
    try:
        mask = font.getmask(ch)
        if mask.size[0] <= 0 or mask.size[1] <= 0:
            return False
        sig = _notdef_signature(font)
        return not (sig and bytes(mask) == sig)
    except Exception:
        return False


def load_fonts(primary_path: str, msyh_path: str, yugoth_path: str):
    noto = ImageFont.truetype(primary_path, FONT_SIZE)
    try:
        noto.set_variation_by_name("Medium")
    except Exception:
        pass
    msyh = ImageFont.truetype(msyh_path, FONT_SIZE) if msyh_path and os.path.exists(msyh_path) else None
    yugoth = ImageFont.truetype(yugoth_path, FONT_SIZE) if yugoth_path and os.path.exists(yugoth_path) else None
    return noto, msyh, yugoth


def gb2312_level1_chars() -> list[str]:
    chars = []
    # GB2312 Level 1: qu 16..55 (bytes 0xB0..0xD7), wei 1..94 (bytes 0xA1..0xFE), D7FA..D7FE unused
    for b1 in range(0xB0, 0xD8):
        for b2 in range(0xA1, 0xFF):
            if b1 == 0xD7 and b2 >= 0xFA:
                continue
            try:
                ch = bytes([b1, b2]).decode("gb2312")
                chars.append(ch)
            except UnicodeDecodeError:
                pass
    return chars


def render_sdf_cell(ch: str, primary: ImageFont.FreeTypeFont, fallbacks: list[ImageFont.FreeTypeFont]) -> np.ndarray:
    if ch in ("", " ", "\u3000"):
        return np.zeros((CELL, CELL), dtype=np.uint8)

    # Render at 2x resolution for cleaner subpixel SDF edges, then downsample?
    # Better: render at 2x (128x128) binary/grayscale alpha and compute EDT at 2x, then resize 64x64!
    scale = 2
    hi = CELL * scale
    img = Image.new("L", (hi, hi), 0)
    draw = ImageDraw.Draw(img)

    # Try primary font, check if glyph mask is empty or .notdef tofu
    chosen = primary
    for f in [primary] + [fb for fb in fallbacks if fb is not None]:
        if _has_real_glyph(f, ch):
            chosen = f
            break

    # Scale up font temporarily? Create cached scaled fonts by attribute lookup
    hi_font = getattr(chosen, "_hi_font", None)
    if hi_font is None:
        hi_font = ImageFont.truetype(chosen.path, FONT_SIZE * scale)
        try:
            hi_font.set_variation_by_name("Medium")
        except Exception:
            pass
        chosen._hi_font = hi_font

    draw.text((hi // 2, BASELINE_Y * scale), ch, fill=255, font=hi_font, anchor="ms")
    arr = np.asarray(img, dtype=np.float32) / 255.0

    # Clamp inside bounds if ink overflows near borders (stay >= 2 px margin in 1x -> 4 px in 2x)
    inside = arr >= 0.5
    if not np.any(inside):
        return np.zeros((CELL, CELL), dtype=np.uint8)

    dist_out = distance_transform_edt(~inside)
    dist_in = distance_transform_edt(inside)
    # Positive inside, negative outside (in 2x pixels)
    signed_dist = np.where(inside, dist_in - 0.5, -(dist_out - 0.5)) / (SPREAD_PX * scale)
    sdf_hi = np.clip(0.5 + 0.5 * signed_dist, 0.0, 1.0)
    # Enforce hard border fade to 0 on outermost 2px of 2x cell so neighbors never bleed
    sdf_hi[:2, :] = np.minimum(sdf_hi[:2, :], 0.25)
    sdf_hi[-2:, :] = np.minimum(sdf_hi[-2:, :], 0.25)
    sdf_hi[:, :2] = np.minimum(sdf_hi[:, :2], 0.25)
    sdf_hi[:, -2:] = np.minimum(sdf_hi[:, -2:], 0.25)

    sdf_img = Image.fromarray(np.round(sdf_hi * 255.0).astype(np.uint8), mode="L").resize(
        (CELL, CELL), Image.Resampling.BILINEAR
    )
    return np.asarray(sdf_img, dtype=np.uint8)


def build_layout(primary: ImageFont.FreeTypeFont):
    # Classify printable ASCII into 4 advance tiers matching Shader constants
    tier0 = []  # 0.36 -> row 0 col 2..31 (0=empty, 1=' ')
    tier1 = []  # 0.60 -> (row 0 col 32..63) + (row 1 col 0..31) [64 slots]
    tier2 = []  # 0.78 -> row 1 col 32..63 [32 slots]
    wide_ascii = []  # 1.00 -> row >= 2

    measure = ImageFont.truetype(primary.path, 100)
    try:
        measure.set_variation_by_name("Medium")
    except Exception:
        pass

    for code in range(0x21, 0x7F):
        ch = chr(code)
        adv = measure.getlength(ch) / 100.0
        if adv <= 0.42:
            tier0.append(ch)
        elif adv <= 0.65:
            tier1.append(ch)
        elif adv <= 0.80:
            tier2.append(ch)
        else:
            wide_ascii.append(ch)

    # Fullwidth / CJK / Kana / Punctuation placed in row >= 2 (slots 128..4095 = 3968 slots)
    punct = list(
        "，。！？、；：“”‘’（）《》【】「」『』…—～·￥×÷±％℃°"
        "★☆♡♥♪"
    )
    hiragana = [chr(c) for c in range(0x3041, 0x3094)] + ["ー"]  # ぁ..ん + ー (84)
    katakana = [chr(c) for c in range(0x30A1, 0x30F5)]  # ァ..ヶ (84)
    colloquial_l2 = list(
        "嗯唔呃嘛呐喵哒诶嘞啰咩咦哟咋咱俩呸嘿嘻噢喔嗷蹭戳摸捏哼唧"
        "啵哒咩咪咻嘟哒呀哈哇哦嗨"
        "冇嘢咗嘅嗰啲喺嚟睇瞓"
        "囧宅萌酱桑"
    )

    gb_l1 = gb2312_level1_chars()
    # Drop 36 rare chemical/metallurgical GB2312 Level-1 characters so trailing Pinyin 'z*' common words (最走做作坐座左昨嘴组足族...) all fit in 3968 slots
    obscure_drop = set(
        "钵硒锗氨胺烷烯炔酚醚酮醛苯矾钒铬硅磺钾氯镁锰钠镍铅氰砷锑钨锡锌铀磷硫硼碘"
    )

    if len(tier0) > 30:
        tier1 = tier0[30:] + tier1
        tier0 = tier0[:30]
    if len(tier1) > 64:
        tier2 = tier1[64:] + tier2
        tier1 = tier1[:64]
    if len(tier2) > 32:
        wide_ascii = tier2[32:] + wide_ascii
        tier2 = tier2[:32]

    tier3: list[str] = []
    seen = set(["", " ", "\u25a1", "\u3000"] + tier0 + tier1 + tier2)

    def push_unique(seq):
        for ch in seq:
            if ch not in seen:
                seen.add(ch)
                tier3.append(ch)

    tier3.append("\u25a1")  # id 128: fallback box □
    tier3.append("\u3000")  # id 129: fullwidth space
    push_unique(wide_ascii)
    push_unique(punct)
    push_unique(hiragana)
    push_unique(katakana)
    push_unique(colloquial_l2)

    remaining_cap = 3968 - len(tier3)
    l1_filtered = [c for c in gb_l1 if c not in seen and c not in obscure_drop]
    if len(l1_filtered) > remaining_cap:
        l1_filtered = l1_filtered[:remaining_cap]
    push_unique(l1_filtered)

    # Top up with any dropped obscure if space remains
    if len(tier3) < 3968:
        extra = [c for c in gb_l1 if c not in seen]
        push_unique(extra[: 3968 - len(tier3)])

    slots: list[tuple[int, str, float]] = []
    # Tier 0: ids 0..31 (0.36)
    slots.append((0, "", 0.0))
    slots.append((1, " ", 0.36))
    for i, ch in enumerate(tier0[:30]):
        slots.append((2 + i, ch, 0.36))
    # Tier 1: ids 32..95 (0.60)
    assert len(tier1) <= 64, f"tier1 overflow: {len(tier1)}"
    for i, ch in enumerate(tier1):
        slots.append((32 + i, ch, 0.60))
    # Tier 2: ids 96..127 (0.78)
    assert len(tier2) <= 32, f"tier2 overflow: {len(tier2)}"
    for i, ch in enumerate(tier2):
        slots.append((96 + i, ch, 0.78))
    # Tier 3: ids 128..4095 (1.00)
    assert len(tier3) <= 3968, f"tier3 overflow: {len(tier3)}"
    for i, ch in enumerate(tier3):
        slots.append((128 + i, ch, 1.00))

    return slots


def parse_args():
    parser = argparse.ArgumentParser(description="Generate shared 4096x4096 SDF glyph atlas and JSON index.")
    parser.add_argument("--out-json", type=Path, default=DEFAULT_OUT_JSON)
    parser.add_argument("--out-png", type=Path, default=DEFAULT_OUT_PNG)
    parser.add_argument("--font-primary", default=DEFAULT_NOTO)
    parser.add_argument("--font-msyh", default=DEFAULT_MSYH)
    parser.add_argument("--font-yugoth", default=DEFAULT_YUGOTH)
    return parser.parse_args()


def main():
    args = parse_args()
    primary, msyh, yugoth = load_fonts(args.font_primary, args.font_msyh, args.font_yugoth)
    slots = build_layout(primary)
    atlas = np.zeros((ATLAS_SIZE, ATLAS_SIZE), dtype=np.uint8)
    glyph_map = {}

    for idx, (gid, ch, adv) in enumerate(slots):
        col = gid % GRID
        row = gid // GRID
        if ch:
            cell_arr = render_sdf_cell(ch, primary, [msyh, yugoth])
            y0 = row * CELL
            x0 = col * CELL
            atlas[y0 : y0 + CELL, x0 : x0 + CELL] = cell_arr
            glyph_map[ch] = [col, row, adv]
        if (idx + 1) % 500 == 0:
            print(f"Rendered {idx + 1}/{len(slots)} glyphs...")

    args.out_png.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.parent.mkdir(parents=True, exist_ok=True)

    Image.fromarray(atlas, mode="L").save(args.out_png, optimize=False)

    payload = {
        "version": 1,
        "grid": GRID,
        "cellSize": CELL,
        "atlasSize": ATLAS_SIZE,
        "fallback": [0, 2, 1.0],  # id 128 -> col=0, row=2 (□)
        "space": [1, 0, 0.36],
        "glyphs": glyph_map,
    }
    args.out_json.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Done! Total glyphs={len(glyph_map)}, PNG={args.out_png} ({args.out_png.stat().st_size // 1024} KB), JSON={args.out_json} ({args.out_json.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
