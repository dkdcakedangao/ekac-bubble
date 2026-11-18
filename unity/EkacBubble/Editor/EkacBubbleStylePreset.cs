#if UNITY_EDITOR
using System;
using UnityEditor;
using UnityEngine;

namespace EkacBubble.Editor
{
    public enum EkacBuiltInPreset
    {
        SakuraPink = 0,
        CyberNeon = 1,
        MinimalGlass = 2,
        RetroPixel = 3,
        MintWave = 4,
    }

    public class EkacBubbleStylePreset : ScriptableObject
    {
        public float frameMode = 0f;
        public Color bgColor = new Color(1.00f, 0.985f, 0.975f, 0.94f);
        public Color bgColor2 = new Color(0.985f, 0.94f, 0.955f, 0.94f);
        public float bgGradient = 0f;
        public Color borderColor = new Color(0.91f, 0.68f, 0.67f, 0.95f);
        public Color emissionColor = new Color(0f, 0f, 0f, 1f);
        public float emissionStrength = 0f;

        public Color shadowColor = new Color(0.14f, 0.10f, 0.12f, 0.18f);
        public float shadowOffsetX = 0f;
        public float shadowOffsetY = -0.06f;
        public float shadowSoftness = 0.18f;

        public float cornerRadius = 0.34f;
        public float borderWidth = 0.065f;
        public float padX = 0.56f;
        public float padY = 0.36f;
        public float lineHeight = 1.28f;
        public float bubbleGap = 0.34f;

        public float tailEnable = 1f;
        public float tailWidth = 0.22f;
        public float tailHeight = 0.24f;
        public float tailOffsetX = 0f;

        public Texture2D skinTex;
        public Color skinTint = Color.white;
        public Vector4 skinSlice = new Vector4(0.25f, 0.25f, 0.25f, 0.25f);
        public float skinBorderEm = 0.55f;

        public float badgeEnable = 0f;
        public Texture2D badgeTex;
        public Color badgeTint = Color.white;
        public float badgeCorner = 1f;
        public float badgeSize = 0.85f;
        public float badgeOffsetX = 0.10f;
        public float badgeOffsetY = 0.15f;
        public float badgeSlot0Only = 1f;

        public Color textColor = new Color(0.18f, 0.14f, 0.16f, 1.00f);
        public Color textColor2 = new Color(0.36f, 0.22f, 0.30f, 1.00f);
        public float textGradient = 0f;
        public float textWeight = 0f;
        public float textItalic = 0f;
        public float textOutlineWidth = 0f;
        public Color textOutlineColor = Color.white;
        public float textShadowEnable = 0f;
        public Color textShadowColor = new Color(0f, 0f, 0f, 0.45f);
        public float textShadowOffsetX = 0.025f;
        public float textShadowOffsetY = -0.025f;
        public float textShadowSoftness = 0.04f;
        public float popOffsetY = -0.08f;
        public float popScale = 1.0f;
        public float waveAmp = 0f;
        public float waveFreq = 0.9f;
        public float waveSpeed = 4.5f;

        public Texture2D atlasTex;

        public void CaptureFromMaterial(Material mat)
        {
            if (mat == null) return;
            frameMode = mat.GetFloat("_FrameMode");
            bgColor = mat.GetColor("_BgColor");
            bgColor2 = mat.GetColor("_BgColor2");
            bgGradient = mat.GetFloat("_BgGradient");
            borderColor = mat.GetColor("_BorderColor");
            emissionColor = mat.GetColor("_EmissionColor");
            emissionStrength = mat.GetFloat("_EmissionStrength");

            shadowColor = mat.GetColor("_ShadowColor");
            shadowOffsetX = mat.GetFloat("_ShadowOffsetX");
            shadowOffsetY = mat.GetFloat("_ShadowOffsetY");
            shadowSoftness = mat.GetFloat("_ShadowSoftness");

            cornerRadius = mat.GetFloat("_CornerRadius");
            borderWidth = mat.GetFloat("_BorderWidth");
            padX = mat.GetFloat("_PadX");
            padY = mat.GetFloat("_PadY");
            lineHeight = mat.GetFloat("_LineHeight");
            bubbleGap = mat.GetFloat("_BubbleGap");

            tailEnable = mat.GetFloat("_TailEnable");
            tailWidth = mat.GetFloat("_TailWidth");
            tailHeight = mat.GetFloat("_TailHeight");
            tailOffsetX = mat.GetFloat("_TailOffsetX");

            skinTex = mat.GetTexture("_SkinTex") as Texture2D;
            skinTint = mat.GetColor("_SkinTint");
            skinSlice = mat.GetVector("_SkinSlice");
            skinBorderEm = mat.GetFloat("_SkinBorderEm");

            badgeEnable = mat.GetFloat("_BadgeEnable");
            badgeTex = mat.GetTexture("_BadgeTex") as Texture2D;
            badgeTint = mat.GetColor("_BadgeTint");
            badgeCorner = mat.GetFloat("_BadgeCorner");
            badgeSize = mat.GetFloat("_BadgeSize");
            badgeOffsetX = mat.GetFloat("_BadgeOffsetX");
            badgeOffsetY = mat.GetFloat("_BadgeOffsetY");
            badgeSlot0Only = mat.GetFloat("_BadgeSlot0Only");

            textColor = mat.GetColor("_TextColor");
            textColor2 = mat.GetColor("_TextColor2");
            textGradient = mat.GetFloat("_TextGradient");
            textWeight = mat.GetFloat("_TextWeight");
            textItalic = mat.GetFloat("_TextItalic");
            textOutlineWidth = mat.GetFloat("_TextOutlineWidth");
            textOutlineColor = mat.GetColor("_TextOutlineColor");
            textShadowEnable = mat.GetFloat("_TextShadowEnable");
            textShadowColor = mat.GetColor("_TextShadowColor");
            textShadowOffsetX = mat.GetFloat("_TextShadowOffsetX");
            textShadowOffsetY = mat.GetFloat("_TextShadowOffsetY");
            textShadowSoftness = mat.GetFloat("_TextShadowSoftness");
            popOffsetY = mat.GetFloat("_PopOffsetY");
            popScale = mat.GetFloat("_PopScale");
            waveAmp = mat.GetFloat("_WaveAmp");
            waveFreq = mat.GetFloat("_WaveFreq");
            waveSpeed = mat.GetFloat("_WaveSpeed");

            atlasTex = mat.GetTexture("_AtlasTex") as Texture2D;
        }

        public void ApplyToMaterial(Material mat, bool recordUndo = true)
        {
            if (mat == null) return;
            if (recordUndo) Undo.RecordObject(mat, "Apply EkacBubble Style Preset");

            mat.SetFloat("_FrameMode", frameMode);
            mat.SetColor("_BgColor", bgColor);
            mat.SetColor("_BgColor2", bgColor2);
            mat.SetFloat("_BgGradient", bgGradient);
            mat.SetColor("_BorderColor", borderColor);
            mat.SetColor("_EmissionColor", emissionColor);
            mat.SetFloat("_EmissionStrength", emissionStrength);

            mat.SetColor("_ShadowColor", shadowColor);
            mat.SetFloat("_ShadowOffsetX", shadowOffsetX);
            mat.SetFloat("_ShadowOffsetY", shadowOffsetY);
            mat.SetFloat("_ShadowSoftness", shadowSoftness);

            mat.SetFloat("_CornerRadius", cornerRadius);
            mat.SetFloat("_BorderWidth", borderWidth);
            mat.SetFloat("_PadX", padX);
            mat.SetFloat("_PadY", padY);
            mat.SetFloat("_LineHeight", lineHeight);
            mat.SetFloat("_BubbleGap", bubbleGap);

            mat.SetFloat("_TailEnable", tailEnable);
            mat.SetFloat("_TailWidth", tailWidth);
            mat.SetFloat("_TailHeight", tailHeight);
            mat.SetFloat("_TailOffsetX", tailOffsetX);

            mat.SetTexture("_SkinTex", skinTex);
            mat.SetColor("_SkinTint", skinTint);
            mat.SetVector("_SkinSlice", skinSlice);
            mat.SetFloat("_SkinBorderEm", skinBorderEm);

            mat.SetFloat("_BadgeEnable", badgeEnable);
            mat.SetTexture("_BadgeTex", badgeTex);
            mat.SetColor("_BadgeTint", badgeTint);
            mat.SetFloat("_BadgeCorner", badgeCorner);
            mat.SetFloat("_BadgeSize", badgeSize);
            mat.SetFloat("_BadgeOffsetX", badgeOffsetX);
            mat.SetFloat("_BadgeOffsetY", badgeOffsetY);
            mat.SetFloat("_BadgeSlot0Only", badgeSlot0Only);

            mat.SetColor("_TextColor", textColor);
            mat.SetColor("_TextColor2", textColor2);
            mat.SetFloat("_TextGradient", textGradient);
            mat.SetFloat("_TextWeight", textWeight);
            mat.SetFloat("_TextItalic", textItalic);
            mat.SetFloat("_TextOutlineWidth", textOutlineWidth);
            mat.SetColor("_TextOutlineColor", textOutlineColor);
            mat.SetFloat("_TextShadowEnable", textShadowEnable);
            mat.SetColor("_TextShadowColor", textShadowColor);
            mat.SetFloat("_TextShadowOffsetX", textShadowOffsetX);
            mat.SetFloat("_TextShadowOffsetY", textShadowOffsetY);
            mat.SetFloat("_TextShadowSoftness", textShadowSoftness);
            mat.SetFloat("_PopOffsetY", popOffsetY);
            mat.SetFloat("_PopScale", popScale);
            mat.SetFloat("_WaveAmp", waveAmp);
            mat.SetFloat("_WaveFreq", waveFreq);
            mat.SetFloat("_WaveSpeed", waveSpeed);

            if (atlasTex != null) mat.SetTexture("_AtlasTex", atlasTex);

            EditorUtility.SetDirty(mat);
            SceneView.RepaintAll();
        }

        public static void ApplyBuiltInPreset(Material mat, EkacBuiltInPreset preset, bool recordUndo = true)
        {
            if (mat == null) return;
            var temp = CreateInstance<EkacBubbleStylePreset>();
            try
            {
                // Keep user's current textures unless explicitly switching frameMode
                temp.atlasTex = mat.GetTexture("_AtlasTex") as Texture2D;
                temp.skinTex = mat.GetTexture("_SkinTex") as Texture2D;
                temp.badgeTex = mat.GetTexture("_BadgeTex") as Texture2D;

                switch (preset)
                {
                    case EkacBuiltInPreset.SakuraPink:
                        // Default warm sakura pink
                        temp.bgColor = new Color(1.00f, 0.985f, 0.975f, 0.94f);
                        temp.bgColor2 = new Color(0.99f, 0.93f, 0.95f, 0.94f);
                        temp.bgGradient = 0.35f;
                        temp.borderColor = new Color(0.91f, 0.68f, 0.67f, 0.95f);
                        temp.textColor = new Color(0.18f, 0.14f, 0.16f, 1.00f);
                        temp.shadowColor = new Color(0.14f, 0.10f, 0.12f, 0.18f);
                        temp.cornerRadius = 0.34f;
                        temp.borderWidth = 0.065f;
                        break;

                    case EkacBuiltInPreset.CyberNeon:
                        temp.bgColor = new Color(0.05f, 0.07f, 0.13f, 0.92f);
                        temp.bgColor2 = new Color(0.10f, 0.05f, 0.17f, 0.94f);
                        temp.bgGradient = 1.0f;
                        temp.borderColor = new Color(0.15f, 0.94f, 1.00f, 1.0f);
                        temp.emissionColor = Color.black;
                        temp.emissionStrength = 0.35f;
                        temp.cornerRadius = 0.24f;
                        temp.borderWidth = 0.075f;
                        temp.textColor = new Color(0.92f, 0.99f, 1.00f, 1.0f);
                        temp.textColor2 = new Color(0.55f, 0.92f, 1.00f, 1.0f);
                        temp.textGradient = 0.8f;
                        temp.textWeight = 0.03f;
                        temp.textShadowEnable = 1f;
                        temp.textShadowColor = new Color(0.0f, 0.85f, 1.0f, 0.65f);
                        temp.textShadowOffsetX = 0f;
                        temp.textShadowOffsetY = 0f;
                        temp.textShadowSoftness = 0.12f;
                        temp.shadowColor = new Color(0.0f, 0.65f, 0.95f, 0.28f);
                        temp.shadowOffsetY = 0f;
                        temp.shadowSoftness = 0.28f;
                        break;

                    case EkacBuiltInPreset.MinimalGlass:
                        temp.bgColor = new Color(0.10f, 0.11f, 0.13f, 0.78f);
                        temp.bgColor2 = new Color(0.06f, 0.07f, 0.09f, 0.84f);
                        temp.bgGradient = 0.7f;
                        temp.borderWidth = 0f;
                        temp.cornerRadius = 0.48f;
                        temp.tailEnable = 0f;
                        temp.textColor = Color.white;
                        temp.textWeight = 0.02f;
                        temp.textOutlineWidth = 0.06f;
                        temp.textOutlineColor = new Color(0.05f, 0.05f, 0.07f, 0.85f);
                        temp.shadowColor = new Color(0f, 0f, 0f, 0.26f);
                        break;

                    case EkacBuiltInPreset.RetroPixel:
                        temp.bgColor = new Color(0.11f, 0.12f, 0.22f, 0.97f);
                        temp.bgGradient = 0f;
                        temp.borderColor = new Color(0.98f, 0.95f, 0.82f, 1.0f);
                        temp.cornerRadius = 0.03f;
                        temp.borderWidth = 0.11f;
                        temp.padX = 0.62f;
                        temp.padY = 0.40f;
                        temp.tailEnable = 1f;
                        temp.tailOffsetX = -0.8f;
                        temp.textColor = new Color(1.0f, 0.96f, 0.72f, 1.0f);
                        temp.textWeight = 0.04f;
                        temp.textShadowEnable = 1f;
                        temp.textShadowColor = new Color(0.04f, 0.04f, 0.08f, 0.95f);
                        temp.textShadowOffsetX = 0.045f;
                        temp.textShadowOffsetY = -0.045f;
                        temp.textShadowSoftness = 0.02f;
                        temp.popScale = 1.25f;
                        temp.shadowOffsetX = 0.08f;
                        temp.shadowOffsetY = -0.08f;
                        temp.shadowSoftness = 0.02f;
                        temp.shadowColor = new Color(0.03f, 0.03f, 0.06f, 0.55f);
                        break;

                    case EkacBuiltInPreset.MintWave:
                        temp.bgColor = new Color(0.93f, 1.00f, 0.97f, 0.95f);
                        temp.bgColor2 = new Color(0.84f, 0.97f, 0.94f, 0.95f);
                        temp.bgGradient = 1.0f;
                        temp.borderColor = new Color(0.42f, 0.82f, 0.72f, 0.96f);
                        temp.cornerRadius = 0.58f;
                        temp.borderWidth = 0.075f;
                        temp.textColor = new Color(0.11f, 0.30f, 0.27f, 1.0f);
                        temp.textWeight = 0.035f;
                        temp.textOutlineWidth = 0.07f;
                        temp.textOutlineColor = new Color(1f, 1f, 1f, 0.95f);
                        temp.popScale = 1.18f;
                        temp.waveAmp = 0.045f;
                        temp.waveFreq = 0.95f;
                        temp.waveSpeed = 5.2f;
                        break;
                }

                temp.ApplyToMaterial(mat, recordUndo);
            }
            finally
            {
                DestroyImmediate(temp);
            }
        }
    }

    [InitializeOnLoad]
    public static class EkacBubbleScenePreview
    {
        private static bool _active;
        private static bool _animateTyping;
        private static int _previewSlotCount = 3;
        private static readonly string[] _slotTexts =
        {
            "你好呀！今天一起去VRChat拍照吗？",
            "可以在Unity里自由调气泡样式和字体～",
            "头顶最多叠放三层气泡！"
        };

        private static readonly Vector4[] _metaBuf = new Vector4[3];
        private static readonly float[] _colsBuf = new float[72];
        private static readonly float[] _rowsBuf = new float[72];
        private static readonly EkacBubbleLayoutChunk[] _cachedChunks = new EkacBubbleLayoutChunk[3];
        private static readonly bool[] _hasChunk = new bool[3];
        private static bool _chunksDirty = true;
        private static Material _cachedMat;
        private static double _animStart;

        static EkacBubbleScenePreview()
        {
            EditorApplication.update += OnEditorUpdate;
            EditorApplication.playModeStateChanged += OnPlayModeChanged;
            AssemblyReloadEvents.beforeAssemblyReload += ClearGlobals;
            EditorApplication.delayCall += () =>
            {
                if (!_active) ClearGlobals();
            };
        }

        public static bool IsActive
        {
            get => _active;
            set
            {
                if (_active == value) return;
                _active = value;
                _animStart = EditorApplication.timeSinceStartup;
                if (_active) PushPreviewBuffers();
                else ClearGlobals();
                SceneView.RepaintAll();
            }
        }

        public static bool AnimateTyping
        {
            get => _animateTyping;
            set
            {
                _animateTyping = value;
                _animStart = EditorApplication.timeSinceStartup;
                if (_active) PushPreviewBuffers();
                SceneView.RepaintAll();
            }
        }

        public static int SlotCount
        {
            get => _previewSlotCount;
            set
            {
                _previewSlotCount = Mathf.Clamp(value, 1, 3);
                if (_active) PushPreviewBuffers();
                SceneView.RepaintAll();
            }
        }

        public static string GetSlotText(int slot) => _slotTexts[Mathf.Clamp(slot, 0, 2)];

        public static void SetSlotText(int slot, string text)
        {
            slot = Mathf.Clamp(slot, 0, 2);
            if (_slotTexts[slot] == text) return;
            _slotTexts[slot] = text ?? "";
            _chunksDirty = true;
            if (_active) PushPreviewBuffers();
            SceneView.RepaintAll();
        }

        public static void ClearGlobals()
        {
            _active = false;
            Shader.SetGlobalFloat("_EB_PreviewActive", 0f);
            Shader.SetGlobalFloat("_EB_PreviewTime", 0f);
        }

        private static void OnPlayModeChanged(PlayModeStateChange state)
        {
            if (state == PlayModeStateChange.ExitingEditMode || state == PlayModeStateChange.EnteredPlayMode)
            {
                ClearGlobals();
            }
        }

        private static void EnsureChunksCached()
        {
            if (!_chunksDirty) return;
            for (int s = 0; s < 3; s++)
            {
                var chunks = EkacBubbleFontBaker.LayoutText(_slotTexts[s]);
                if (chunks.Count > 0)
                {
                    _cachedChunks[s] = chunks[0];
                    _hasChunk[s] = true;
                }
                else
                {
                    _cachedChunks[s] = default;
                    _hasChunk[s] = false;
                }
            }
            _chunksDirty = false;
        }

        private static void OnEditorUpdate()
        {
            if (!_active) return;
            float now = (float)EditorApplication.timeSinceStartup;
            Shader.SetGlobalFloat("_EB_PreviewTime", now);
            if (_animateTyping)
            {
                EnsureChunksCached();
                if (_previewSlotCount > 0 && _hasChunk[0])
                {
                    int len0 = _cachedChunks[0].Len;
                    float elapsed = (float)(EditorApplication.timeSinceStartup - _animStart);
                    float cycle = Mathf.Repeat(elapsed * 10.0f, len0 + 12.0f);
                    _metaBuf[0].w = Mathf.Min(cycle, len0);
                    Shader.SetGlobalVectorArray("_EB_PreviewMeta", _metaBuf);
                }
            }

            if (_cachedMat == null)
            {
                _cachedMat = AssetDatabase.LoadAssetAtPath<Material>(EkacBubbleBuilder.MaterialPath);
            }
            bool hasWave = _cachedMat != null && _cachedMat.HasProperty("_WaveAmp") && _cachedMat.GetFloat("_WaveAmp") > 0.001f;
            if (_animateTyping || hasWave)
            {
                SceneView.RepaintAll();
            }
        }

        public static void PushPreviewBuffers()
        {
            EnsureChunksCached();
            Array.Clear(_metaBuf, 0, _metaBuf.Length);
            Array.Clear(_colsBuf, 0, _colsBuf.Length);
            Array.Clear(_rowsBuf, 0, _rowsBuf.Length);

            double elapsed = EditorApplication.timeSinceStartup - _animStart;

            for (int s = 0; s < _previewSlotCount; s++)
            {
                if (!_hasChunk[s]) continue;
                var c = _cachedChunks[s];

                float reveal = c.Len;
                if (_animateTyping && s == 0)
                {
                    float cycle = Mathf.Repeat((float)elapsed * 10.0f, c.Len + 12.0f);
                    reveal = Mathf.Min(cycle, c.Len);
                }

                _metaBuf[s] = new Vector4(1.0f, c.Len, c.Line1Len, reveal);
                int baseIdx = s * 24;
                for (int k = 0; k < 24; k++)
                {
                    _colsBuf[baseIdx + k] = c.Cols[k];
                    _rowsBuf[baseIdx + k] = c.Rows[k];
                }
            }

            Shader.SetGlobalFloat("_EB_PreviewActive", _active ? 1.0f : 0.0f);
            Shader.SetGlobalFloat("_EB_PreviewTime", (float)EditorApplication.timeSinceStartup);
            Shader.SetGlobalVectorArray("_EB_PreviewMeta", _metaBuf);
            Shader.SetGlobalFloatArray("_EB_PreviewCols", _colsBuf);
            Shader.SetGlobalFloatArray("_EB_PreviewRows", _rowsBuf);
        }
    }
}
#endif
