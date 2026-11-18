#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.TextCore;
using UnityEngine.TextCore.LowLevel;

namespace EkacBubble.Editor
{
    public struct EkacGlyphEntry
    {
        public string Ch;
        public int Col;
        public int Row;
        public float Advance;
    }

    public struct EkacBubbleLayoutChunk
    {
        public string Text;
        public int Len;
        public int Line1Len;
        public int[] Cols;
        public int[] Rows;
    }

    public struct EkacFontBakeReport
    {
        public Texture2D Texture;
        public string OutputAssetPath;
        public int PrimaryRenderedCount;
        public int FallbackRenderedCount;
        public int MissingCount;
    }

    public static class EkacBubbleFontBaker
    {
        public const string GlyphIndexPath = EkacBubbleBuilder.RootDir + "/Data/EkacGlyphIndex.json";
        public const string CustomFontsDir = EkacBubbleBuilder.RootDir + "/Textures/CustomFonts";

        public const int AtlasSize = 4096;
        public const int Grid = 64;
        public const int Cell = 64;
        public const int DefaultPointSize = 40;
        public const int DefaultBaselineFromBottom = 17; // Matches 64 - 47 from generate-font-atlas.py
        public const int SdfSpreadPx = 8;

        public const int MaxCharsPerBubble = 24;
        public const float MaxLineAdvance = 12.0f;

        private static readonly HashSet<string> NoLineStart = new HashSet<string>
        {
            "，","。","！","？","、","；","：","”","’","）","》","】","」","』",
            ".","!","?",",",";",":",")","]","}","~","—","…","·"
        };

        private static readonly HashSet<string> NoLineEnd = new HashSet<string>
        {
            "“","‘","（","《","【","「","『","(","[","{"
        };

        private static Dictionary<string, EkacGlyphEntry> _cachedMap;
        private static List<EkacGlyphEntry> _cachedList;
        private static EkacGlyphEntry _fallbackEntry = new EkacGlyphEntry { Ch = "\u25a1", Col = 0, Row = 2, Advance = 1.0f };
        private static EkacGlyphEntry _spaceEntry = new EkacGlyphEntry { Ch = " ", Col = 1, Row = 0, Advance = 0.36f };

        public static void EnsureIndexLoaded(bool forceReload = false)
        {
            if (_cachedMap != null && _cachedList != null && !forceReload) return;

            string fullPath = Path.GetFullPath(GlyphIndexPath);
            if (!File.Exists(fullPath))
                throw new FileNotFoundException("Missing glyph index JSON at " + GlyphIndexPath, fullPath);

            string json = File.ReadAllText(fullPath, Encoding.UTF8);
            ParseGlyphIndexJson(json, out _cachedMap, out _cachedList, out _fallbackEntry, out _spaceEntry);
        }

        public static int LoadedGlyphCount
        {
            get
            {
                EnsureIndexLoaded();
                return _cachedList.Count;
            }
        }

        public static EkacGlyphEntry LookupGlyph(string ch)
        {
            EnsureIndexLoaded();
            if (ch == " ") return _spaceEntry;
            return _cachedMap.TryGetValue(ch, out var e) ? e : _fallbackEntry;
        }

        private static bool IsAsciiWordChar(string ch)
        {
            if (string.IsNullOrEmpty(ch) || ch.Length != 1) return false;
            char c = ch[0];
            return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '\'' || c == '-';
        }

        private struct LayoutAtom
        {
            public List<EkacGlyphEntry> Items;
            public float Advance;
            public bool IsNewline;
            public bool IsSpace;
        }

        public static List<EkacBubbleLayoutChunk> LayoutText(string text)
        {
            EnsureIndexLoaded();
            var chunks = new List<EkacBubbleLayoutChunk>();
            if (string.IsNullOrEmpty(text)) return chunks;

            // Split into Unicode code point strings
            var codePoints = new List<string>();
            for (int i = 0; i < text.Length; i++)
            {
                if (char.IsHighSurrogate(text[i]) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]))
                {
                    codePoints.Add(text.Substring(i, 2));
                    i++;
                }
                else
                {
                    codePoints.Add(text[i].ToString());
                }
            }

            // Tokenize matching vrc-bubble-layout.ts
            var atoms = new List<LayoutAtom>();
            int idx = 0;
            while (idx < codePoints.Count)
            {
                string ch = codePoints[idx];
                if (ch == "\r") { idx++; continue; }
                if (ch == "\n")
                {
                    atoms.Add(new LayoutAtom { Items = new List<EkacGlyphEntry>(), IsNewline = true });
                    idx++;
                    continue;
                }
                if (ch == " " || ch == "\t")
                {
                    var g = LookupGlyph(" ");
                    atoms.Add(new LayoutAtom { Items = new List<EkacGlyphEntry> { g }, Advance = g.Advance, IsSpace = true });
                    idx++;
                    continue;
                }
                if (IsAsciiWordChar(ch))
                {
                    int j = idx;
                    var items = new List<EkacGlyphEntry>();
                    float adv = 0f;
                    while (j < codePoints.Count && IsAsciiWordChar(codePoints[j]))
                    {
                        var g = LookupGlyph(codePoints[j]);
                        if (items.Count > 0 && adv + g.Advance > MaxLineAdvance) break;
                        items.Add(g);
                        adv += g.Advance;
                        j++;
                    }
                    atoms.Add(new LayoutAtom { Items = items, Advance = adv });
                    idx = j;
                    continue;
                }
                if (ch.Length == 1 && ch[0] < 0x20) { idx++; continue; }
                var ge = LookupGlyph(ch);
                atoms.Add(new LayoutAtom { Items = new List<EkacGlyphEntry> { ge }, Advance = ge.Advance });
                idx++;
            }

            int line = 0;
            var line0 = new List<EkacGlyphEntry>();
            var line1 = new List<EkacGlyphEntry>();
            float w0 = 0f, w1 = 0f;

            void Flush()
            {
                int total = line0.Count + line1.Count;
                if (total == 0) return;
                int l1Len = line1.Count > 0 ? line0.Count : total;
                var cols = new int[MaxCharsPerBubble];
                var rows = new int[MaxCharsPerBubble];
                var sb = new StringBuilder();
                int p = 0;
                foreach (var it in line0)
                {
                    if (p >= MaxCharsPerBubble) break;
                    cols[p] = it.Col;
                    rows[p] = it.Row;
                    sb.Append(it.Ch);
                    p++;
                }
                foreach (var it in line1)
                {
                    if (p >= MaxCharsPerBubble) break;
                    cols[p] = it.Col;
                    rows[p] = it.Row;
                    sb.Append(it.Ch);
                    p++;
                }
                chunks.Add(new EkacBubbleLayoutChunk
                {
                    Text = sb.ToString(),
                    Len = Mathf.Min(total, MaxCharsPerBubble),
                    Line1Len = Mathf.Min(l1Len, MaxCharsPerBubble),
                    Cols = cols,
                    Rows = rows,
                });
                line = 0;
                line0.Clear();
                line1.Clear();
                w0 = 0f;
                w1 = 0f;
            }

            foreach (var atom in atoms)
            {
                if (atom.IsNewline)
                {
                    if (line == 0 && line0.Count > 0) line = 1;
                    else if (line == 1 && (line0.Count > 0 || line1.Count > 0)) Flush();
                    continue;
                }

                int totalNow = line0.Count + line1.Count;
                if (line == 0)
                {
                    if (atom.IsSpace && line0.Count == 0) continue;
                    if (line0.Count + atom.Items.Count <= MaxCharsPerBubble && w0 + atom.Advance <= MaxLineAdvance + 1e-4f)
                    {
                        line0.AddRange(atom.Items);
                        w0 += atom.Advance;
                        continue;
                    }

                    if (atom.Items.Count == 1 && NoLineStart.Contains(atom.Items[0].Ch) &&
                        line0.Count >= 2 && line0.Count + atom.Items.Count <= MaxCharsPerBubble)
                    {
                        var last = line0[line0.Count - 1];
                        if (!NoLineEnd.Contains(last.Ch) && !IsAsciiWordChar(last.Ch) &&
                            last.Advance + atom.Advance <= MaxLineAdvance + 1e-4f)
                        {
                            line0.RemoveAt(line0.Count - 1);
                            w0 -= last.Advance;
                            line = 1;
                            line1.Add(last);
                            line1.AddRange(atom.Items);
                            w1 += last.Advance + atom.Advance;
                            continue;
                        }
                    }

                    if (line0.Count >= 2 && NoLineEnd.Contains(line0[line0.Count - 1].Ch))
                    {
                        var last = line0[line0.Count - 1];
                        if (atom.IsSpace)
                        {
                            line0.RemoveAt(line0.Count - 1);
                            w0 -= last.Advance;
                            line = 1;
                            line1.Add(last);
                            w1 += last.Advance;
                            continue;
                        }
                        if (line0.Count + atom.Items.Count <= MaxCharsPerBubble && last.Advance + atom.Advance <= MaxLineAdvance + 1e-4f)
                        {
                            line0.RemoveAt(line0.Count - 1);
                            w0 -= last.Advance;
                            line = 1;
                            line1.Add(last);
                            line1.AddRange(atom.Items);
                            w1 += last.Advance + atom.Advance;
                            continue;
                        }
                        if (1 + atom.Items.Count <= MaxCharsPerBubble && last.Advance + atom.Advance <= MaxLineAdvance + 1e-4f)
                        {
                            line0.RemoveAt(line0.Count - 1);
                            w0 -= last.Advance;
                            Flush();
                            line0.Add(last);
                            line0.AddRange(atom.Items);
                            w0 += last.Advance + atom.Advance;
                            continue;
                        }
                    }

                    line = 1;
                    if (atom.IsSpace) continue;
                    if (line0.Count + line1.Count + atom.Items.Count <= MaxCharsPerBubble && w1 + atom.Advance <= MaxLineAdvance + 1e-4f)
                    {
                        line1.AddRange(atom.Items);
                        w1 += atom.Advance;
                        continue;
                    }
                    Flush();
                    line0.AddRange(atom.Items);
                    w0 += atom.Advance;
                    continue;
                }

                if (atom.IsSpace && line1.Count == 0) continue;
                if (totalNow + atom.Items.Count <= MaxCharsPerBubble && w1 + atom.Advance <= MaxLineAdvance + 1e-4f)
                {
                    line1.AddRange(atom.Items);
                    w1 += atom.Advance;
                    continue;
                }

                Flush();
                if (!atom.IsSpace)
                {
                    line0.AddRange(atom.Items);
                    w0 += atom.Advance;
                }
            }

            Flush();
            return chunks;
        }

        public static string ResolveFontFilePath(Font fontAsset)
        {
            if (fontAsset == null) return null;
            string assetPath = AssetDatabase.GetAssetPath(fontAsset);
            if (string.IsNullOrEmpty(assetPath)) return null;
            string full = Path.GetFullPath(assetPath);
            return File.Exists(full) ? full : null;
        }

        private static bool IsPureAscii(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            for (int i = 0; i < s.Length; i++)
            {
                if (s[i] > 127) return false;
            }
            return true;
        }

        private sealed class LoadedFontSession : IDisposable
        {
            private byte[] _fontBytes;
            private GCHandle _pinnedHandle;
            private string _asciiPath;
            private string _tempStagedFile;

            public static LoadedFontSession Open(string fullPath, int pointSize, out FontEngineError lastError)
            {
                lastError = FontEngineError.Invalid_File_Path;
                if (string.IsNullOrEmpty(fullPath) || !File.Exists(fullPath))
                    return null;

                // 1. Fast path for pure-ASCII paths (e.g. C:\Windows\Fonts\NotoSansSC-VF.ttf)
                if (IsPureAscii(fullPath))
                {
                    lastError = FontEngine.LoadFontFace(fullPath, pointSize);
                    if (lastError == FontEngineError.Success)
                    {
                        return new LoadedFontSession { _asciiPath = fullPath };
                    }
                }

                // 2. Unicode-safe in-memory path via .NET UTF-16 File.ReadAllBytes + FT_New_Memory_Face
                //    Fixes Windows Unity FontEngine.LoadFontFace(string) failing on Chinese/non-ASCII paths.
                try
                {
                    byte[] bytes = File.ReadAllBytes(fullPath);
                    if (bytes != null && bytes.Length > 0)
                    {
                        var handle = GCHandle.Alloc(bytes, GCHandleType.Pinned);
                        lastError = FontEngine.LoadFontFace(bytes, pointSize, 0);
                        if (lastError == FontEngineError.Success)
                        {
                            return new LoadedFontSession
                            {
                                _fontBytes = bytes,
                                _pinnedHandle = handle
                            };
                        }
                        if (handle.IsAllocated) handle.Free();
                    }
                }
                catch
                {
                    // Fall through to pure-ASCII file staging fallback
                }

                // 3. Fallback: stage to a guaranteed pure-ASCII directory (e.g. C:\ProgramData\EkacBubbleFontCache)
                try
                {
                    string baseDir = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
                    if (!IsPureAscii(baseDir))
                    {
                        string root = Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.Windows));
                        baseDir = string.IsNullOrEmpty(root) ? "C:\\" : root;
                    }
                    string cacheDir = Path.Combine(baseDir, "EkacBubbleFontCache");
                    if (IsPureAscii(cacheDir))
                    {
                        Directory.CreateDirectory(cacheDir);
                        string ext = Path.GetExtension(fullPath);
                        if (string.IsNullOrEmpty(ext) || !IsPureAscii(ext)) ext = ".ttf";
                        string staged = Path.Combine(cacheDir, $"face_{Guid.NewGuid():N}{ext}");
                        File.Copy(fullPath, staged, true);
                        lastError = FontEngine.LoadFontFace(staged, pointSize);
                        if (lastError == FontEngineError.Success)
                        {
                            return new LoadedFontSession
                            {
                                _asciiPath = staged,
                                _tempStagedFile = staged
                            };
                        }
                        try { File.Delete(staged); } catch { }
                    }
                }
                catch
                {
                    // Ignore staging error; caller handles null session + lastError
                }

                return null;
            }

            public bool Rebind(int pointSize)
            {
                try { FontEngine.UnloadFontFace(); } catch { }
                FontEngineError err = _fontBytes != null
                    ? FontEngine.LoadFontFace(_fontBytes, pointSize, 0)
                    : FontEngine.LoadFontFace(_asciiPath, pointSize);
                if (err != FontEngineError.Success)
                    return false;
                FontEngine.SetFaceSize(pointSize);
                return true;
            }

            public void Dispose()
            {
                try { FontEngine.UnloadFontFace(); } catch { }
                if (_pinnedHandle.IsAllocated)
                {
                    _pinnedHandle.Free();
                }
                if (_fontBytes != null)
                {
                    GC.KeepAlive(_fontBytes);
                    _fontBytes = null;
                }
                if (!string.IsNullOrEmpty(_tempStagedFile))
                {
                    try { if (File.Exists(_tempStagedFile)) File.Delete(_tempStagedFile); } catch { }
                    _tempStagedFile = null;
                }
            }
        }

        public static Texture2D BakeFontAtlas(
            string primaryFontPath,
            string outputAssetPath = null,
            int pointSize = DefaultPointSize,
            int baselineOffset = 0,
            string customFallbackFontPath = null,
            bool showProgressBar = false)
        {
            return BakeFontAtlas(
                primaryFontPath,
                out _,
                outputAssetPath,
                pointSize,
                baselineOffset,
                customFallbackFontPath,
                showProgressBar
            );
        }

        public static Texture2D BakeFontAtlas(
            string primaryFontPath,
            out EkacFontBakeReport report,
            string outputAssetPath = null,
            int pointSize = DefaultPointSize,
            int baselineOffset = 0,
            string customFallbackFontPath = null,
            bool showProgressBar = false)
        {
            report = default;
            if (string.IsNullOrEmpty(primaryFontPath) || !File.Exists(primaryFontPath))
                throw new FileNotFoundException("找不到所选主字体文件：" + primaryFontPath);

            EnsureIndexLoaded();
            pointSize = Mathf.Clamp(pointSize, 20, 56);

            string fullPrimaryPath = Path.GetFullPath(primaryFontPath);
            if (string.IsNullOrEmpty(outputAssetPath))
            {
                EnsureAssetDir(CustomFontsDir);
                string safeName = SanitizeFileName(Path.GetFileNameWithoutExtension(fullPrimaryPath));
                outputAssetPath = $"{CustomFontsDir}/{safeName}_SDF.png";
            }
            else
            {
                string parentDir = Path.GetDirectoryName(outputAssetPath)?.Replace('\\', '/');
                if (!string.IsNullOrEmpty(parentDir)) EnsureAssetDir(parentDir);
            }

            // Build deduplicated font cascade (index 0 is ALWAYS primaryFontPath)
            var fontPaths = new List<string> { fullPrimaryPath };
            void AddCandidate(string fp)
            {
                if (string.IsNullOrEmpty(fp) || !File.Exists(fp)) return;
                string full = Path.GetFullPath(fp);
                foreach (var ex in fontPaths)
                {
                    if (string.Equals(ex, full, StringComparison.OrdinalIgnoreCase)) return;
                }
                fontPaths.Add(full);
            }

            AddCandidate(customFallbackFontPath);
            string winFonts = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Fonts");
            AddCandidate(Path.Combine(winFonts, "NotoSansSC-VF.ttf"));
            AddCandidate(Path.Combine(winFonts, "msyh.ttc"));
            AddCandidate(Path.Combine(winFonts, "YuGothM.ttc"));
            AddCandidate(Path.Combine(winFonts, "simhei.ttf"));

            MethodInfo packBatchMethod = typeof(FontEngine).GetMethod(
                "TryPackGlyphsInAtlas",
                BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public,
                null,
                new[]
                {
                    typeof(List<Glyph>),
                    typeof(List<Glyph>),
                    typeof(int),
                    typeof(GlyphPackingMode),
                    typeof(GlyphRenderMode),
                    typeof(int),
                    typeof(int),
                    typeof(List<GlyphRect>),
                    typeof(List<GlyphRect>)
                },
                null
            );

            MethodInfo renderBatchMethod = typeof(FontEngine).GetMethod(
                "RenderGlyphsToTexture",
                BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public,
                null,
                new[] { typeof(List<Glyph>), typeof(int), typeof(GlyphRenderMode), typeof(byte[]), typeof(int), typeof(int) },
                null
            );
            if (packBatchMethod == null || renderBatchMethod == null)
                throw new MissingMethodException("UnityEngine.TextCore.LowLevel.FontEngine batch SDF methods not found.");

            var err = FontEngine.InitializeFontEngine();
            if (err != FontEngineError.Success)
                throw new Exception("Failed to initialize Unity FontEngine: " + err);

            var outColors = new Color32[AtlasSize * AtlasSize];
            var remaining = new List<EkacGlyphEntry>(_cachedList.Count);
            foreach (var ge in _cachedList)
            {
                if (string.IsNullOrEmpty(ge.Ch) || ge.Ch == " " || ge.Ch == "\u3000") continue;
                remaining.Add(ge);
            }

            int primaryRendered = 0;
            int fallbackRendered = 0;
            try
            {
                const int PackDim = 4096;
                byte[] packBuffer = new byte[PackDim * PackDim];
                int baselineY = Mathf.Clamp(DefaultBaselineFromBottom + baselineOffset, 4, 58);
                const GlyphLoadFlags loadFlags = GlyphLoadFlags.LOAD_RENDER | GlyphLoadFlags.LOAD_NO_HINTING;

                for (int fi = 0; fi < fontPaths.Count && remaining.Count > 0; fi++)
                {
                    string fPath = fontPaths[fi];
                    bool isPrimary = (fi == 0);

                    using (var session = LoadedFontSession.Open(fPath, pointSize, out FontEngineError loadErr))
                    {
                        if (session == null)
                        {
                            if (isPrimary)
                            {
                                throw new InvalidOperationException(
                                    $"无法加载主字体文件「{Path.GetFileName(fPath)}」（错误码：{loadErr}）。请确认字体文件未损坏且格式为 .ttf / .otf / .ttc。"
                                );
                            }
                            continue;
                        }

                        uint notdefIdx = 0;
                        if (FontEngine.TryGetGlyphIndex(0xFFFFu, out uint nd1) && nd1 != 0)
                            notdefIdx = nd1;
                        else if (FontEngine.TryGetGlyphIndex(0xFFFEu, out uint nd2) && nd2 != 0)
                            notdefIdx = nd2;

                        var byGlyphIdx = new Dictionary<uint, List<EkacGlyphEntry>>();
                        foreach (var ge in remaining)
                        {
                            uint cp = (uint)char.ConvertToUtf32(ge.Ch, 0);
                            if (FontEngine.TryGetGlyphIndex(cp, out uint gIdx) && gIdx != 0 && (notdefIdx == 0 || gIdx != notdefIdx))
                            {
                                if (!byGlyphIdx.TryGetValue(gIdx, out var list))
                                {
                                    list = new List<EkacGlyphEntry>();
                                    byGlyphIdx[gIdx] = list;
                                }
                                list.Add(ge);
                            }
                        }

                        var renderedCellKeys = new HashSet<int>();
                        if (byGlyphIdx.Count > 0)
                        {
                            var uniqueGlyphIds = new List<uint>(byGlyphIdx.Keys);
                            const int BatchCap = 2048;

                            for (int offset = 0; offset < uniqueGlyphIds.Count; offset += BatchCap)
                            {
                                // Re-bind font face & size before each batch because RenderGlyphsToTexture resets internal face state
                                if (!session.Rebind(pointSize))
                                    break;

                                int count = Mathf.Min(BatchCap, uniqueGlyphIds.Count - offset);
                                if (showProgressBar)
                                {
                                    EditorUtility.DisplayProgressBar(
                                        "烘焙 SDF 字库贴图",
                                        $"正在渲染 {Path.GetFileName(fPath)} ({offset + count}/{uniqueGlyphIds.Count})...",
                                        (float)(offset + count) / Mathf.Max(1, uniqueGlyphIds.Count)
                                    );
                                }

                                var pendingToPack = new List<Glyph>(count);
                                for (int bi = 0; bi < count; bi++)
                                {
                                    uint gIdx = uniqueGlyphIds[offset + bi];
                                    if (!FontEngine.TryGetGlyphWithIndexValue(gIdx, loadFlags, out Glyph glyph))
                                        continue;
                                    if (glyph.glyphRect.width <= 0 || glyph.glyphRect.height <= 0)
                                        continue;
                                    pendingToPack.Add(glyph);
                                }

                                while (pendingToPack.Count > 0)
                                {
                                    if (!session.Rebind(pointSize))
                                        break;

                                    var glyphsToPack = new List<Glyph>(pendingToPack);
                                    var glyphsPacked = new List<Glyph>(pendingToPack.Count);
                                    var freeRects = new List<GlyphRect> { new GlyphRect(0, 0, PackDim - 1, PackDim - 1) };
                                    var usedRects = new List<GlyphRect>(pendingToPack.Count);

                                    packBatchMethod.Invoke(null, new object[]
                                    {
                                        glyphsToPack,
                                        glyphsPacked,
                                        SdfSpreadPx,
                                        GlyphPackingMode.BestShortSideFit,
                                        GlyphRenderMode.SDF16,
                                        PackDim,
                                        PackDim,
                                        freeRects,
                                        usedRects
                                    });

                                    if (glyphsPacked.Count == 0) break;

                                    if (glyphsPacked.Count < pendingToPack.Count)
                                    {
                                        var packedSet = new HashSet<uint>();
                                        foreach (var pg in glyphsPacked) packedSet.Add(pg.index);
                                        var leftover = new List<Glyph>(pendingToPack.Count - glyphsPacked.Count);
                                        foreach (var item in pendingToPack)
                                        {
                                            if (!packedSet.Contains(item.index))
                                                leftover.Add(item);
                                        }
                                        pendingToPack = leftover;
                                    }
                                    else
                                    {
                                        pendingToPack.Clear();
                                    }

                                    Array.Clear(packBuffer, 0, packBuffer.Length);
                                    renderBatchMethod.Invoke(null, new object[]
                                    {
                                        glyphsPacked,
                                        SdfSpreadPx,
                                        GlyphRenderMode.SDF16,
                                        packBuffer,
                                        PackDim,
                                        PackDim
                                    });

                                    // Blit each rendered SDF glyph patch (with its SdfSpreadPx halo) centered onto its target 64x64 cell
                                    foreach (var glyph in glyphsPacked)
                                    {
                                        if (!byGlyphIdx.TryGetValue(glyph.index, out var targets))
                                            continue;

                                        int rx = glyph.glyphRect.x;
                                        int ry = glyph.glyphRect.y;
                                        int rw = glyph.glyphRect.width;
                                        int rh = glyph.glyphRect.height;

                                        int dstInkX = Mathf.RoundToInt(32f - 0.5f * glyph.metrics.horizontalAdvance + glyph.metrics.horizontalBearingX);
                                        int dstInkY = Mathf.RoundToInt(baselineY + glyph.metrics.horizontalBearingY - glyph.metrics.height);

                                        int srcMinX = Mathf.Max(0, rx - SdfSpreadPx);
                                        int srcMaxX = Mathf.Min(PackDim - 1, rx + rw + SdfSpreadPx - 1);
                                        int srcMinY = Mathf.Max(0, ry - SdfSpreadPx);
                                        int srcMaxY = Mathf.Min(PackDim - 1, ry + rh + SdfSpreadPx - 1);

                                        foreach (var ge in targets)
                                        {
                                            int cellKey = ge.Row * Grid + ge.Col;
                                            if (renderedCellKeys.Add(cellKey))
                                            {
                                                if (isPrimary) primaryRendered++;
                                                else fallbackRendered++;
                                            }

                                            int dstBaseX = ge.Col * Cell;
                                            int dstBaseY = (Grid - 1 - ge.Row) * Cell;

                                            for (int cy = 0; cy < Cell; cy++)
                                            {
                                                int sy = ry + (cy - dstInkY);
                                                int dstRowOff = (dstBaseY + cy) * AtlasSize + dstBaseX;
                                                if (sy < srcMinY || sy > srcMaxY)
                                                    continue;

                                                int srcRowOff = sy * PackDim;
                                                bool borderY = (cy == 0 || cy == Cell - 1);

                                                for (int cx = 0; cx < Cell; cx++)
                                                {
                                                    int sx = rx + (cx - dstInkX);
                                                    if (sx < srcMinX || sx > srcMaxX)
                                                        continue;

                                                    byte val = packBuffer[srcRowOff + sx];
                                                    if (borderY || cx == 0 || cx == Cell - 1)
                                                    {
                                                        if (val > 64) val = 64; // Prevent cross-cell mip bleed
                                                    }
                                                    outColors[dstRowOff + cx] = new Color32(val, val, val, val);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if (isPrimary && primaryRendered == 0)
                        {
                            throw new InvalidOperationException(
                                $"所选主字体「{Path.GetFileName(fPath)}」未能成功渲染任何有效字形（可能是纯图标字体或不包含常用中英文字符）。"
                            );
                        }

                        if (renderedCellKeys.Count > 0)
                        {
                            var stillMissing = new List<EkacGlyphEntry>(Mathf.Max(0, remaining.Count - renderedCellKeys.Count));
                            foreach (var ge in remaining)
                            {
                                if (!renderedCellKeys.Contains(ge.Row * Grid + ge.Col))
                                    stillMissing.Add(ge);
                            }
                            remaining = stillMissing;
                        }
                    }
                }
            }
            finally
            {
                if (showProgressBar) EditorUtility.ClearProgressBar();
            }

            var tex = new Texture2D(AtlasSize, AtlasSize, TextureFormat.R8, false, true);
            try
            {
                tex.SetPixels32(outColors);
                tex.Apply(false, false);
                byte[] pngBytes = tex.EncodeToPNG();
                string diskOutPath = Path.GetFullPath(outputAssetPath);
                string diskDir = Path.GetDirectoryName(diskOutPath);
                if (!string.IsNullOrEmpty(diskDir)) Directory.CreateDirectory(diskDir);
                File.WriteAllBytes(diskOutPath, pngBytes);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(tex);
            }

            ConfigureSdfTextureAsset(outputAssetPath);
            var imported = AssetDatabase.LoadAssetAtPath<Texture2D>(outputAssetPath);
            report = new EkacFontBakeReport
            {
                Texture = imported,
                OutputAssetPath = outputAssetPath,
                PrimaryRenderedCount = primaryRendered,
                FallbackRenderedCount = fallbackRendered,
                MissingCount = remaining.Count
            };
            Debug.Log(
                $"[EkacBubble] Baked custom SDF font atlas: {outputAssetPath} " +
                $"(primary={primaryRendered}, fallback={fallbackRendered}, unmatched={remaining.Count})"
            );
            return imported;
        }

        public static void ConfigureSdfTextureAsset(string assetPath)
        {
            AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceUpdate);
            var importer = AssetImporter.GetAtPath(assetPath) as TextureImporter;
            if (importer == null)
                throw new Exception("Failed to load TextureImporter at " + assetPath);

            importer.textureType = TextureImporterType.SingleChannel;
            importer.sRGBTexture = false;
            importer.alphaSource = TextureImporterAlphaSource.None;
            importer.mipmapEnabled = true;
            importer.streamingMipmaps = true;
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.filterMode = FilterMode.Bilinear;
            importer.maxTextureSize = AtlasSize;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;

            var def = importer.GetDefaultPlatformTextureSettings();
            def.maxTextureSize = AtlasSize;
            def.textureCompression = TextureImporterCompression.CompressedHQ;
            importer.SetPlatformTextureSettings(def);

            var standalone = importer.GetPlatformTextureSettings("Standalone");
            standalone.overridden = true;
            standalone.maxTextureSize = AtlasSize;
            standalone.format = TextureImporterFormat.BC4;
            importer.SetPlatformTextureSettings(standalone);

            importer.SaveAndReimport();
        }

        private static string SanitizeFileName(string raw)
        {
            var sb = new StringBuilder();
            foreach (char c in raw)
            {
                if (Array.IndexOf(Path.GetInvalidFileNameChars(), c) >= 0 || c == ' ')
                    sb.Append('_');
                else
                    sb.Append(c);
            }
            return sb.Length > 0 ? sb.ToString() : "CustomFont";
        }

        private static void EnsureAssetDir(string assetDir)
        {
            string[] parts = assetDir.Split('/');
            string cur = parts[0];
            for (int i = 1; i < parts.Length; i++)
            {
                string next = cur + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next))
                    AssetDatabase.CreateFolder(cur, parts[i]);
                cur = next;
            }
        }

        // Minimal self-contained JSON parser for EkacGlyphIndex.json (zero external package dependency)
        private static void ParseGlyphIndexJson(
            string json,
            out Dictionary<string, EkacGlyphEntry> map,
            out List<EkacGlyphEntry> list,
            out EkacGlyphEntry fallback,
            out EkacGlyphEntry space)
        {
            map = new Dictionary<string, EkacGlyphEntry>(4200);
            list = new List<EkacGlyphEntry>(4200);
            fallback = new EkacGlyphEntry { Ch = "\u25a1", Col = 0, Row = 2, Advance = 1.0f };
            space = new EkacGlyphEntry { Ch = " ", Col = 1, Row = 0, Advance = 0.36f };

            int i = 0;
            int n = json.Length;

            void SkipWs()
            {
                while (i < n && char.IsWhiteSpace(json[i])) i++;
            }

            string ReadString()
            {
                SkipWs();
                if (i >= n || json[i] != '"') throw new FormatException($"Expected '\"' at {i}");
                i++;
                var sb = new StringBuilder();
                while (i < n)
                {
                    char c = json[i++];
                    if (c == '"') return sb.ToString();
                    if (c == '\\')
                    {
                        if (i >= n) break;
                        char esc = json[i++];
                        switch (esc)
                        {
                            case '"': sb.Append('"'); break;
                            case '\\': sb.Append('\\'); break;
                            case '/': sb.Append('/'); break;
                            case 'b': sb.Append('\b'); break;
                            case 'f': sb.Append('\f'); break;
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case 'u':
                                string hex = json.Substring(i, 4);
                                i += 4;
                                sb.Append((char)Convert.ToInt32(hex, 16));
                                break;
                            default: sb.Append(esc); break;
                        }
                    }
                    else
                    {
                        sb.Append(c);
                    }
                }
                throw new FormatException("Unterminated string in EkacGlyphIndex.json");
            }

            float ReadNumber()
            {
                SkipWs();
                int start = i;
                while (i < n && (char.IsDigit(json[i]) || json[i] == '-' || json[i] == '+' || json[i] == '.' || json[i] == 'e' || json[i] == 'E'))
                    i++;
                return float.Parse(json.Substring(start, i - start), CultureInfo.InvariantCulture);
            }

            (int col, int row, float adv) ReadTriple()
            {
                SkipWs();
                if (json[i] != '[') throw new FormatException($"Expected '[' at {i}");
                i++;
                int col = Mathf.RoundToInt(ReadNumber());
                SkipWs(); if (json[i] == ',') i++;
                int row = Mathf.RoundToInt(ReadNumber());
                SkipWs(); if (json[i] == ',') i++;
                float adv = ReadNumber();
                SkipWs();
                if (json[i] != ']') throw new FormatException($"Expected ']' at {i}");
                i++;
                return (col, row, adv);
            }

            void SkipValue()
            {
                SkipWs();
                if (i >= n) return;
                char c = json[i];
                if (c == '"') { ReadString(); return; }
                if (c == '{' || c == '[')
                {
                    char open = c;
                    char close = (c == '{') ? '}' : ']';
                    int depth = 0;
                    while (i < n)
                    {
                        if (json[i] == '"') { ReadString(); continue; }
                        if (json[i] == open) depth++;
                        else if (json[i] == close)
                        {
                            depth--;
                            i++;
                            if (depth == 0) return;
                            continue;
                        }
                        i++;
                    }
                    return;
                }
                while (i < n && json[i] != ',' && json[i] != '}' && json[i] != ']') i++;
            }

            SkipWs();
            if (json[i] == '{') i++;
            while (i < n)
            {
                SkipWs();
                if (i >= n || json[i] == '}') break;
                if (json[i] == ',') { i++; continue; }

                string key = ReadString();
                SkipWs();
                if (json[i] == ':') i++;

                if (key == "fallback")
                {
                    var t = ReadTriple();
                    fallback = new EkacGlyphEntry { Ch = "\u25a1", Col = t.col, Row = t.row, Advance = t.adv };
                }
                else if (key == "space")
                {
                    var t = ReadTriple();
                    space = new EkacGlyphEntry { Ch = " ", Col = t.col, Row = t.row, Advance = t.adv };
                }
                else if (key == "glyphs")
                {
                    SkipWs();
                    if (json[i] == '{') i++;
                    while (i < n)
                    {
                        SkipWs();
                        if (json[i] == '}') { i++; break; }
                        if (json[i] == ',') { i++; continue; }
                        string gKey = ReadString();
                        SkipWs();
                        if (json[i] == ':') i++;
                        var t = ReadTriple();
                        var entry = new EkacGlyphEntry { Ch = gKey, Col = t.col, Row = t.row, Advance = t.adv };
                        map[gKey] = entry;
                        list.Add(entry);
                    }
                }
                else
                {
                    SkipValue();
                }
            }
        }
    }
}
#endif
