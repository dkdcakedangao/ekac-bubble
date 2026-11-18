#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace EkacBubble.Editor
{
    public class EkacBubbleStyleWindow : EditorWindow
    {
        private int _tab = 0;
        private Vector2 _scroll;

        // Font baker state
        private Font _selectedUnityFont;
        private string _externalFontPath = "";
        private Font _fallbackUnityFont;
        private int _bakePointSize = 40;
        private int _bakeBaselineOffset = 0;
        private int _systemFontIdx = 0;
        private string _customGlyphs = "";
        private List<(string label, string path)> _installedSystemFonts;

        private const string CustomGlyphsPrefKey = "EkacBubble_CustomGlyphs";

        private static readonly string[] TabNames =
        {
            "预览与主题预设",
            "聊天框与贴图皮肤",
            "文字样式与动效",
            "一键换字体 (.ttf)"
        };

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

        [MenuItem("Tools/ekac气泡插件/2. 打开样式与字体工坊 (Style & Font Studio)", false, 2)]
        public static void OpenWindow()
        {
            var win = GetWindow<EkacBubbleStyleWindow>("ekac 气泡工坊");
            win.minSize = new Vector2(460, 620);
            win.Show();
        }

        private void OnEnable()
        {
            ScanSystemFonts();
            _customGlyphs = EditorPrefs.GetString(CustomGlyphsPrefKey, "");
            EkacBubbleFontBaker.SetCustomGlyphs(_customGlyphs);
        }

        private void ScanSystemFonts()
        {
            _installedSystemFonts = new List<(string, string)>
            {
                ("— 选择电脑已安装常用中文字体 —", "")
            };
            string winFonts = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Fonts");
            var candidates = new (string label, string file)[]
            {
                ("思源黑体 (NotoSansSC-VF.ttf)", "NotoSansSC-VF.ttf"),
                ("微软雅黑 (msyh.ttc)", "msyh.ttc"),
                ("微软雅黑 粗体 (msyhbd.ttc)", "msyhbd.ttc"),
                ("幼圆 / 圆体 (SIMYOU.TTF)", "SIMYOU.TTF"),
                ("楷体 (simkai.ttf)", "simkai.ttf"),
                ("隶书 (SIMLI.TTF)", "SIMLI.TTF"),
                ("仿宋 (simfang.ttf)", "simfang.ttf"),
                ("中易黑体 (simhei.ttf)", "simhei.ttf"),
                ("宋体 (simsun.ttc)", "simsun.ttc"),
                ("游ゴシック 日文 (YuGothM.ttc)", "YuGothM.ttc"),
            };
            foreach (var c in candidates)
            {
                string full = Path.Combine(winFonts, c.file);
                if (File.Exists(full))
                {
                    _installedSystemFonts.Add((c.label, full));
                }
            }
        }

        private Material GetOrLoadMaterial()
        {
            return AssetDatabase.LoadAssetAtPath<Material>(EkacBubbleBuilder.MaterialPath);
        }

        private void OnGUI()
        {
            Material mat = GetOrLoadMaterial();
            if (mat == null)
            {
                EditorGUILayout.HelpBox("尚未生成气泡材质资源，请先点击下方按钮生成并挂载气泡插件。", MessageType.Warning);
                if (GUILayout.Button("一键生成气泡资源并挂载到模型", GUILayout.Height(32)))
                {
                    EkacBubbleBuilder.BuildAndAttachMenu();
                }
                return;
            }

            DrawPreviewHeaderBar();

            EditorGUILayout.Space(4);
            _tab = GUILayout.Toolbar(_tab, TabNames, GUILayout.Height(28));
            EditorGUILayout.Space(4);

            _scroll = EditorGUILayout.BeginScrollView(_scroll);
            switch (_tab)
            {
                case 0: DrawTabPreviewAndPresets(mat); break;
                case 1: DrawTabFrameAndSkin(mat); break;
                case 2: DrawTabTextAndMotion(mat); break;
                case 3: DrawTabFontBaker(mat); break;
            }
            EditorGUILayout.EndScrollView();
        }

        private void DrawPreviewHeaderBar()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.BeginHorizontal();
            Color origBg = GUI.backgroundColor;
            GUI.backgroundColor = EkacBubbleScenePreview.IsActive ? new Color(0.50f, 0.94f, 0.68f) : new Color(0.95f, 0.95f, 0.95f);
            if (GUILayout.Button(EkacBubbleScenePreview.IsActive ? "● Scene 实时预览：开启中" : "○ 开启 Scene 实时预览", GUILayout.Height(28)))
            {
                EkacBubbleScenePreview.IsActive = !EkacBubbleScenePreview.IsActive;
            }
            GUI.backgroundColor = origBg;

            if (GUILayout.Button("镜头聚焦头顶气泡", GUILayout.Width(135), GUILayout.Height(28)))
            {
                FocusBubbleInSceneView();
            }
            EditorGUILayout.EndHorizontal();

            if (EkacBubbleScenePreview.IsActive)
            {
                EditorGUILayout.LabelField("安全提示：预览通过非序列化全局变量渲染，绝不会写入模型材质或被误上传进 VRChat。", EditorStyles.miniLabel);
            }
            EditorGUILayout.EndVertical();
        }

        private void DrawTabPreviewAndPresets(Material mat)
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("Scene 视图实时预览文本", EditorStyles.boldLabel);
            EkacBubbleScenePreview.AnimateTyping = EditorGUILayout.Toggle("循环模拟逐字蹦出动画", EkacBubbleScenePreview.AnimateTyping);
            EkacBubbleScenePreview.SlotCount = EditorGUILayout.IntSlider("显示预览气泡层数", EkacBubbleScenePreview.SlotCount, 1, 3);

            for (int s = 0; s < EkacBubbleScenePreview.SlotCount; s++)
            {
                string label = s == 0 ? "最新气泡 (底部 Slot 0)" : s == 1 ? "上一句 (中部 Slot 1)" : "最早一句 (顶部 Slot 2)";
                string next = EditorGUILayout.TextField(label, EkacBubbleScenePreview.GetSlotText(s));
                EkacBubbleScenePreview.SetSlotText(s, next);
            }
            EditorGUILayout.EndVertical();

            EditorGUILayout.Space(6);

            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("内置一键主题预设 (0 额外同步参数)", EditorStyles.boldLabel);
            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("🌸 默认樱花粉", GUILayout.Height(30)))
                EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.SakuraPink);
            if (GUILayout.Button("⚡ 暗黑霓虹发光", GUILayout.Height(30)))
                EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.CyberNeon);
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("🕶 极简毛玻璃深色", GUILayout.Height(30)))
                EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.MinimalGlass);
            if (GUILayout.Button("👾 复古 RPG 像素框", GUILayout.Height(30)))
                EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.RetroPixel);
            if (GUILayout.Button("🌿 清新薄荷波浪", GUILayout.Height(30)))
                EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.MintWave);
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.EndVertical();

            EditorGUILayout.Space(6);

            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("保存 / 加载自定义样式预设 (.asset)", EditorStyles.boldLabel);
            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("导出当前样式为预设资产...", GUILayout.Height(26)))
            {
                string savePath = EditorUtility.SaveFilePanelInProject(
                    "保存气泡样式预设",
                    "MyBubbleStyle",
                    "asset",
                    "选择保存自定义样式预设的位置",
                    EkacBubbleBuilder.RootDir
                );
                if (!string.IsNullOrEmpty(savePath))
                {
                    var preset = CreateInstance<EkacBubbleStylePreset>();
                    preset.CaptureFromMaterial(mat);
                    AssetDatabase.CreateAsset(preset, savePath);
                    AssetDatabase.SaveAssets();
                    EditorGUIUtility.PingObject(preset);
                }
            }
            if (GUILayout.Button("从预设资产加载样式...", GUILayout.Height(26)))
            {
                string openPath = EditorUtility.OpenFilePanel("加载气泡样式预设", Application.dataPath, "asset");
                if (!string.IsNullOrEmpty(openPath))
                {
                    string fullData = Path.GetFullPath(Application.dataPath).Replace('\\', '/').TrimEnd('/') + "/";
                    string norm = Path.GetFullPath(openPath).Replace('\\', '/');
                    if (norm.StartsWith(fullData, StringComparison.OrdinalIgnoreCase))
                    {
                        string rel = "Assets/" + norm.Substring(fullData.Length);
                        var preset = AssetDatabase.LoadAssetAtPath<EkacBubbleStylePreset>(rel);
                        if (preset != null)
                        {
                            preset.ApplyToMaterial(mat);
                        }
                        else
                        {
                            EditorUtility.DisplayDialog("ekac 气泡工坊", "所选 .asset 文件不是有效的气泡样式预设资产（EkacBubbleStylePreset）。", "确定");
                        }
                    }
                    else
                    {
                        EditorUtility.DisplayDialog("ekac 气泡工坊", "请选择当前 Unity 工程 Assets 目录内的 .asset 样式预设文件。", "确定");
                    }
                }
            }
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.Space(4);
            if (GUILayout.Button("选中材质球 (在 Inspector 中查看)", GUILayout.Height(24)))
            {
                Selection.activeObject = mat;
                EditorGUIUtility.PingObject(mat);
            }
            EditorGUILayout.EndVertical();
        }

        private void DrawTabFrameAndSkin(Material mat)
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("聊天框模式与色彩", EditorStyles.boldLabel);
            int curMode = Mathf.Clamp(Mathf.RoundToInt(mat.GetFloat("_FrameMode")), 0, 2);
            int nextMode = EditorGUILayout.Popup("渲染模式", curMode, FrameModeLabels);
            if (nextMode != curMode) SetFloat(mat, "_FrameMode", nextMode);

            EditColor(mat, "_BgColor", "背景主色 (顶部)");
            EditColor(mat, "_BgColor2", "背景副色 (底部)");
            EditSlider(mat, "_BgGradient", "背景垂直渐变强度", 0f, 1f);
            EditColor(mat, "_BorderColor", "描边颜色");
            EditColor(mat, "_EmissionColor", "自发光附加染色", true);
            EditSlider(mat, "_EmissionStrength", "整体自发光 / HDR 倍增", 0f, 3f);

            EditorGUILayout.Space(4);
            EditColor(mat, "_ShadowColor", "外投影颜色");
            EditSlider(mat, "_ShadowOffsetX", "外投影偏移 X (em)", -0.5f, 0.5f);
            EditSlider(mat, "_ShadowOffsetY", "外投影偏移 Y (em)", -0.5f, 0.5f);
            EditSlider(mat, "_ShadowSoftness", "外投影柔和度 (em)", 0.01f, 0.5f);
            EditorGUILayout.EndVertical();

            EditorGUILayout.Space(6);

            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("圆角、边框、边距与底部小尾巴", EditorStyles.boldLabel);
            EditSlider(mat, "_CornerRadius", "圆角半径 (0=直角像素框)", 0f, 1.6f);
            EditSlider(mat, "_BorderWidth", "边框粗细 (0=无边框)", 0f, 0.30f);
            EditSlider(mat, "_PadX", "左右内边距 (em)", 0.20f, 1.50f);
            EditSlider(mat, "_PadY", "上下内边距 (em)", 0.15f, 1.10f);
            EditSlider(mat, "_LineHeight", "行高 (em)", 1.00f, 1.80f);
            EditSlider(mat, "_BubbleGap", "多层气泡垂直间距 (em)", 0.08f, 0.90f);

            EditorGUILayout.Space(3);
            EditToggle(mat, "_TailEnable", "显示底部说话小尾巴");
            if (mat.GetFloat("_TailEnable") > 0.5f)
            {
                EditSlider(mat, "_TailWidth", "小尾巴半宽 (em)", 0.06f, 0.60f);
                EditSlider(mat, "_TailHeight", "小尾巴高度 (em)", 0.08f, 0.60f);
                EditSlider(mat, "_TailOffsetX", "小尾巴左右偏移 (em)", -3.0f, 3.0f);
            }
            EditorGUILayout.EndVertical();

            EditorGUILayout.Space(6);

            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("九宫格自定义贴图皮肤 (9-Slice，四角不拉伸)", EditorStyles.boldLabel);
            EditTexture(mat, "_SkinTex", "九宫格皮肤贴图 (RGBA)");
            var skinTex = mat.GetTexture("_SkinTex") as Texture2D;
            if (skinTex != null && GUILayout.Button("一键优化该皮肤贴图的导入设置 (Clamp + Alpha透明)"))
            {
                ConfigureUiSkinTexture(skinTex);
            }
            EditColor(mat, "_SkinTint", "皮肤贴图染色");
            EditSlider(mat, "_SkinBorderEm", "九宫格四角物理宽度 (em)", 0.10f, 2.00f);
            Vector4 sl = mat.GetVector("_SkinSlice");
            EditorGUI.BeginChangeCheck();
            sl.x = EditorGUILayout.Slider("左切线比例 (Left UV)", sl.x, 0f, 0.49f);
            sl.y = EditorGUILayout.Slider("右切线比例 (Right UV)", sl.y, 0f, 0.49f);
            sl.z = EditorGUILayout.Slider("底切线比例 (Bottom UV)", sl.z, 0f, 0.49f);
            sl.w = EditorGUILayout.Slider("顶切线比例 (Top UV)", sl.w, 0f, 0.49f);
            if (EditorGUI.EndChangeCheck())
            {
                Undo.RecordObject(mat, "Modify 9-Slice Borders");
                mat.SetVector("_SkinSlice", sl);
                EditorUtility.SetDirty(mat);
                SceneView.RepaintAll();
            }
            EditorGUILayout.EndVertical();

            EditorGUILayout.Space(6);

            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("角落装饰贴纸 / 猫耳蝴蝶结角标", EditorStyles.boldLabel);
            EditToggle(mat, "_BadgeEnable", "启用装饰贴纸角标");
            if (mat.GetFloat("_BadgeEnable") > 0.5f)
            {
                EditTexture(mat, "_BadgeTex", "角标贴纸贴图 (RGBA)");
                var badgeTex = mat.GetTexture("_BadgeTex") as Texture2D;
                if (badgeTex != null && GUILayout.Button("一键优化角标贴图的导入设置 (Clamp + Alpha透明)"))
                {
                    ConfigureUiSkinTexture(badgeTex);
                }
                EditColor(mat, "_BadgeTint", "角标染色");
                int cIdx = Mathf.Clamp(Mathf.RoundToInt(mat.GetFloat("_BadgeCorner")), 0, 4);
                int nextIdx = EditorGUILayout.Popup("挂载角落锚点", cIdx, BadgeCornerLabels);
                if (nextIdx != cIdx) SetFloat(mat, "_BadgeCorner", nextIdx);
                EditSlider(mat, "_BadgeSize", "角标尺寸 (em)", 0.20f, 2.50f);
                EditSlider(mat, "_BadgeOffsetX", "水平偏移 (em)", -1.5f, 1.5f);
                EditSlider(mat, "_BadgeOffsetY", "垂直偏移 (em)", -1.5f, 1.5f);
                EditToggle(mat, "_BadgeSlot0Only", "仅在最新一层气泡显示角标");
            }
            EditorGUILayout.EndVertical();
        }

        private void DrawTabTextAndMotion(Material mat)
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("SDF 文字颜色、粗细、斜体与外描边", EditorStyles.boldLabel);
            EditColor(mat, "_TextColor", "文字主色 (顶部)");
            EditColor(mat, "_TextColor2", "文字副色 (底部)");
            EditSlider(mat, "_TextGradient", "文字垂直渐变强度", 0f, 1f);
            EditSlider(mat, "_TextWeight", "字重调节 (负=细体，正=粗体)", -0.14f, 0.16f);
            EditSlider(mat, "_TextItalic", "伪斜体倾角", -0.35f, 0.35f);
            EditorGUILayout.Space(3);
            EditSlider(mat, "_TextOutlineWidth", "文字外描边粗细 (0=关闭)", 0f, 0.24f);
            EditColor(mat, "_TextOutlineColor", "文字外描边颜色");
            EditorGUILayout.EndVertical();

            EditorGUILayout.Space(6);

            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("文字投影与柔和外发光", EditorStyles.boldLabel);
            EditToggle(mat, "_TextShadowEnable", "启用文字投影 / 外发光");
            if (mat.GetFloat("_TextShadowEnable") > 0.5f)
            {
                EditColor(mat, "_TextShadowColor", "投影 / 发光颜色");
                EditSlider(mat, "_TextShadowOffsetX", "水平偏移", -0.15f, 0.15f);
                EditSlider(mat, "_TextShadowOffsetY", "垂直偏移", -0.15f, 0.15f);
                EditSlider(mat, "_TextShadowSoftness", "柔和度 (低=硬阴影，高=霓虹发光)", 0f, 0.25f);
            }
            EditorGUILayout.EndVertical();

            EditorGUILayout.Space(6);

            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("说话逐字出现与波浪动效", EditorStyles.boldLabel);
            EditSlider(mat, "_PopOffsetY", "新字浮入起始位移 (em)", -0.35f, 0.35f);
            EditSlider(mat, "_PopScale", "新字弹性缩放倍率 (1=无缩放)", 0.5f, 1.5f);
            EditorGUILayout.Space(3);
            EditSlider(mat, "_WaveAmp", "文字持续波浪跳动幅度 (0=静止)", 0f, 0.20f);
            EditSlider(mat, "_WaveFreq", "波浪相邻字符相位差", 0.2f, 3.0f);
            EditSlider(mat, "_WaveSpeed", "波浪跳动速度", 0f, 12.0f);
            EditorGUILayout.EndVertical();
        }

        private void DrawTabFontBaker(Material mat)
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("当前绑定双页 4K SDF 字库贴图 (共 8,192 格)", EditorStyles.boldLabel);
            EditTexture(mat, "_AtlasTex", "第 1 页字库 (_AtlasTex)");
            EditTexture(mat, "_AtlasTex1", "第 2 页扩展字库 (_AtlasTex1)");
            if (GUILayout.Button("恢复默认内置双页思源黑体字库 (EkacGlyphAtlas + P1)", GUILayout.Height(26)))
            {
                var defTex0 = AssetDatabase.LoadAssetAtPath<Texture2D>(EkacBubbleBuilder.AtlasPath);
                var defTex1 = AssetDatabase.LoadAssetAtPath<Texture2D>(EkacBubbleBuilder.AtlasPage1Path);
                if (defTex0 != null)
                {
                    Undo.RecordObject(mat, "Restore Default Dual-Page Font Atlas");
                    mat.SetTexture("_AtlasTex", defTex0);
                    if (defTex1 != null) mat.SetTexture("_AtlasTex1", defTex1);
                    EditorUtility.SetDirty(mat);
                    SceneView.RepaintAll();
                }
            }
            EditorGUILayout.EndVertical();

            EditorGUILayout.Space(6);

            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("一键烘焙自定义字体 (.ttf / .otf / .ttc → 双页 4K SDF)", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "已升级双页 8,192 格编码表（含 GB2312 全部 6,763 一/二级字如「霆」「尬」「氪」「炫」、日语常见汉字及繁简自动映射）。下方会同时烘焙双页 4K 贴图，缺字自动用后备字体补齐。",
                MessageType.Info
            );

            // Option A: Unity Font asset
            _selectedUnityFont = (Font)EditorGUILayout.ObjectField("方式 A：拖入工程内 Font", _selectedUnityFont, typeof(Font), false);

            // Option B: Installed Windows font quick dropdown
            if (_installedSystemFonts != null && _installedSystemFonts.Count > 1)
            {
                string[] labels = new string[_installedSystemFonts.Count];
                for (int i = 0; i < _installedSystemFonts.Count; i++) labels[i] = _installedSystemFonts[i].label;
                int nextSys = EditorGUILayout.Popup("方式 B：快速选择系统字体", _systemFontIdx, labels);
                if (nextSys != _systemFontIdx)
                {
                    _systemFontIdx = nextSys;
                    if (_systemFontIdx > 0)
                    {
                        _externalFontPath = _installedSystemFonts[_systemFontIdx].path;
                        _selectedUnityFont = null;
                    }
                }
            }

            // Option C: External file browser
            EditorGUILayout.BeginHorizontal();
            _externalFontPath = EditorGUILayout.TextField("方式 C：字体文件路径", _externalFontPath);
            if (GUILayout.Button("浏览...", GUILayout.Width(68)))
            {
                string initDir = Environment.GetFolderPath(Environment.SpecialFolder.Fonts);
                string picked = EditorUtility.OpenFilePanelWithFilters(
                    "选择字体文件 (.ttf / .otf / .ttc)",
                    initDir,
                    new[] { "Font Files (*.ttf;*.otf;*.ttc)", "ttf,otf,ttc" }
                );
                if (!string.IsNullOrEmpty(picked))
                {
                    _externalFontPath = picked;
                    _selectedUnityFont = null;
                    _systemFontIdx = 0;
                }
            }
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.Space(4);
            _fallbackUnityFont = (Font)EditorGUILayout.ObjectField("可选：优先缺字回退字体", _fallbackUnityFont, typeof(Font), false);
            _bakePointSize = EditorGUILayout.IntSlider("字形采样字号 (默认 40)", _bakePointSize, 26, 50);
            _bakeBaselineOffset = EditorGUILayout.IntSlider("垂直基线微调 (px)", _bakeBaselineOffset, -10, 10);

            EditorGUILayout.Space(4);
            EditorGUILayout.LabelField("可选：个人必收生僻字扩展 (第 128 行，最多 64 格)", EditorStyles.miniBoldLabel);
            EditorGUILayout.BeginHorizontal();
            EditorGUI.BeginChangeCheck();
            _customGlyphs = EditorGUILayout.TextField(_customGlyphs);
            if (EditorGUI.EndChangeCheck())
            {
                EditorPrefs.SetString(CustomGlyphsPrefKey, _customGlyphs ?? "");
                EkacBubbleFontBaker.SetCustomGlyphs(_customGlyphs);
                if (EkacBubbleScenePreview.IsActive) EkacBubbleScenePreview.PushPreviewBuffers();
            }
            if (GUILayout.Button("复制同步到桌面端", GUILayout.Width(122)))
            {
                EditorGUIUtility.systemCopyBuffer = _customGlyphs ?? "";
                ShowNotification(new GUIContent("已复制个人生僻字列表，请粘贴到桌面端「模型端口」页面"));
            }
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.Space(6);
            string resolvedPrimary = _selectedUnityFont != null
                ? EkacBubbleFontBaker.ResolveFontFilePath(_selectedUnityFont)
                : _externalFontPath;

            if (_selectedUnityFont != null && string.IsNullOrEmpty(resolvedPrimary))
            {
                EditorGUILayout.HelpBox("所选 Font 是 Unity 内置默认资源，无法读取原始字体文件，请拖入工程内的 .ttf / .otf / .ttc 字体或使用方式 B / C。", MessageType.Warning);
            }

            GUI.enabled = !string.IsNullOrEmpty(resolvedPrimary) && File.Exists(resolvedPrimary);
            Color prev = GUI.backgroundColor;
            GUI.backgroundColor = new Color(0.65f, 0.88f, 1.0f);
            if (GUILayout.Button("立即烘焙双页 4K SDF 字库并应用到材质", GUILayout.Height(34)))
            {
                try
                {
                    string fbPath = EkacBubbleFontBaker.ResolveFontFilePath(_fallbackUnityFont);
                    var baked0 = EkacBubbleFontBaker.BakeFontAtlas(
                        resolvedPrimary,
                        out var report,
                        null,
                        _bakePointSize,
                        _bakeBaselineOffset,
                        fbPath,
                        true,
                        _customGlyphs ?? ""
                    );
                    if (baked0 != null)
                    {
                        Undo.RecordObject(mat, "Assign Custom Baked Dual-Page Font Atlas");
                        mat.SetTexture("_AtlasTex", baked0);
                        if (report.TexturePage1 != null) mat.SetTexture("_AtlasTex1", report.TexturePage1);
                        EditorUtility.SetDirty(mat);
                        AssetDatabase.SaveAssets();
                        if (!EkacBubbleScenePreview.IsActive) EkacBubbleScenePreview.IsActive = true;
                        EkacBubbleScenePreview.PushPreviewBuffers();
                        SceneView.RepaintAll();
                        EditorUtility.DisplayDialog(
                            "ekac 气泡工坊",
                            $"双页 4K 字体烘焙完成并已应用到当前材质！\n\n" +
                            $"第 1 页：{report.OutputAssetPath}\n" +
                            $"第 2 页：{report.OutputPage1AssetPath}\n" +
                            $"主字体渲染：{report.PrimaryRenderedCount} 字\n" +
                            $"缺字回退补齐：{report.FallbackRenderedCount} 字\n" +
                            $"个人生僻字槽位：{report.CustomRenderedCount} 字",
                            "太棒了"
                        );
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogError("[EkacBubble] 字体烘焙失败：" + ex);
                    EditorUtility.DisplayDialog("ekac 气泡工坊 — 字体烘焙失败", ex.Message, "确定");
                }
            }
            GUI.backgroundColor = prev;
            GUI.enabled = true;
            EditorGUILayout.EndVertical();
        }

        private static void FocusBubbleInSceneView()
        {
            if (!EkacBubbleScenePreview.IsActive)
                EkacBubbleScenePreview.IsActive = true;

            MeshRenderer targetMr = null;
            foreach (var mr in FindObjectsOfType<MeshRenderer>())
            {
                if (mr.sharedMaterial != null && mr.sharedMaterial.shader != null &&
                    mr.sharedMaterial.shader.name == "EkacBubble/SpeechBubble")
                {
                    targetMr = mr;
                    break;
                }
            }
            if (targetMr == null) return;

            Selection.activeGameObject = targetMr.gameObject;
            var sv = SceneView.lastActiveSceneView;
            if (sv != null)
            {
                Vector3 focusPos = targetMr.transform.position + Vector3.up * 0.45f;
                sv.LookAt(focusPos, Quaternion.Euler(8f, 180f, 0f), 0.85f);
                sv.Repaint();
            }
        }

        private static void ConfigureUiSkinTexture(Texture2D tex)
        {
            string path = AssetDatabase.GetAssetPath(tex);
            var imp = AssetImporter.GetAtPath(path) as TextureImporter;
            if (imp == null) return;
            imp.sRGBTexture = true;
            imp.alphaIsTransparency = true;
            imp.wrapMode = TextureWrapMode.Clamp;
            imp.mipmapEnabled = false;
            imp.textureCompression = TextureImporterCompression.CompressedHQ;
            imp.SaveAndReimport();
            SceneView.RepaintAll();
        }

        private static void SetFloat(Material mat, string prop, float val)
        {
            Undo.RecordObject(mat, "Edit " + prop);
            mat.SetFloat(prop, val);
            EditorUtility.SetDirty(mat);
            SceneView.RepaintAll();
        }

        private static void EditSlider(Material mat, string prop, string label, float min, float max)
        {
            float cur = mat.GetFloat(prop);
            EditorGUI.BeginChangeCheck();
            float next = EditorGUILayout.Slider(label, cur, min, max);
            if (EditorGUI.EndChangeCheck()) SetFloat(mat, prop, next);
        }

        private static void EditToggle(Material mat, string prop, string label)
        {
            bool cur = mat.GetFloat(prop) > 0.5f;
            EditorGUI.BeginChangeCheck();
            bool next = EditorGUILayout.Toggle(label, cur);
            if (EditorGUI.EndChangeCheck()) SetFloat(mat, prop, next ? 1f : 0f);
        }

        private static void EditColor(Material mat, string prop, string label, bool hdr = false)
        {
            Color cur = mat.GetColor(prop);
            EditorGUI.BeginChangeCheck();
            Color next = EditorGUILayout.ColorField(new GUIContent(label), cur, true, true, hdr);
            if (EditorGUI.EndChangeCheck())
            {
                Undo.RecordObject(mat, "Edit " + prop);
                mat.SetColor(prop, next);
                EditorUtility.SetDirty(mat);
                SceneView.RepaintAll();
            }
        }

        private static void EditTexture(Material mat, string prop, string label)
        {
            Texture cur = mat.GetTexture(prop);
            EditorGUI.BeginChangeCheck();
            Texture next = (Texture)EditorGUILayout.ObjectField(label, cur, typeof(Texture2D), false);
            if (EditorGUI.EndChangeCheck())
            {
                Undo.RecordObject(mat, "Edit " + prop);
                mat.SetTexture(prop, next);
                EditorUtility.SetDirty(mat);
                SceneView.RepaintAll();
            }
        }
    }
}
#endif
