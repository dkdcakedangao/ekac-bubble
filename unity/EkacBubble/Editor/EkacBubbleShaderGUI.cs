#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

namespace EkacBubble.Editor
{
    public class EkacBubbleShaderGUI : ShaderGUI
    {
        private bool _foldColors = true;
        private bool _foldGeometry = true;
        private bool _foldNineSlice = false;
        private bool _foldBadge = false;
        private bool _foldText = true;
        private bool _foldMotion = false;
        private bool _foldDebugSlots = false;

        private static readonly string[] FrameModeLabels =
        {
            "0 · 程序化圆角框 (Procedural)",
            "1 · 纯九宫格贴图皮肤 (9-Slice Texture)",
            "2 · 混合叠加 (圆角底框 + 九宫格贴图)"
        };

        private static readonly string[] BadgeCornerLabels =
        {
            "左上角 (Top-Left)",
            "右上角 (Top-Right)",
            "左下角 (Bottom-Left)",
            "右下角 (Bottom-Right)",
            "顶部正中 (Top-Center)"
        };

        public override void OnGUI(MaterialEditor materialEditor, MaterialProperty[] props)
        {
            Material mat = materialEditor.target as Material;
            if (mat == null)
            {
                base.OnGUI(materialEditor, props);
                return;
            }

            MaterialProperty Find(string name) => FindProperty(name, props, false);

            // Top Toolbar Banner
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("ekac 气泡外观材质面板", EditorStyles.boldLabel);
            EditorGUILayout.BeginHorizontal();
            Color prevBg = GUI.backgroundColor;
            GUI.backgroundColor = EkacBubbleScenePreview.IsActive ? new Color(0.55f, 0.95f, 0.70f) : Color.white;
            if (GUILayout.Button(EkacBubbleScenePreview.IsActive ? "● Scene 实时预览：开启中" : "○ 开启 Scene 实时预览", GUILayout.Height(26)))
            {
                EkacBubbleScenePreview.IsActive = !EkacBubbleScenePreview.IsActive;
            }
            GUI.backgroundColor = new Color(0.96f, 0.84f, 0.88f);
            if (GUILayout.Button("打开样式与换字体工坊...", GUILayout.Height(26)))
            {
                EkacBubbleStyleWindow.OpenWindow();
            }
            GUI.backgroundColor = prevBg;
            EditorGUILayout.EndHorizontal();

            // Quick Built-in Preset Row
            EditorGUILayout.Space(2);
            EditorGUILayout.BeginHorizontal();
            GUILayout.Label("一键主题:", GUILayout.Width(58));
            if (GUILayout.Button("樱花粉")) EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.SakuraPink);
            if (GUILayout.Button("暗黑霓虹")) EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.CyberNeon);
            if (GUILayout.Button("极简深色")) EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.MinimalGlass);
            if (GUILayout.Button("复古像素")) EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.RetroPixel);
            if (GUILayout.Button("清新薄荷")) EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.MintWave);
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.EndVertical();

            EditorGUILayout.Space(4);

            // Frame Mode
            var pFrameMode = Find("_FrameMode");
            if (pFrameMode != null)
            {
                int curMode = Mathf.Clamp(Mathf.RoundToInt(pFrameMode.floatValue), 0, 2);
                EditorGUI.BeginChangeCheck();
                int nextMode = EditorGUILayout.Popup("聊天框渲染模式", curMode, FrameModeLabels);
                if (EditorGUI.EndChangeCheck())
                {
                    pFrameMode.floatValue = nextMode;
                    if (nextMode >= 1) _foldNineSlice = true;
                }
            }

            // 1. Colors & Glow
            _foldColors = EditorGUILayout.BeginFoldoutHeaderGroup(_foldColors, "1. 颜色、渐变、发光与阴影");
            if (_foldColors)
            {
                EditorGUI.indentLevel++;
                DrawProp(materialEditor, Find("_BgColor"), "背景主色 (顶部)");
                DrawProp(materialEditor, Find("_BgColor2"), "背景副色 (底部)");
                DrawProp(materialEditor, Find("_BgGradient"), "背景垂直渐变强度");
                DrawProp(materialEditor, Find("_BorderColor"), "描边颜色");
                DrawProp(materialEditor, Find("_EmissionColor"), "自发光附加染色");
                DrawProp(materialEditor, Find("_EmissionStrength"), "整体自发光 / HDR 亮度");
                EditorGUILayout.Space(3);
                DrawProp(materialEditor, Find("_ShadowColor"), "气泡外投影颜色");
                DrawProp(materialEditor, Find("_ShadowOffsetX"), "投影水平偏移");
                DrawProp(materialEditor, Find("_ShadowOffsetY"), "投影垂直偏移");
                DrawProp(materialEditor, Find("_ShadowSoftness"), "投影柔和度");
                EditorGUI.indentLevel--;
            }
            EditorGUILayout.EndFoldoutHeaderGroup();

            // 2. Procedural Geometry & Tail
            _foldGeometry = EditorGUILayout.BeginFoldoutHeaderGroup(_foldGeometry, "2. 聊天框圆角、尺寸与小尾巴");
            if (_foldGeometry)
            {
                EditorGUI.indentLevel++;
                DrawProp(materialEditor, Find("_CornerRadius"), "圆角半径 (0=直角框)");
                DrawProp(materialEditor, Find("_BorderWidth"), "边框粗细 (0=无边框)");
                DrawProp(materialEditor, Find("_PadX"), "左右内边距");
                DrawProp(materialEditor, Find("_PadY"), "上下内边距");
                DrawProp(materialEditor, Find("_LineHeight"), "文字行高");
                DrawProp(materialEditor, Find("_BubbleGap"), "多层气泡间距");
                EditorGUILayout.Space(3);
                DrawToggleProp(Find("_TailEnable"), "启用底部说话小尾巴");
                if (Find("_TailEnable")?.floatValue > 0.5f)
                {
                    DrawProp(materialEditor, Find("_TailWidth"), "小尾巴宽度");
                    DrawProp(materialEditor, Find("_TailHeight"), "小尾巴长度");
                    DrawProp(materialEditor, Find("_TailOffsetX"), "小尾巴左右偏移");
                }
                EditorGUI.indentLevel--;
            }
            EditorGUILayout.EndFoldoutHeaderGroup();

            // 3. 9-Slice Skin
            _foldNineSlice = EditorGUILayout.BeginFoldoutHeaderGroup(_foldNineSlice, "3. 九宫格自定义贴图皮肤 (9-Slice)");
            if (_foldNineSlice)
            {
                EditorGUI.indentLevel++;
                DrawProp(materialEditor, Find("_SkinTex"), "九宫格皮肤贴图 (RGBA)");
                DrawProp(materialEditor, Find("_SkinTint"), "贴图乘算染色");
                DrawProp(materialEditor, Find("_SkinBorderEm"), "四角物理尺寸 (em)");
                var pSlice = Find("_SkinSlice");
                if (pSlice != null)
                {
                    Vector4 v = pSlice.vectorValue;
                    EditorGUI.BeginChangeCheck();
                    v.x = EditorGUILayout.Slider("左切线比例 (Left UV)", v.x, 0f, 0.49f);
                    v.y = EditorGUILayout.Slider("右切线比例 (Right UV)", v.y, 0f, 0.49f);
                    v.z = EditorGUILayout.Slider("底切线比例 (Bottom UV)", v.z, 0f, 0.49f);
                    v.w = EditorGUILayout.Slider("顶切线比例 (Top UV)", v.w, 0f, 0.49f);
                    if (EditorGUI.EndChangeCheck()) pSlice.vectorValue = v;
                }
                EditorGUI.indentLevel--;
            }
            EditorGUILayout.EndFoldoutHeaderGroup();

            // 4. Corner Badge
            _foldBadge = EditorGUILayout.BeginFoldoutHeaderGroup(_foldBadge, "4. 角落装饰贴纸 / 猫耳角标");
            if (_foldBadge)
            {
                EditorGUI.indentLevel++;
                DrawToggleProp(Find("_BadgeEnable"), "启用装饰角标贴纸");
                if (Find("_BadgeEnable")?.floatValue > 0.5f)
                {
                    DrawProp(materialEditor, Find("_BadgeTex"), "角标贴纸 (RGBA)");
                    DrawProp(materialEditor, Find("_BadgeTint"), "角标染色");
                    var pCorner = Find("_BadgeCorner");
                    if (pCorner != null)
                    {
                        int curC = Mathf.Clamp(Mathf.RoundToInt(pCorner.floatValue), 0, 4);
                        int nextC = EditorGUILayout.Popup("锚点位置", curC, BadgeCornerLabels);
                        if (nextC != curC) pCorner.floatValue = nextC;
                    }
                    DrawProp(materialEditor, Find("_BadgeSize"), "角标尺寸 (em)");
                    DrawProp(materialEditor, Find("_BadgeOffsetX"), "水平微调 (em)");
                    DrawProp(materialEditor, Find("_BadgeOffsetY"), "垂直微调 (em)");
                    DrawToggleProp(Find("_BadgeSlot0Only"), "仅在最新气泡上显示");
                }
                EditorGUI.indentLevel--;
            }
            EditorGUILayout.EndFoldoutHeaderGroup();

            // 5. Text Style
            _foldText = EditorGUILayout.BeginFoldoutHeaderGroup(_foldText, "5. 文字颜色、粗细、描边、斜体与字库");
            if (_foldText)
            {
                EditorGUI.indentLevel++;
                DrawProp(materialEditor, Find("_AtlasTex"), "SDF 字库贴图 (4096x4096)");
                DrawProp(materialEditor, Find("_TextColor"), "文字主色 (顶部)");
                DrawProp(materialEditor, Find("_TextColor2"), "文字副色 (底部)");
                DrawProp(materialEditor, Find("_TextGradient"), "文字垂直渐变");
                DrawProp(materialEditor, Find("_TextWeight"), "文字字重 (细 ↔ 粗)");
                DrawProp(materialEditor, Find("_TextItalic"), "文字斜体倾角");
                DrawProp(materialEditor, Find("_TextOutlineWidth"), "文字外描边粗细");
                DrawProp(materialEditor, Find("_TextOutlineColor"), "文字外描边颜色");
                EditorGUILayout.Space(2);
                DrawToggleProp(Find("_TextShadowEnable"), "启用文字投影 / 外发光");
                if (Find("_TextShadowEnable")?.floatValue > 0.5f)
                {
                    DrawProp(materialEditor, Find("_TextShadowColor"), "文字投影 / 发光颜色");
                    DrawProp(materialEditor, Find("_TextShadowOffsetX"), "投影偏移 X");
                    DrawProp(materialEditor, Find("_TextShadowOffsetY"), "投影偏移 Y");
                    DrawProp(materialEditor, Find("_TextShadowSoftness"), "投影柔和度 (大值=外发光)");
                }
                EditorGUI.indentLevel--;
            }
            EditorGUILayout.EndFoldoutHeaderGroup();

            // 6. Motion
            _foldMotion = EditorGUILayout.BeginFoldoutHeaderGroup(_foldMotion, "6. 逐字弹入与说话波浪动效");
            if (_foldMotion)
            {
                EditorGUI.indentLevel++;
                DrawProp(materialEditor, Find("_PopOffsetY"), "新字浮入高度偏移");
                DrawProp(materialEditor, Find("_PopScale"), "新字弹性缩放倍率");
                DrawProp(materialEditor, Find("_WaveAmp"), "持续波浪跳动幅度");
                DrawProp(materialEditor, Find("_WaveFreq"), "波浪相邻字相位差");
                DrawProp(materialEditor, Find("_WaveSpeed"), "波浪跳动速度");
                EditorGUI.indentLevel--;
            }
            EditorGUILayout.EndFoldoutHeaderGroup();

            // 7. Debug Runtime Properties
            _foldDebugSlots = EditorGUILayout.BeginFoldoutHeaderGroup(_foldDebugSlots, "7. 运行时动画参数调试 (默认折叠)");
            if (_foldDebugSlots)
            {
                EditorGUI.indentLevel++;
                DrawProp(materialEditor, Find("_Enable"), "全局显示开关 (_Enable)");
                DrawProp(materialEditor, Find("_BaseHeight"), "头顶基础高度 (_BaseHeight)");
                DrawProp(materialEditor, Find("_BubbleScale"), "整体缩放 (_BubbleScale)");
                EditorGUI.indentLevel--;
            }
            EditorGUILayout.EndFoldoutHeaderGroup();
        }

        private static void DrawProp(MaterialEditor editor, MaterialProperty prop, string label)
        {
            if (prop != null) editor.ShaderProperty(prop, label);
        }

        private static void DrawToggleProp(MaterialProperty prop, string label)
        {
            if (prop == null) return;
            bool cur = prop.floatValue > 0.5f;
            EditorGUI.BeginChangeCheck();
            bool next = EditorGUILayout.Toggle(label, cur);
            if (EditorGUI.EndChangeCheck()) prop.floatValue = next ? 1.0f : 0.0f;
        }
    }
}
#endif
