#!/usr/bin/env python3
"""
Generate a dual-page 4096x4096 single-channel Signed Distance Field (SDF) font atlas
(64 cols x 128 rows = 8,192 slots, 64x64 px per cell; Page 0 = rows 0..63, Page 1 = rows 64..127)
and a matching glyph index JSON (with Traditional->Simplified fallback pairs and 64 reserved
user-custom slots on Row 127) shared between ekac-bubble and the Unity VRC bubble plugin.
"""

from __future__ import annotations

import argparse
import ctypes
import gzip
import json
import os
from collections import Counter
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt

ATLAS_SIZE = 4096
GRID = 64
PAGES = 2
TOTAL_ROWS = GRID * PAGES  # 128
CUSTOM_ROW = TOTAL_ROWS - 1  # 127 (64 reserved custom user slots)
CUSTOM_CAPACITY = GRID  # 64
BUILTIN_FULLWIDTH_SLOTS = (CUSTOM_ROW - 2) * GRID  # rows 2..126 -> 125 * 64 = 8000 slots
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
DEFAULT_OUT_PNG_P0 = Path(
    os.environ.get("EKAC_OUT_PNG", str(REPO_ROOT / "scripts" / "out" / "EkacGlyphAtlas.png"))
)
DEFAULT_OUT_PNG_P1 = Path(
    os.environ.get("EKAC_OUT_PNG_P1", str(REPO_ROOT / "scripts" / "out" / "EkacGlyphAtlas_P1.png"))
)
JA_IPADIC_PATH = REPO_ROOT / "vendor" / "speech" / "data" / "ja-ipadic.tsv.gz"
ZH_BANK_PATH = REPO_ROOT / "vendor" / "speech" / "data" / "zh.json"


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


def gb2312_chars() -> tuple[list[str], list[str]]:
    l1 = []
    # GB2312 Level 1: qu 16..55 (bytes 0xB0..0xD7), wei 1..94 (bytes 0xA1..0xFE), D7FA..D7FE unused
    for b1 in range(0xB0, 0xD8):
        for b2 in range(0xA1, 0xFF):
            if b1 == 0xD7 and b2 >= 0xFA:
                continue
            try:
                l1.append(bytes([b1, b2]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    l2 = []
    # GB2312 Level 2: qu 56..87 (bytes 0xD8..0xF7), wei 1..94 (bytes 0xA1..0xFE)
    for b1 in range(0xD8, 0xF8):
        for b2 in range(0xA1, 0xFF):
            try:
                l2.append(bytes([b1, b2]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return l1, l2


def load_ja_kanji_ranked() -> list[str]:
    if not JA_IPADIC_PATH.exists():
        return []
    freq = Counter()
    with gzip.open(JA_IPADIC_PATH, "rt", encoding="utf-8") as f:
        for line in f:
            word = line.split("\t", 1)[0]
            for ch in word:
                if "\u4e00" <= ch <= "\u9fff":
                    freq[ch] += 1
    return [ch for ch, _ in freq.most_common()]


def load_zh_bank_cjk() -> list[str]:
    if not ZH_BANK_PATH.exists():
        return []
    data = json.loads(ZH_BANK_PATH.read_text(encoding="utf-8"))
    chars = []
    seen = set()
    for val in data.values():
        for ch in val:
            if "\u4e00" <= ch <= "\u9fff" and ch not in seen:
                seen.add(ch)
                chars.append(ch)
    return chars


def build_t2s_pairs(glyph_map: dict[str, list[float]], allow_empty: bool = False) -> str:
    """Build deterministic Traditional->Simplified fallback pairs using Windows LCMapStringEx or OpenCC."""
    if os.name == "nt":
        try:
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            LCMAP_SIMPLIFIED_CHINESE = 0x02000000
        except Exception as exc:
            if allow_empty:
                return ""
            raise RuntimeError(f"Failed to load kernel32 LCMapStringEx: {exc}") from exc

        pairs = []
        for cp in range(0x4E00, 0xA000):
            ch = chr(cp)
            if ch in glyph_map:
                continue
            buf = ctypes.create_unicode_buffer(4)
            n = kernel32.LCMapStringEx("zh-CN", LCMAP_SIMPLIFIED_CHINESE, ch, len(ch), buf, 4, None, None, 0)
            if n <= 0:
                continue
            simp = buf.value
            if simp != ch and len(simp) == 1 and simp in glyph_map:
                pairs.append(ch + simp)
        return "".join(pairs)

    try:
        from opencc import OpenCC  # type: ignore
    except Exception as exc:
        if allow_empty:
            return ""
        raise RuntimeError(
            "Traditional->Simplified mapping requires Windows LCMapStringEx or OpenCC off-Windows (pass --allow-empty-t2s to skip)."
        ) from exc

    cc = OpenCC("t2s")
    pairs = []
    for cp in range(0x4E00, 0xA000):
        ch = chr(cp)
        if ch in glyph_map:
            continue
        simp = cc.convert(ch)
        if simp != ch and len(simp) == 1 and simp in glyph_map:
            pairs.append(ch + simp)
    return "".join(pairs)


def render_sdf_cell(ch: str, primary: ImageFont.FreeTypeFont, fallbacks: list[ImageFont.FreeTypeFont]) -> np.ndarray:
    if ch in ("", " ", "\u3000"):
        return np.zeros((CELL, CELL), dtype=np.uint8)

    scale = 2
    hi = CELL * scale
    img = Image.new("L", (hi, hi), 0)
    draw = ImageDraw.Draw(img)

    chosen = primary
    for f in [primary] + [fb for fb in fallbacks if fb is not None]:
        if _has_real_glyph(f, ch):
            chosen = f
            break

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

    inside = arr >= 0.5
    if not np.any(inside):
        return np.zeros((CELL, CELL), dtype=np.uint8)

    dist_out = distance_transform_edt(~inside)
    dist_in = distance_transform_edt(inside)
    signed_dist = np.where(inside, dist_in - 0.5, -(dist_out - 0.5)) / (SPREAD_PX * scale)
    sdf_hi = np.clip(0.5 + 0.5 * signed_dist, 0.0, 1.0)
    sdf_hi[:2, :] = np.minimum(sdf_hi[:2, :], 0.25)
    sdf_hi[-2:, :] = np.minimum(sdf_hi[-2:, :], 0.25)
    sdf_hi[:, :2] = np.minimum(sdf_hi[:, :2], 0.25)
    sdf_hi[:, -2:] = np.minimum(sdf_hi[:, -2:], 0.25)

    sdf_img = Image.fromarray(np.round(sdf_hi * 255.0).astype(np.uint8), mode="L").resize(
        (CELL, CELL), Image.Resampling.BILINEAR
    )
    return np.asarray(sdf_img, dtype=np.uint8)


def build_layout(primary: ImageFont.FreeTypeFont, fallbacks: list[ImageFont.FreeTypeFont]):
    all_fonts = [primary] + [f for f in fallbacks if f is not None]

    def can_render(ch: str) -> bool:
        return any(_has_real_glyph(f, ch) for f in all_fonts)

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

    if len(tier0) > 30:
        tier1 = tier0[30:] + tier1
        tier0 = tier0[:30]
    if len(tier1) > 64:
        tier2 = tier1[64:] + tier2
        tier1 = tier1[:64]
    if len(tier2) > 32:
        wide_ascii = tier2[32:] + wide_ascii
        tier2 = tier2[:32]

    punct = [
        ch
        for ch in (
            "，。！？、；：“”‘’（）《》【】「」『』…—～·￥×÷±％℃°"
            "★☆♡♥♪♫♬•●○◎◇◆■△▲▽▼※→←↑↓↔✓✕〈〉〔〕〖〗"
        )
        if can_render(ch)
    ]
    hiragana = [chr(c) for c in range(0x3041, 0x3094)] + ["ー", "ゝ", "ゞ"]
    katakana = [chr(c) for c in range(0x30A1, 0x30F7)] + ["ヵ", "ヶ"]
    colloquial_acg = [
        ch
        for ch in (
            "嗯唔呃嘛呐喵哒诶嘞啰咩咦哟咋咱俩呸嘿嘻噢喔嗷蹭戳摸捏哼唧"
            "啵咪咻嘟呀哈哇哦嗨"
            "冇嘢咗嘅嗰啲喺嚟睇瞓佢咁哋噉嗮啫喎噃㗎"
            "囧宅萌酱桑尬氪炫飒齁玥喆昇旻昱晟晖晞曜曦煜炜熠烨焓燊珺璇嫕"
            "妳牠祂犇猋骉鱻龘槑尛奣昍嘂祎祺祯祥禧祐镕堃垚翀"
        )
        if can_render(ch)
    ]

    gb_l1, gb_l2 = gb2312_chars()
    ja_ranked = [c for c in load_ja_kanji_ranked() if can_render(c)]
    zh_extra = [c for c in load_zh_bank_cjk() if can_render(c)]

    tier3: list[str] = []
    seen = set(["", " ", "\u25a1", "\u3000"] + tier0 + tier1 + tier2)

    def push_unique(seq):
        for ch in seq:
            if len(tier3) >= BUILTIN_FULLWIDTH_SLOTS:
                break
            if ch not in seen:
                seen.add(ch)
                tier3.append(ch)

    tier3.append("\u25a1")  # id 128: fallback box □
    tier3.append("\u3000")  # id 129: fullwidth space
    push_unique(wide_ascii)
    push_unique(punct)
    push_unique(hiragana)
    push_unique(katakana)
    push_unique(colloquial_acg)
    push_unique(gb_l1)
    push_unique(gb_l2)
    push_unique(ja_ranked)
    push_unique(zh_extra)

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
    # Tier 3: ids 128..8127 (1.00, rows 2..126; row 127 reserved for 64 custom glyphs)
    assert len(tier3) <= BUILTIN_FULLWIDTH_SLOTS, f"tier3 overflow: {len(tier3)}"
    for i, ch in enumerate(tier3):
        slots.append((128 + i, ch, 1.00))

    return slots


def parse_args():
    parser = argparse.ArgumentParser(description="Generate dual-page 4096x4096 SDF glyph atlas and JSON index.")
    parser.add_argument("--out-json", type=Path, default=DEFAULT_OUT_JSON)
    parser.add_argument("--out-png", type=Path, default=DEFAULT_OUT_PNG_P0)
    parser.add_argument("--out-png-p1", type=Path, default=DEFAULT_OUT_PNG_P1)
    parser.add_argument("--font-primary", default=DEFAULT_NOTO)
    parser.add_argument("--font-msyh", default=DEFAULT_MSYH)
    parser.add_argument("--font-yugoth", default=DEFAULT_YUGOTH)
    parser.add_argument("--allow-empty-t2s", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    primary, msyh, yugoth = load_fonts(args.font_primary, args.font_msyh, args.font_yugoth)
    fallbacks = [msyh, yugoth]
    slots = build_layout(primary, fallbacks)

    atlas_p0 = np.zeros((ATLAS_SIZE, ATLAS_SIZE), dtype=np.uint8)
    atlas_p1 = np.zeros((ATLAS_SIZE, ATLAS_SIZE), dtype=np.uint8)
    glyph_map: dict[str, list[float]] = {}

    for idx, (gid, ch, adv) in enumerate(slots):
        col = gid % GRID
        row = gid // GRID
        if ch:
            cell_arr = render_sdf_cell(ch, primary, fallbacks)
            local_row = row % GRID
            y0 = local_row * CELL
            x0 = col * CELL
            target = atlas_p0 if row < GRID else atlas_p1
            target[y0 : y0 + CELL, x0 : x0 + CELL] = cell_arr
            glyph_map[ch] = [col, row, adv]
        if (idx + 1) % 1000 == 0 or (idx + 1) == len(slots):
            print(f"Rendered {idx + 1}/{len(slots)} glyphs...")

    t2s_pairs = build_t2s_pairs(glyph_map, allow_empty=args.allow_empty_t2s)

    args.out_png.parent.mkdir(parents=True, exist_ok=True)
    args.out_png_p1.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.parent.mkdir(parents=True, exist_ok=True)

    Image.fromarray(atlas_p0, mode="L").save(args.out_png, optimize=False)
    Image.fromarray(atlas_p1, mode="L").save(args.out_png_p1, optimize=False)

    payload = {
        "version": 2,
        "pages": PAGES,
        "grid": GRID,
        "rows": TOTAL_ROWS,
        "cellSize": CELL,
        "atlasSize": ATLAS_SIZE,
        "customRow": CUSTOM_ROW,
        "customCapacity": CUSTOM_CAPACITY,
        "fallback": [0, 2, 1.0],  # id 128 -> col=0, row=2 (□)
        "space": [1, 0, 0.36],
        "t2sPairs": t2s_pairs,
        "glyphs": glyph_map,
    }
    args.out_json.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"Done! Total glyphs={len(glyph_map)}, t2sPairs={len(t2s_pairs) // 2}, "
        f"P0={args.out_png} ({args.out_png.stat().st_size // 1024} KB), "
        f"P1={args.out_png_p1} ({args.out_png_p1.stat().st_size // 1024} KB), "
        f"JSON={args.out_json} ({args.out_json.stat().st_size // 1024} KB)"
    )


if __name__ == "__main__":
    main()
