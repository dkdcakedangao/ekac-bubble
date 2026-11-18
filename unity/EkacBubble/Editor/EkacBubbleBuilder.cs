#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;
using UnityEngine.SceneManagement;
using VRC.Dynamics;
using VRC.SDK3.Avatars.Components;
using VRC.SDK3.Avatars.ScriptableObjects;
using VRC.SDK3.Dynamics.Constraint.Components;
using nadena.dev.modular_avatar.core;
using nadena.dev.ndmf;

namespace EkacBubble.Editor
{
    public static class EkacBubbleBuilder
    {
        public const string RootDir = "Assets/插件/EkacBubble";
        public const string GeneratedDir = RootDir + "/Generated";
        public const string AtlasPath = RootDir + "/Textures/EkacGlyphAtlas.png";
        public const string ShaderPath = RootDir + "/Shaders/EkacSpeechBubble.shader";
        public const string QuadPath = GeneratedDir + "/EkacBubbleQuad.asset";
        public const string MaterialPath = GeneratedDir + "/EkacBubbleMat.mat";
        public const string ControllerPath = GeneratedDir + "/EkacBubbleFX.controller";
        public const string PrefabPath = GeneratedDir + "/EkacBubble.prefab";

        private const int SlotCount = 3;
        private const int MaxChars = 24;
        private const int SliceSize = 3;
        private const int NumSlices = 8;
        private const int GenStates = 8; // 0..7
        private const int SeqStates = 4; // 0..3

        [MenuItem("Tools/ekac气泡插件/1. 生成资源并挂载到当前模型 (Build & Attach)", false, 1)]
        public static void BuildAndAttachMenu()
        {
            var targetAvatar = ResolveTargetAvatarForMenu();
            if (targetAvatar == null)
            {
                EditorUtility.DisplayDialog(
                    "ekac气泡插件",
                    "未在当前场景找到唯一目标模型。\n\n请先在 Hierarchy 中选中带有 VRCAvatarDescriptor 的模型根节点后再点击此菜单。",
                    "确定"
                );
                return;
            }
            BuildAllAssets();
            AttachToAvatar(targetAvatar);
            EditorUtility.DisplayDialog(
                "ekac气泡插件",
                $"头顶语音气泡插件已生成并成功挂载到「{targetAvatar.name}」！\n\n可通过模型菜单「头顶气泡」实时调试参数。",
                "确定"
            );
        }

        [MenuItem("Tools/ekac气泡插件/3. 仅重新生成气泡资源 (Rebuild Assets Only)", false, 3)]
        public static void RebuildAssetsOnlyMenu()
        {
            BuildAllAssets();
            Debug.Log("[EkacBubble] 所有气泡资产已重新生成（已保留材质自定义外观）：" + PrefabPath);
        }

        [MenuItem("Tools/ekac气泡插件/4. 导出 ekac气泡插件.unitypackage", false, 20)]
        public static void ExportPackageMenu()
        {
            string outPath = EditorUtility.SaveFilePanel("导出 ekac气泡插件", "", "ekac气泡插件.unitypackage", "unitypackage");
            if (string.IsNullOrEmpty(outPath)) return;
            ExportCleanPluginPackage(outPath);
            Debug.Log("[EkacBubble] 已导出插件包：" + outPath);
        }

        private static void ExportCleanPluginPackage(string outPath)
        {
            var dir = Path.GetDirectoryName(outPath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

            BuildAllAssets();
            var mat = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            var defAtlas = AssetDatabase.LoadAssetAtPath<Texture2D>(AtlasPath);
            Texture prevAtlas = mat != null ? mat.GetTexture("_AtlasTex") : null;
            Texture prevSkin = mat != null ? mat.GetTexture("_SkinTex") : null;
            Texture prevBadge = mat != null ? mat.GetTexture("_BadgeTex") : null;
            bool swappedAtlas = false;
            bool swappedSkin = false;
            bool swappedBadge = false;

            static bool IsExternalAsset(Texture tex)
            {
                if (tex == null) return false;
                string p = AssetDatabase.GetAssetPath(tex);
                return string.IsNullOrEmpty(p) || !p.StartsWith(RootDir + "/", StringComparison.OrdinalIgnoreCase);
            }

            try
            {
                // Never bundle user-baked third-party commercial fonts or external textures into the redistributable .unitypackage
                if (mat != null)
                {
                    if (defAtlas != null && prevAtlas != defAtlas)
                    {
                        mat.SetTexture("_AtlasTex", defAtlas);
                        swappedAtlas = true;
                    }
                    if (IsExternalAsset(prevSkin))
                    {
                        mat.SetTexture("_SkinTex", null);
                        swappedSkin = true;
                    }
                    if (IsExternalAsset(prevBadge))
                    {
                        mat.SetTexture("_BadgeTex", null);
                        swappedBadge = true;
                    }
                    if (swappedAtlas || swappedSkin || swappedBadge)
                    {
                        EditorUtility.SetDirty(mat);
                    }
                }
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh();

                string customFontsPrefix = EkacBubbleFontBaker.CustomFontsDir + "/";
                string[] guids = AssetDatabase.FindAssets("", new[] { RootDir });
                var exportPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (string guid in guids)
                {
                    string p = AssetDatabase.GUIDToAssetPath(guid);
                    if (string.IsNullOrEmpty(p)) continue;
                    if (AssetDatabase.IsValidFolder(p)) continue;
                    if (p.StartsWith(customFontsPrefix, StringComparison.OrdinalIgnoreCase)) continue;
                    if (string.Equals(p, EkacBubbleFontBaker.CustomFontsDir, StringComparison.OrdinalIgnoreCase)) continue;
                    if (Path.GetFileName(p).StartsWith("_", StringComparison.Ordinal)) continue;
                    exportPaths.Add(p);
                }

                AssetDatabase.ExportPackage(exportPaths.OrderBy(x => x).ToArray(), outPath, ExportPackageOptions.Default);
            }
            finally
            {
                if (mat != null && (swappedAtlas || swappedSkin || swappedBadge))
                {
                    if (swappedAtlas && prevAtlas != null) mat.SetTexture("_AtlasTex", prevAtlas);
                    if (swappedSkin) mat.SetTexture("_SkinTex", prevSkin);
                    if (swappedBadge) mat.SetTexture("_BadgeTex", prevBadge);
                    EditorUtility.SetDirty(mat);
                    AssetDatabase.SaveAssets();
                }
            }
        }

        private static GameObject ResolveTargetAvatarForMenu()
        {
            if (Selection.activeGameObject != null)
            {
                var selDesc = Selection.activeGameObject.GetComponentInParent<VRCAvatarDescriptor>();
                if (selDesc != null) return selDesc.gameObject;
            }
            var allDescs = UnityEngine.Object.FindObjectsOfType<VRCAvatarDescriptor>(false);
            if (allDescs.Length == 1) return allDescs[0].gameObject;
            var ayusa = allDescs.FirstOrDefault(d => d.gameObject.name == "Ayusa");
            return ayusa != null ? ayusa.gameObject : null;
        }

        // Batchmode entrypoints
        private static void EnsureTestingSceneOpen()
        {
            if (GameObject.Find("Ayusa") == null)
            {
                UnityEditor.SceneManagement.EditorSceneManager.OpenScene("Assets/testing.unity");
            }
        }

        public static void BuildAndAttachForBatch()
        {
            try
            {
                EnsureTestingSceneOpen();
                BuildAllAssets();
                AttachToTargetAvatarInScene("Ayusa");
                Debug.Log("[EkacBubble] BATCH_BUILD_ATTACH_OK");
            }
            catch (Exception ex)
            {
                Debug.LogError("[EkacBubble] BATCH_BUILD_FAIL: " + ex);
                EditorApplication.Exit(1);
            }
        }

        public static void ExportPackageForBatch()
        {
            try
            {
                string outPath = Environment.GetEnvironmentVariable("EKAC_UNITYPACKAGE_OUT");
                if (string.IsNullOrEmpty(outPath))
                    throw new Exception("EKAC_UNITYPACKAGE_OUT env var is empty.");
                ExportCleanPluginPackage(outPath);
                if (!File.Exists(outPath))
                    throw new Exception("ExportPackage did not write file: " + outPath);
                Debug.Log($"[EkacBubble] EXPORT_PACKAGE_OK path={outPath} bytes={new FileInfo(outPath).Length}");
            }
            catch (Exception ex)
            {
                Debug.LogError("[EkacBubble] EXPORT_PACKAGE_FAIL: " + ex);
                EditorApplication.Exit(1);
            }
        }

        public static void RenderPreviewGalleryForBatch()
        {
            string outDir = Environment.GetEnvironmentVariable("EKAC_GALLERY_DIR");
            if (string.IsNullOrEmpty(outDir)) return;
            Directory.CreateDirectory(outDir);

            EnsureTestingSceneOpen();
            var mat = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            var defAtlas = AssetDatabase.LoadAssetAtPath<Texture2D>(AtlasPath);
            var mr = UnityEngine.Object.FindObjectsOfType<MeshRenderer>()
                .FirstOrDefault(r => r.sharedMaterial == mat);
            if (mat == null || mr == null)
                throw new Exception("Missing EkacBubbleMat or BubbleMesh renderer in scene.");

            const int W = 960, H = 720;
            var rt = new RenderTexture(W, H, 24, RenderTextureFormat.ARGB32);
            var camGo = new GameObject("_TempGalleryCam");
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 20f;
            cam.fieldOfView = 38f;
            cam.targetTexture = rt;

            Vector3 bubbleBase = mr.transform.position + Vector3.up * 0.56f;
            camGo.transform.position = bubbleBase + new Vector3(0f, -0.02f, 1.38f);
            camGo.transform.LookAt(bubbleBase);

            Texture2D tempSkin = null;
            Texture2D tempBadge = null;
            string tempCustomFontAsset = RootDir + "/Generated/_GalleryKai_SDF.png";
            var savedMatState = ScriptableObject.CreateInstance<EkacBubbleStylePreset>();
            savedMatState.CaptureFromMaterial(mat);
            Texture savedAtlas = mat.GetTexture("_AtlasTex");

            try
            {
                EkacBubbleScenePreview.SlotCount = 3;
                EkacBubbleScenePreview.SetSlotText(0, "你好呀！今天一起去VRChat拍照吗？");
                EkacBubbleScenePreview.SetSlotText(1, "在Unity里可调颜色、九宫格皮肤与字体～");
                EkacBubbleScenePreview.SetSlotText(2, "最多叠放三层气泡，零额外同步参数！");
                EkacBubbleScenePreview.IsActive = true;
                EkacBubbleScenePreview.PushPreviewBuffers();

                void Snap(string fileName, Color bg)
                {
                    cam.backgroundColor = bg;
                    cam.Render();
                    RenderTexture.active = rt;
                    var shot = new Texture2D(W, H, TextureFormat.RGB24, false);
                    shot.ReadPixels(new Rect(0, 0, W, H), 0, 0);
                    shot.Apply();
                    File.WriteAllBytes(Path.Combine(outDir, fileName), shot.EncodeToPNG());
                    UnityEngine.Object.DestroyImmediate(shot);
                    RenderTexture.active = null;
                }

                // 1. Default Sakura Pink
                EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.SakuraPink, false);
                Snap("preview_sakura.png", new Color(0.93f, 0.91f, 0.94f, 1f));

                // 2. Cyber Neon
                EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.CyberNeon, false);
                Snap("preview_neon.png", new Color(0.06f, 0.07f, 0.11f, 1f));

                // 3. Retro RPG Pixel
                EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.RetroPixel, false);
                Snap("preview_retro.png", new Color(0.18f, 0.20f, 0.28f, 1f));

                // 4. 9-Slice Custom Skin + Star/Ribbon Corner Badge
                tempSkin = CreateDemoNineSliceTexture();
                tempBadge = CreateDemoBadgeTexture();
                EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.SakuraPink, false);
                mat.SetFloat("_FrameMode", 1f);
                mat.SetTexture("_SkinTex", tempSkin);
                mat.SetColor("_SkinTint", Color.white);
                mat.SetVector("_SkinSlice", new Vector4(0.28f, 0.28f, 0.28f, 0.28f));
                mat.SetFloat("_SkinBorderEm", 0.65f);
                mat.SetColor("_TextColor", new Color(0.26f, 0.16f, 0.34f, 1f));
                mat.SetFloat("_BadgeEnable", 1f);
                mat.SetTexture("_BadgeTex", tempBadge);
                mat.SetFloat("_BadgeCorner", 1f); // Top-Right
                mat.SetFloat("_BadgeSize", 0.95f);
                mat.SetFloat("_BadgeOffsetX", 0.05f);
                mat.SetFloat("_BadgeOffsetY", 0.12f);
                mat.SetFloat("_BadgeSlot0Only", 0f);
                Snap("preview_nineslice_badge.png", new Color(0.92f, 0.90f, 0.96f, 1f));

                // 5. Custom Baked .ttf Font (KaiTi / YouYuan) + Mint Style
                string winFonts = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Fonts");
                string customTtf = new[] { "simkai.ttf", "SIMYOU.TTF" }
                    .Select(f => Path.Combine(winFonts, f))
                    .FirstOrDefault(File.Exists);
                if (!string.IsNullOrEmpty(customTtf))
                {
                    var kaiTex = EkacBubbleFontBaker.BakeFontAtlas(customTtf, tempCustomFontAsset, 42, 0, null, false);
                    EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.MintWave, false);
                    mat.SetFloat("_WaveAmp", 0f);
                    mat.SetTexture("_AtlasTex", kaiTex);
                    Snap("preview_custom_font.png", new Color(0.88f, 0.94f, 0.92f, 1f));
                }

                Debug.Log("[EkacBubble] GALLERY_RENDER_OK dir=" + outDir);
            }
            finally
            {
                EkacBubbleScenePreview.ClearGlobals();
                savedMatState.ApplyToMaterial(mat, false);
                mat.SetTexture("_AtlasTex", savedAtlas != null ? savedAtlas : defAtlas);
                UnityEngine.Object.DestroyImmediate(savedMatState);
                AssetDatabase.SaveAssets();
                if (AssetDatabase.LoadAssetAtPath<Texture2D>(tempCustomFontAsset) != null)
                    AssetDatabase.DeleteAsset(tempCustomFontAsset);
                if (tempSkin != null) UnityEngine.Object.DestroyImmediate(tempSkin);
                if (tempBadge != null) UnityEngine.Object.DestroyImmediate(tempBadge);
                cam.targetTexture = null;
                UnityEngine.Object.DestroyImmediate(camGo);
                rt.Release();
                UnityEngine.Object.DestroyImmediate(rt);
            }
        }

        private static float HlslSmoothStep(float edge0, float edge1, float x)
        {
            float t = Mathf.Clamp01((x - edge0) / Mathf.Max(edge1 - edge0, 1e-5f));
            return t * t * (3f - 2f * t);
        }

        private static Texture2D CreateDemoNineSliceTexture()
        {
            const int S = 128;
            var t = new Texture2D(S, S, TextureFormat.RGBA32, false);
            t.wrapMode = TextureWrapMode.Clamp;
            for (int y = 0; y < S; y++)
            {
                for (int x = 0; x < S; x++)
                {
                    float dx = Mathf.Max(0f, Mathf.Abs(x - 63.5f) - (63.5f - 24f));
                    float dy = Mathf.Max(0f, Mathf.Abs(y - 63.5f) - (63.5f - 24f));
                    float d = Mathf.Sqrt(dx * dx + dy * dy) - 22f;
                    float outer = 1f - HlslSmoothStep(-1.2f, 1.2f, d);
                    if (outer <= 0.002f)
                    {
                        t.SetPixel(x, y, Color.clear);
                        continue;
                    }
                    float inner1 = 1f - HlslSmoothStep(-1.2f, 1.2f, d + 5.5f);
                    float inner2 = 1f - HlslSmoothStep(-1.2f, 1.2f, d + 9.5f);
                    float inner3 = 1f - HlslSmoothStep(-1.2f, 1.2f, d + 12.5f);

                    Color cBg = Color.Lerp(new Color(1f, 0.97f, 1f, 0.96f), new Color(0.95f, 0.90f, 1f, 0.96f), 1f - y / (float)S);
                    Color cOuterBorder = new Color(0.55f, 0.38f, 0.78f, 1f);
                    Color cInnerRing = new Color(0.96f, 0.78f, 0.90f, 1f);

                    Color col = Color.Lerp(cOuterBorder, Color.white, inner1);
                    col = Color.Lerp(col, cInnerRing, inner2);
                    col = Color.Lerp(col, cBg, inner3);
                    float cx = Mathf.Min(x, S - 1 - x);
                    float cy = Mathf.Min(y, S - 1 - y);
                    if (Mathf.Abs(cx - 18f) + Mathf.Abs(cy - 18f) < 5.5f)
                        col = new Color(1f, 0.75f, 0.32f, 1f);
                    col.a *= outer;
                    t.SetPixel(x, y, col);
                }
            }
            t.Apply();
            return t;
        }

        private static Texture2D CreateDemoBadgeTexture()
        {
            const int S = 96;
            var t = new Texture2D(S, S, TextureFormat.RGBA32, false);
            t.wrapMode = TextureWrapMode.Clamp;
            for (int y = 0; y < S; y++)
            {
                for (int x = 0; x < S; x++)
                {
                    float px = (x - 47.5f) / 38f;
                    float py = (y - 47.5f) / 38f;
                    float ang = Mathf.Atan2(py, px);
                    float r = Mathf.Sqrt(px * px + py * py);
                    float starR = 0.56f + 0.20f * Mathf.Cos(ang * 5f - 1.5708f);
                    float outerMask = 1f - HlslSmoothStep(starR - 0.04f, starR + 0.04f, r);
                    if (outerMask <= 0.002f)
                    {
                        t.SetPixel(x, y, Color.clear);
                        continue;
                    }
                    float innerMask = 1f - HlslSmoothStep(starR - 0.14f, starR - 0.08f, r);
                    Color col = Color.Lerp(new Color(0.88f, 0.44f, 0.58f, 1f), new Color(1.0f, 0.88f, 0.36f, 1f), innerMask);
                    col.a = outerMask;
                    t.SetPixel(x, y, col);
                }
            }
            t.Apply();
            return t;
        }

        private static Animator _verifyTargetAnimator;

        private static void OnBatchDriverApply(VRC.SDKBase.VRC_AvatarParameterDriver behaviour, Animator targetAnim)
        {
            var animator = _verifyTargetAnimator;
            if (animator == null || targetAnim != animator) return;
            if (behaviour.localOnly)
                throw new Exception($"Driver '{behaviour.name}' has localOnly=true which would skip remote players!");
            foreach (var p in behaviour.parameters)
            {
                float ReadFloat(string pName)
                {
                    var cp = animator.parameters.FirstOrDefault(x => x.name == pName);
                    if (cp == null) return 0f;
                    return cp.type switch
                    {
                        AnimatorControllerParameterType.Float => animator.GetFloat(pName),
                        AnimatorControllerParameterType.Int => animator.GetInteger(pName),
                        AnimatorControllerParameterType.Bool => animator.GetBool(pName) ? 1f : 0f,
                        _ => 0f,
                    };
                }
                void WriteFloat(string pName, float val)
                {
                    var cp = animator.parameters.FirstOrDefault(x => x.name == pName);
                    if (cp == null) return;
                    switch (cp.type)
                    {
                        case AnimatorControllerParameterType.Float: animator.SetFloat(pName, val); break;
                        case AnimatorControllerParameterType.Int: animator.SetInteger(pName, Mathf.RoundToInt(val)); break;
                        case AnimatorControllerParameterType.Bool: animator.SetBool(pName, val != 0f); break;
                    }
                }
                switch (p.type)
                {
                    case VRC.SDKBase.VRC_AvatarParameterDriver.ChangeType.Set:
                        WriteFloat(p.name, p.value);
                        break;
                    case VRC.SDKBase.VRC_AvatarParameterDriver.ChangeType.Add:
                        WriteFloat(p.name, ReadFloat(p.name) + p.value);
                        break;
                    case VRC.SDKBase.VRC_AvatarParameterDriver.ChangeType.Copy:
                    {
                        float v = ReadFloat(p.source);
                        if (p.convertRange)
                        {
                            v = !Mathf.Approximately(p.destMax, p.destMin)
                                ? Mathf.Lerp(p.destMin, p.destMax, Mathf.Clamp01(Mathf.InverseLerp(p.sourceMin, p.sourceMax, v)))
                                : p.destMin;
                        }
                        WriteFloat(p.name, v);
                        break;
                    }
                }
            }
        }

        public static void VerifyInBatch()
        {
            try
            {
                EnsureTestingSceneOpen();
                var avatarGo = GameObject.Find("Ayusa");
                if (avatarGo == null)
                    throw new Exception("Ayusa GameObject not found in active scene.");

                // 1. Run NDMF AvatarProcessor build on a temporary clone to check ExpressionParameters & validation
                var clone = UnityEngine.Object.Instantiate(avatarGo);
                clone.name = "Ayusa_NDMF_Verify";
                try
                {
                    AvatarProcessor.ProcessAvatar(clone);
                    var desc = clone.GetComponent<VRCAvatarDescriptor>();
                    int cost = desc.expressionParameters.CalcTotalCost();
                    Debug.Log($"[EkacBubble] NDMF_BUILD_OK totalSyncedBits={cost}/256 paramCount={desc.expressionParameters.parameters.Length}");
                    foreach (var p in desc.expressionParameters.parameters)
                    {
                        if (p.name.StartsWith("EB_"))
                        {
                            Debug.Log($"  param {p.name}: type={p.valueType}, synced={p.networkSynced}, bitWidth={p.bitWidth}, flipped={p.flippedRepresentation}, default={p.defaultValue}, saved={p.saved}");
                        }
                    }
                    if (cost > VRCExpressionParameters.MAX_PARAMETER_COST)
                    {
                        throw new Exception($"Expression parameters cost {cost} exceeds {VRCExpressionParameters.MAX_PARAMETER_COST}");
                    }

                    // Check Shader compilation, Mesh & Constraint & ExpressionsMenu
                    var shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
                    int shaderErrCount = ShaderUtil.GetShaderMessageCount(shader);
                    for (int mi = 0; mi < shaderErrCount; mi++)
                    {
                        var msgs = ShaderUtil.GetShaderMessages(shader);
                        if (msgs[mi].severity == UnityEditor.Rendering.ShaderCompilerMessageSeverity.Error)
                            throw new Exception($"Shader compile error: {msgs[mi].message} line {msgs[mi].line}");
                    }
                    Debug.Log($"[EkacBubble] SHADER_OK messages={shaderErrCount}");

                    var subCtrl = desc.expressionsMenu?.controls?.FirstOrDefault(c => c.name == "头顶气泡");
                    if (subCtrl == null || subCtrl.subMenu == null || subCtrl.subMenu.controls.Count != 6)
                        throw new Exception("ExpressionsMenu '头顶气泡' missing or incomplete after NDMF build!");
                    Debug.Log($"[EkacBubble] MENU_OK controls={string.Join(",", subCtrl.subMenu.controls.Select(c => c.name))}");

                    var mr = clone.GetComponentsInChildren<MeshRenderer>(true)
                        .FirstOrDefault(r => r.sharedMaterial != null && r.sharedMaterial.shader.name == "EkacBubble/SpeechBubble");
                    if (mr == null)
                        throw new Exception("EkacBubble MeshRenderer missing after NDMF build!");
                    var posCons = mr.transform.parent.GetComponent<VRCPositionConstraint>();
                    if (posCons == null || posCons.Sources.Count == 0 || posCons.Sources[0].SourceTransform == null)
                        throw new Exception("VRCPositionConstraint missing or invalid source after NDMF build!");
                    Debug.Log($"[EkacBubble] CONSTRAINT_OK source={posCons.Sources[0].SourceTransform.name} boneProxyParent={posCons.Sources[0].SourceTransform.parent?.name}");

                    // 2. Verify Animator Direct BlendTree & Receiver StateMachine directly
                    var animator = clone.GetComponent<Animator>();
                    animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
                    var fxLayer = desc.baseAnimationLayers.First(l => l.type == VRCAvatarDescriptor.AnimLayerType.FX).animatorController;
                    animator.runtimeAnimatorController = fxLayer;
                    animator.Rebind();

                    var mpb = new MaterialPropertyBlock();
                    float ReadAnimatedFloat(string propName)
                    {
                        mr.GetPropertyBlock(mpb);
                        return mpb.HasFloat(propName) ? mpb.GetFloat(propName) : mr.sharedMaterial.GetFloat(propName);
                    }

                    // Inspect merged Render clip path & check Animator runtime execution
                    var ac = fxLayer as AnimatorController;
                    int rLayerIdx = -1;
                    int s0LayerIdx = -1;
                    int recLayerIdx = -1;
                    for (int li = 0; li < animator.layerCount; li++)
                    {
                        var ln = animator.GetLayerName(li);
                        if (ln == "EkacBubble_Receiver") recLayerIdx = li;
                        else if (ln == "EkacBubble_Slot0_Life") s0LayerIdx = li;
                        else if (ln == "EkacBubble_Render") rLayerIdx = li;
                    }
                    if (ac != null && rLayerIdx >= 0)
                    {
                        var bt = ac.layers[rLayerIdx].stateMachine.defaultState.motion as BlendTree;
                        var firstClip = bt != null && bt.children.Length > 0 ? bt.children[0].motion as AnimationClip : null;
                        if (firstClip != null)
                        {
                            var bindings = AnimationUtility.GetCurveBindings(firstClip);
                            Debug.Log($"[EkacBubble] MERGED_CLIP name={firstClip.name} path={(bindings.Length > 0 ? bindings[0].path : "none")} prop={(bindings.Length > 0 ? bindings[0].propertyName : "none")} layers=({recLayerIdx},{s0LayerIdx},{rLayerIdx})");
                        }
                    }

                    _verifyTargetAnimator = animator;
                    VRC.SDKBase.VRC_AvatarParameterDriver.OnApplySettings += OnBatchDriverApply;
                    try
                    {
                        animator.Update(0f);

                        // Test Config values -> Material (set Height=1.0 to verify Animator actually drives Material!)
                        animator.SetFloat("EB_Height", 1.0f);
                        animator.Update(0.02f);
                        animator.Update(0.02f);
                        float baseHeight = ReadAnimatedFloat("_BaseHeight");
                        float bubbleScale = ReadAnimatedFloat("_BubbleScale");
                        Debug.Log($"[EkacBubble] INIT_MAT _BaseHeight(Height=1)={baseHeight:F3}, _BubbleScale={bubbleScale:F3}, _Enable={ReadAnimatedFloat("_Enable")}");
                        animator.SetFloat("EB_Height", 0.3f);
                        animator.Update(0.02f);
                        if (Mathf.Abs(baseHeight - 0.62f) > 0.02f || Mathf.Abs(ReadAnimatedFloat("_BaseHeight") - 0.27f) > 0.02f)
                            throw new Exception($"Direct BlendTree _BaseHeight check failed! Height=1->{baseHeight:F3}, Height=0.3->{ReadAnimatedFloat("_BaseHeight"):F3}");

                        // Simulate Bubble 1 (4 chars, slice 0 + slice 1)
                        animator.SetInteger("EB_C0_Col", 23);
                        animator.SetInteger("EB_C0_Row", 36); // '你'
                        animator.SetInteger("EB_C1_Col", 12);
                        animator.SetInteger("EB_C1_Row", 20);
                        animator.SetInteger("EB_C2_Col", 5);
                        animator.SetInteger("EB_C2_Row", 2);  // 'W'
                        animator.SetInteger("EB_Slice", 0);
                        animator.SetInteger("EB_Len", 4);
                        animator.SetInteger("EB_Line1", 4);
                        animator.SetInteger("EB_Gen", 1);
                        animator.SetInteger("EB_Seq", 1);
                        for (int f = 0; f < 10; f++) animator.Update(0.02f);

                        // Slice 1 (char 3)
                        animator.SetInteger("EB_C0_Col", 8);
                        animator.SetInteger("EB_C0_Row", 2);
                        animator.SetInteger("EB_Slice", 1);
                        animator.SetInteger("EB_Seq", 2);
                        for (int f = 0; f < 12; f++) animator.Update(0.02f);

                        float s0Col0 = ReadAnimatedFloat("_S0_Col00");
                        float s0Row0 = ReadAnimatedFloat("_S0_Row00");
                        float s0Col3 = ReadAnimatedFloat("_S0_Col03");
                        float s0Len = ReadAnimatedFloat("_S0_Len");
                        float s0Alpha = ReadAnimatedFloat("_S0_Alpha");
                        Debug.Log($"[EkacBubble] BUBBLE1_MAT Col0={s0Col0:F2} Row0={s0Row0:F2} Col3={s0Col3:F2} Len={s0Len:F2} Alpha={s0Alpha:F2}");
                        if (Mathf.Abs(s0Col0 - 23f) > 0.2f || Mathf.Abs(s0Row0 - 36f) > 0.2f || Mathf.Abs(s0Col3 - 8f) > 0.2f || Mathf.Abs(s0Len - 4f) > 0.2f || s0Alpha < 0.1f)
                            throw new Exception("Bubble 1 shader parameters did not propagate properly!");

                        // Advance typing until all 4 chars shown
                        for (int f = 0; f < 30; f++) animator.Update(0.04f); // 1.2s
                        float s0Shown = ReadAnimatedFloat("_S0_Shown");
                        Debug.Log($"[EkacBubble] BUBBLE1_TYPED Shown={s0Shown:F2}, Alpha={ReadAnimatedFloat("_S0_Alpha"):F2}");
                        if (s0Shown < 3.8f)
                            throw new Exception($"Bubble 1 did not finish revealing all 4 chars cleanly (Shown={s0Shown})!");

                        // Push Bubble 2 -> Bubble 1 should move to Slot 1!
                        animator.SetInteger("EB_C0_Col", 51);
                        animator.SetInteger("EB_C0_Row", 0); // 'A'
                        animator.SetInteger("EB_Slice", 0);
                        animator.SetInteger("EB_Len", 1);
                        animator.SetInteger("EB_Line1", 1);
                        animator.SetInteger("EB_Gen", 2);
                        animator.SetInteger("EB_Seq", 3);
                        for (int f = 0; f < 10; f++) animator.Update(0.02f);

                        float b1ToS1Col0 = ReadAnimatedFloat("_S1_Col00");
                        float b1ToS1Row0 = ReadAnimatedFloat("_S1_Row00");
                        float b2ToS0Col0 = ReadAnimatedFloat("_S0_Col00");
                        Debug.Log($"[EkacBubble] PUSH2_MAT S1_Col0={b1ToS1Col0:F2} S1_Row0={b1ToS1Row0:F2} S1_Alpha={ReadAnimatedFloat("_S1_Alpha"):F2} S0_Col0={b2ToS0Col0:F2}");
                        if (Mathf.Abs(b1ToS1Col0 - 23f) > 0.2f || Mathf.Abs(b1ToS1Row0 - 36f) > 0.2f || Mathf.Abs(b2ToS0Col0 - 51f) > 0.2f)
                            throw new Exception("Push Bubble 1 -> Slot 1 failed!");

                        // Push Bubble 3 -> Bubble 1 to Slot 2, Bubble 2 to Slot 1!
                        animator.SetInteger("EB_C0_Col", 37);
                        animator.SetInteger("EB_C0_Row", 0); // '0'
                        animator.SetInteger("EB_Slice", 0);
                        animator.SetInteger("EB_Len", 1);
                        animator.SetInteger("EB_Line1", 1);
                        animator.SetInteger("EB_Gen", 3);
                        animator.SetInteger("EB_Seq", 1);
                        for (int f = 0; f < 10; f++) animator.Update(0.02f);

                        float b1ToS2Col0 = ReadAnimatedFloat("_S2_Col00");
                        float b2ToS1Col0 = ReadAnimatedFloat("_S1_Col00");
                        float b3ToS0Col0 = ReadAnimatedFloat("_S0_Col00");
                        Debug.Log($"[EkacBubble] PUSH3_MAT S2_Col0={b1ToS2Col0:F2} S1_Col0={b2ToS1Col0:F2} S0_Col0={b3ToS0Col0:F2}");
                        if (Mathf.Abs(b1ToS2Col0 - 23f) > 0.2f || Mathf.Abs(b2ToS1Col0 - 51f) > 0.2f || Mathf.Abs(b3ToS0Col0 - 37f) > 0.2f)
                            throw new Exception("Push 3rd bubble stack failed!");

                        // Wait ~4.0s -> Hold timers (~3.0s) + FadeOut (0.25s) should expire all 3 bubbles!
                        for (int f = 0; f < 80; f++) animator.Update(0.05f); // 4.0s
                        float s0After = ReadAnimatedFloat("_S0_Alpha");
                        float s1After = ReadAnimatedFloat("_S1_Alpha");
                        float s2After = ReadAnimatedFloat("_S2_Alpha");
                        Debug.Log($"[EkacBubble] AFTER_HOLD_MAT S0={s0After:F2}, S1={s1After:F2}, S2={s2After:F2}");
                        if (s0After > 0.05f || s1After > 0.05f || s2After > 0.05f)
                            throw new Exception($"Hold timer did not expire bubbles cleanly! S0={s0After}, S1={s1After}, S2={s2After}");

                        // Test Clear pulse resets active bubble immediately
                        animator.SetInteger("EB_Gen", 4);
                        animator.SetInteger("EB_Seq", 2);
                        animator.SetInteger("EB_Len", 1);
                        for (int f = 0; f < 12; f++) animator.Update(0.02f);
                        if (ReadAnimatedFloat("_S0_Alpha") < 0.2f)
                            throw new Exception("Bubble 4 did not become visible before clear test!");
                        animator.SetBool("EB_Clear", true);
                        animator.SetInteger("EB_Gen", 0);
                        for (int f = 0; f < 8; f++) animator.Update(0.02f);
                        if (ReadAnimatedFloat("_S0_Alpha") > 0.05f)
                            throw new Exception("EB_Clear did not clear active bubble!");

                        // Test pushing a mid-FadeOut bubble keeps fading out instead of resurrecting
                        animator.SetBool("EB_Clear", false);
                        for (int f = 0; f < 5; f++) animator.Update(0.02f);
                        animator.SetInteger("EB_C0_Col", 51);
                        animator.SetInteger("EB_C0_Row", 0);
                        animator.SetInteger("EB_Slice", 0);
                        animator.SetInteger("EB_Len", 1);
                        animator.SetInteger("EB_Line1", 1);
                        animator.SetInteger("EB_Gen", 5);
                        animator.SetInteger("EB_Seq", 3);
                        bool enteredFadeOut = false;
                        for (int f = 0; f < 90; f++)
                        {
                            animator.Update(0.05f);
                            float a0 = ReadAnimatedFloat("_S0_Alpha");
                            if (f > 20 && a0 > 0.15f && a0 < 0.85f)
                            {
                                enteredFadeOut = true;
                                break;
                            }
                        }
                        if (!enteredFadeOut)
                            throw new Exception($"Bubble 5 never entered mid-FadeOut! Alpha={ReadAnimatedFloat("_S0_Alpha"):F2}");

                        animator.SetInteger("EB_Gen", 6);
                        animator.SetInteger("EB_Seq", 1);
                        for (int f = 0; f < 8; f++) animator.Update(0.05f); // 0.40s
                        float fadingS1 = ReadAnimatedFloat("_S1_Alpha");
                        float freshS0 = ReadAnimatedFloat("_S0_Alpha");
                        Debug.Log($"[EkacBubble] FADEOUT_PUSH_MAT S1={fadingS1:F2} S0={freshS0:F2}");
                        if (fadingS1 > 0.05f || freshS0 < 0.2f)
                            throw new Exception($"Mid-FadeOut bubble resurrected or new bubble failed! S1={fadingS1:F2}, S0={freshS0:F2}");

                        // 3. Verify Material style preservation across BuildAllAssets() & preset null-texture clearing
                        var sharedMat = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
                        var matSnapshot = ScriptableObject.CreateInstance<EkacBubbleStylePreset>();
                        matSnapshot.CaptureFromMaterial(sharedMat);
                        Texture origAtlas = sharedMat.GetTexture("_AtlasTex");
                        float origBaseHeight = sharedMat.GetFloat("_BaseHeight");
                        try
                        {
                            sharedMat.SetFloat("_CornerRadius", 0.91f);
                            sharedMat.SetFloat("_TextOutlineWidth", 0.085f);
                            sharedMat.SetFloat("_BaseHeight", 0.42f);
                            EditorUtility.SetDirty(sharedMat);
                            BuildAllAssets();
                            var reloadedMat = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
                            if (Mathf.Abs(reloadedMat.GetFloat("_CornerRadius") - 0.91f) > 0.005f ||
                                Mathf.Abs(reloadedMat.GetFloat("_TextOutlineWidth") - 0.085f) > 0.005f ||
                                Mathf.Abs(reloadedMat.GetFloat("_BaseHeight") - 0.42f) > 0.005f)
                            {
                                throw new Exception("BuildAllAssets() overwrote user Material style or _BaseHeight customizations!");
                            }

                            var dummyTex = CreateDemoBadgeTexture();
                            var cleanPreset = ScriptableObject.CreateInstance<EkacBubbleStylePreset>();
                            try
                            {
                                reloadedMat.SetTexture("_SkinTex", dummyTex);
                                reloadedMat.SetTexture("_BadgeTex", dummyTex);
                                cleanPreset.skinTex = null;
                                cleanPreset.badgeTex = null;
                                cleanPreset.ApplyToMaterial(reloadedMat, false);
                                if (reloadedMat.GetTexture("_SkinTex") != null || reloadedMat.GetTexture("_BadgeTex") != null)
                                    throw new Exception("ApplyToMaterial failed to clear null _SkinTex / _BadgeTex!");
                            }
                            finally
                            {
                                UnityEngine.Object.DestroyImmediate(cleanPreset);
                                UnityEngine.Object.DestroyImmediate(dummyTex);
                            }

                            var quadMesh = AssetDatabase.LoadAssetAtPath<Mesh>(QuadPath);
                            if (quadMesh == null || quadMesh.vertices.Max(v => v.y) < 1.25f)
                                throw new Exception("EkacBubbleQuad vertical canvas was not expanded to >= 1.25m!");
                        }
                        finally
                        {
                            var restoreMat = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
                            if (restoreMat != null)
                            {
                                matSnapshot.ApplyToMaterial(restoreMat, false);
                                restoreMat.SetTexture("_AtlasTex", origAtlas);
                                restoreMat.SetFloat("_BaseHeight", origBaseHeight);
                                EditorUtility.SetDirty(restoreMat);
                            }
                            UnityEngine.Object.DestroyImmediate(matSnapshot);
                            AssetDatabase.SaveAssets();
                        }
                        Debug.Log("[EkacBubble] STYLE_PRESERVE_OK");

                        // 4. Verify non-serialized Scene Preview & C# Layout + Glyph Index (4057 glyphs)
                        var checkMat = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
                        int glyphTotal = EkacBubbleFontBaker.LoadedGlyphCount;
                        if (glyphTotal < 4000)
                            throw new Exception($"EkacGlyphIndex loaded too few glyphs: {glyphTotal}");
                        var previewChunks = EkacBubbleFontBaker.LayoutText("今天天气真不错，我们一起去VRChat玩吧！");
                        if (previewChunks.Count != 1 || previewChunks[0].Line1Len <= 0 || previewChunks[0].Line1Len >= previewChunks[0].Len)
                            throw new Exception("C# LayoutText two-line wrap verification failed!");
                        EkacBubbleScenePreview.IsActive = true;
                        if (Shader.GetGlobalFloat("_EB_PreviewActive") < 0.5f)
                            throw new Exception("ScenePreview did not set global _EB_PreviewActive!");
                        if (checkMat.HasProperty("_EB_PreviewActive"))
                            throw new Exception("_EB_PreviewActive must NOT be serialized on Material!");
                        EkacBubbleScenePreview.ClearGlobals();
                        Debug.Log($"[EkacBubble] PREVIEW_AND_INDEX_OK glyphs={glyphTotal}");

                        // 5. Verify pure C# EkacBubbleFontBaker on BOTH ASCII and non-ASCII/Chinese paths
                        byte[] defaultAtlasBytes = File.ReadAllBytes(Path.GetFullPath(AtlasPath));
                        string userRuanTangPath = Path.GetFullPath("Assets/上首软糖体.ttf");
                        if (File.Exists(userRuanTangPath))
                        {
                            string ruanTangOutAsset = EkacBubbleFontBaker.CustomFontsDir + "/上首软糖体_SDF.png";
                            var bakedRuanTang = EkacBubbleFontBaker.BakeFontAtlas(
                                userRuanTangPath,
                                out var rtReport,
                                ruanTangOutAsset,
                                40,
                                0,
                                null,
                                false
                            );
                            if (bakedRuanTang == null || bakedRuanTang.width != 4096 || bakedRuanTang.height != 4096)
                                throw new Exception("上首软糖体_SDF output texture invalid!");
                            if (rtReport.PrimaryRenderedCount < 4000)
                                throw new Exception($"上首软糖体 primary glyph count too low: {rtReport.PrimaryRenderedCount}");
                            byte[] bakedBytes = File.ReadAllBytes(Path.GetFullPath(ruanTangOutAsset));
                            if (bakedBytes.Length < 500_000)
                                throw new Exception($"上首软糖体 PNG unexpectedly small: {bakedBytes.Length} bytes");
                            if (bakedBytes.SequenceEqual(defaultAtlasBytes))
                                throw new Exception("上首软糖体_SDF.png is identical to default EkacGlyphAtlas.png (silent fallback bug)!");

                            var projectMat = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
                            if (projectMat != null)
                            {
                                projectMat.SetTexture("_AtlasTex", bakedRuanTang);
                                EditorUtility.SetDirty(projectMat);
                                AssetDatabase.SaveAssets();
                            }
                            Debug.Log(
                                $"[EkacBubble] FONT_BAKER_UNICODE_OK font=上首软糖体.ttf primary={rtReport.PrimaryRenderedCount} " +
                                $"fallback={rtReport.FallbackRenderedCount} unmatched={rtReport.MissingCount} sizeKB={bakedBytes.Length / 1024}"
                            );
                        }
                        else
                        {
                            string winFonts = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Fonts");
                            string sysFont = new[] { "simkai.ttf", "SIMYOU.TTF", "simhei.ttf", "msyh.ttc" }
                                .Select(f => Path.Combine(winFonts, f))
                                .FirstOrDefault(File.Exists);
                            if (!string.IsNullOrEmpty(sysFont))
                            {
                                string unicodeFontCopy = Path.GetFullPath(RootDir + "/Generated/_测试中文路径字体" + Path.GetExtension(sysFont));
                                string tempAtlasAsset = RootDir + "/Generated/_VerifyTempFont_SDF.png";
                                try
                                {
                                    File.Copy(sysFont, unicodeFontCopy, true);
                                    var bakedTex = EkacBubbleFontBaker.BakeFontAtlas(
                                        unicodeFontCopy,
                                        out var sysReport,
                                        tempAtlasAsset,
                                        40,
                                        0,
                                        null,
                                        false
                                    );
                                    if (bakedTex == null || bakedTex.width != 4096 || bakedTex.height != 4096)
                                        throw new Exception("FontBaker output texture invalid!");
                                    if (sysReport.PrimaryRenderedCount < 3000)
                                        throw new Exception($"Unicode-path FontBaker primary count too low: {sysReport.PrimaryRenderedCount}");
                                    byte[] bakedBytes = File.ReadAllBytes(Path.GetFullPath(tempAtlasAsset));
                                    if (bakedBytes.SequenceEqual(defaultAtlasBytes))
                                        throw new Exception("Baked font PNG silently matched default atlas!");
                                    Debug.Log($"[EkacBubble] FONT_BAKER_UNICODE_OK font={Path.GetFileName(unicodeFontCopy)} primary={sysReport.PrimaryRenderedCount} sizeKB={bakedBytes.Length / 1024}");
                                }
                                finally
                                {
                                    try { if (File.Exists(unicodeFontCopy)) File.Delete(unicodeFontCopy); } catch { }
                                    AssetDatabase.DeleteAsset(tempAtlasAsset);
                                }
                            }
                        }
                    }
                    finally
                    {
                        _verifyTargetAnimator = null;
                        VRC.SDKBase.VRC_AvatarParameterDriver.OnApplySettings -= OnBatchDriverApply;
                    }
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(clone);
                }

                string previewOut = Environment.GetEnvironmentVariable("EKAC_RUANTANG_PREVIEW");
                if (!string.IsNullOrEmpty(previewOut))
                {
                    RenderCurrentMaterialPreviewShot(previewOut);
                }

                string pkgOut = Environment.GetEnvironmentVariable("EKAC_UNITYPACKAGE_OUT");
                if (!string.IsNullOrEmpty(pkgOut))
                {
                    ExportCleanPluginPackage(pkgOut);
                    Debug.Log($"[EkacBubble] EXPORT_PACKAGE_OK path={pkgOut} bytes={new FileInfo(pkgOut).Length}");
                }

                Debug.Log("[EkacBubble] VERIFY_IN_BATCH_PASS");
            }
            catch (Exception ex)
            {
                Debug.LogError("[EkacBubble] VERIFY_IN_BATCH_FAIL: " + ex);
                EditorApplication.Exit(1);
            }
        }

        private static void RenderCurrentMaterialPreviewShot(string pngOutPath)
        {
            var dir = Path.GetDirectoryName(pngOutPath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

            var mat = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            var mr = UnityEngine.Object.FindObjectsOfType<MeshRenderer>()
                .FirstOrDefault(r => r.sharedMaterial == mat);
            if (mat == null || mr == null) return;

            const int W = 960, H = 720;
            var rt = new RenderTexture(W, H, 24, RenderTextureFormat.ARGB32);
            var camGo = new GameObject("_TempRuanTangCam");
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.94f, 0.91f, 0.95f, 1f);
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 20f;
            cam.fieldOfView = 38f;
            cam.targetTexture = rt;

            Vector3 bubbleBase = mr.transform.position + Vector3.up * 0.56f;
            camGo.transform.position = bubbleBase + new Vector3(0f, -0.02f, 1.38f);
            camGo.transform.LookAt(bubbleBase);

            try
            {
                EkacBubbleScenePreview.SlotCount = 3;
                EkacBubbleScenePreview.SetSlotText(0, "上首软糖体烘焙成功啦！");
                EkacBubbleScenePreview.SetSlotText(1, "中文路径与文件名现已完美支持～");
                EkacBubbleScenePreview.SetSlotText(2, "圆润Q弹字形，零额外同步参数！");
                EkacBubbleScenePreview.IsActive = true;
                EkacBubbleScenePreview.PushPreviewBuffers();

                cam.Render();
                RenderTexture.active = rt;
                var shot = new Texture2D(W, H, TextureFormat.RGB24, false);
                shot.ReadPixels(new Rect(0, 0, W, H), 0, 0);
                shot.Apply();
                File.WriteAllBytes(pngOutPath, shot.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(shot);
                RenderTexture.active = null;
                Debug.Log("[EkacBubble] RUANTANG_PREVIEW_OK path=" + pngOutPath);
            }
            finally
            {
                EkacBubbleScenePreview.ClearGlobals();
                cam.targetTexture = null;
                UnityEngine.Object.DestroyImmediate(camGo);
                rt.Release();
                UnityEngine.Object.DestroyImmediate(rt);
            }
        }

        public static void BuildAllAssets()
        {
            EnsureDir(GeneratedDir);
            ConfigureAtlasTexture();
            var quad = BuildQuadMesh();
            var mat = BuildMaterial();
            var controller = BuildFxController();
            BuildPrefab(quad, mat, controller);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
        }

        private static void EnsureDir(string assetFolder)
        {
            var parts = assetFolder.Split('/');
            string cur = parts[0];
            for (int i = 1; i < parts.Length; i++)
            {
                string next = cur + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next))
                {
                    AssetDatabase.CreateFolder(cur, parts[i]);
                }
                cur = next;
            }
        }

        private static void ConfigureAtlasTexture()
        {
            AssetDatabase.ImportAsset(AtlasPath, ImportAssetOptions.ForceUpdate);
            var importer = AssetImporter.GetAtPath(AtlasPath) as TextureImporter;
            if (importer == null)
                throw new Exception("Missing font atlas at " + AtlasPath);

            importer.textureType = TextureImporterType.SingleChannel;
            importer.sRGBTexture = false;
            importer.alphaSource = TextureImporterAlphaSource.None;
            importer.mipmapEnabled = true;
            importer.streamingMipmaps = true;
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.filterMode = FilterMode.Bilinear;
            importer.maxTextureSize = 4096;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;
            var settings = importer.GetDefaultPlatformTextureSettings();
            settings.maxTextureSize = 4096;
            settings.textureCompression = TextureImporterCompression.CompressedHQ;
            importer.SetPlatformTextureSettings(settings);

            var standalone = importer.GetPlatformTextureSettings("Standalone");
            standalone.overridden = true;
            standalone.maxTextureSize = 4096;
            standalone.format = TextureImporterFormat.BC4;
            importer.SetPlatformTextureSettings(standalone);

            importer.SaveAndReimport();
        }

        private static Mesh BuildQuadMesh()
        {
            var mesh = AssetDatabase.LoadAssetAtPath<Mesh>(QuadPath);
            if (mesh == null)
            {
                mesh = new Mesh();
                AssetDatabase.CreateAsset(mesh, QuadPath);
            }
            mesh.Clear();
            mesh.name = "EkacBubbleQuad";
            mesh.vertices = new[]
            {
                new Vector3(-0.60f, -0.12f, 0f),
                new Vector3( 0.60f, -0.12f, 0f),
                new Vector3(-0.60f,  1.28f, 0f),
                new Vector3( 0.60f,  1.28f, 0f),
            };
            mesh.uv = new[]
            {
                new Vector2(0f, 0f),
                new Vector2(1f, 0f),
                new Vector2(0f, 1f),
                new Vector2(1f, 1f),
            };
            mesh.triangles = new[] { 0, 2, 1, 2, 3, 1 };
            mesh.RecalculateNormals();
            // Generous bounds so Cylindrical Billboard & height/scale changes never frustum-cull early
            mesh.bounds = new Bounds(new Vector3(0f, 0.58f, 0f), new Vector3(2.8f, 3.0f, 2.8f));
            EditorUtility.SetDirty(mesh);
            return mesh;
        }

        private static Material BuildMaterial()
        {
            var shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            if (shader == null)
                throw new Exception("Missing shader at " + ShaderPath);
            var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(AtlasPath);
            if (tex == null)
                throw new Exception("Missing texture at " + AtlasPath);

            var mat = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            bool isNew = (mat == null);
            if (isNew)
            {
                mat = new Material(shader);
                AssetDatabase.CreateAsset(mat, MaterialPath);
                mat.SetTexture("_AtlasTex", tex);
                EkacBubbleStylePreset.ApplyBuiltInPreset(mat, EkacBuiltInPreset.SakuraPink, false);
                mat.SetFloat("_BaseHeight", 0.28f);
                mat.SetFloat("_BubbleScale", 1.0f);
            }
            else
            {
                mat.shader = shader;
                if (mat.GetTexture("_AtlasTex") == null)
                {
                    mat.SetTexture("_AtlasTex", tex);
                }
            }

            mat.SetFloat("_Enable", 1.0f);

            for (int s = 0; s < SlotCount; s++)
            {
                mat.SetFloat($"_S{s}_Alpha", 0f);
                mat.SetFloat($"_S{s}_Len", 0f);
                mat.SetFloat($"_S{s}_Line1", 0f);
                mat.SetFloat($"_S{s}_Shown", 0f);
                mat.SetFloat($"_S{s}_Sub", 0f);
                for (int k = 0; k < MaxChars; k++)
                {
                    mat.SetFloat($"_S{s}_Col{k:D2}", 0f);
                    mat.SetFloat($"_S{s}_Row{k:D2}", 0f);
                }
            }
            EditorUtility.SetDirty(mat);
            return mat;
        }

        private static AnimationClip CreateClip(AnimatorController controller, string name)
        {
            var clip = new AnimationClip { name = name };
            AssetDatabase.AddObjectToAsset(clip, controller);
            return clip;
        }

        private static void SetAnimParamCurve(AnimationClip clip, string paramName, float startVal, float endVal, float duration)
        {
            var curve = AnimationCurve.Linear(0f, startVal, duration, endVal);
            if (Mathf.Approximately(startVal, endVal))
            {
                curve = new AnimationCurve(new Keyframe(0f, startVal), new Keyframe(duration, startVal));
            }
            clip.SetCurve("", typeof(Animator), paramName, curve);
        }

        private static void SetMaterialScalarCurve(AnimationClip clip, string matProp, float value)
        {
            var curve = new AnimationCurve(new Keyframe(0f, value), new Keyframe(1f / 60f, value));
            clip.SetCurve("BubbleAnchor/BubbleMesh", typeof(MeshRenderer), "material." + matProp, curve);
        }

        private static AnimatorStateTransition AddInstantTransition(AnimatorState from, AnimatorState to)
        {
            var tr = from.AddTransition(to);
            tr.hasExitTime = false;
            tr.exitTime = 0f;
            tr.duration = 0f;
            tr.hasFixedDuration = true;
            tr.canTransitionToSelf = false;
            return tr;
        }

        private static AnimatorStateTransition AddAlwaysInstant(AnimatorState from, AnimatorState to)
        {
            var tr = AddInstantTransition(from, to);
            tr.AddCondition(AnimatorConditionMode.Greater, 0.5f, "EB_One");
            return tr;
        }

        private static AnimatorStateTransition AddExitTransition(AnimatorState from, AnimatorState to, float exitTime = 1f)
        {
            var tr = from.AddTransition(to);
            tr.hasExitTime = true;
            tr.exitTime = exitTime;
            tr.duration = 0f;
            tr.hasFixedDuration = true;
            tr.canTransitionToSelf = false;
            return tr;
        }

        private static AnimatorController BuildFxController()
        {
            if (AssetDatabase.LoadAssetAtPath<AnimatorController>(ControllerPath) != null)
            {
                AssetDatabase.DeleteAsset(ControllerPath);
            }

            var ctrl = AnimatorController.CreateAnimatorControllerAtPath(ControllerPath);
            // Remove default Base Layer cleanly after adding ours (or rename Base Layer)
            AddAllAnimatorParameters(ctrl);

            var dummy003 = CreateClip(ctrl, "EB_Dummy_003");
            SetAnimParamCurve(dummy003, "EB_DummySink", 0f, 0f, 0.03f);

            var dummy005 = CreateClip(ctrl, "EB_Dummy_005");
            SetAnimParamCurve(dummy005, "EB_DummySink", 0f, 0f, 0.05f);

            var dummy010 = CreateClip(ctrl, "EB_Dummy_010");
            SetAnimParamCurve(dummy010, "EB_DummySink", 0f, 0f, 0.10f);

            // 1. Config & Enable Layers (Base layer reused as Config)
            BuildConfigAndEnableLayers(ctrl);

            // 2. Receiver Layer (Push + Slice Copy)
            BuildReceiverLayer(ctrl, dummy003);

            // 3. Slot 0..2 Lifecycle Layers (FadeIn -> CharStep -> Hold 3s -> FadeOut)
            for (int s = 0; s < SlotCount; s++)
            {
                BuildSlotLifecycleLayer(ctrl, s, dummy003, dummy005, dummy010);
            }

            // 4. Render Direct BlendTree Layer (maps Slot 0..2 local params -> Material floats)
            BuildRenderLayer(ctrl);

            EditorUtility.SetDirty(ctrl);
            return ctrl;
        }

        private static void AddParam(AnimatorController ctrl, string name, AnimatorControllerParameterType type, float defaultFloat = 0f, int defaultInt = 0, bool defaultBool = false)
        {
            ctrl.AddParameter(new AnimatorControllerParameter
            {
                name = name,
                type = type,
                defaultFloat = defaultFloat,
                defaultInt = defaultInt,
                defaultBool = defaultBool,
            });
        }

        private static void AddAllAnimatorParameters(AnimatorController ctrl)
        {
            // Synced parameters
            AddParam(ctrl, "EB_Enable", AnimatorControllerParameterType.Bool, defaultBool: true);
            AddParam(ctrl, "EB_Clear", AnimatorControllerParameterType.Bool, defaultBool: false);
            for (int c = 0; c < SliceSize; c++)
            {
                AddParam(ctrl, $"EB_C{c}_Col", AnimatorControllerParameterType.Int);
                AddParam(ctrl, $"EB_C{c}_Row", AnimatorControllerParameterType.Int);
            }
            AddParam(ctrl, "EB_Slice", AnimatorControllerParameterType.Int);
            AddParam(ctrl, "EB_Seq", AnimatorControllerParameterType.Int);
            AddParam(ctrl, "EB_Gen", AnimatorControllerParameterType.Int);
            AddParam(ctrl, "EB_Len", AnimatorControllerParameterType.Int);
            AddParam(ctrl, "EB_Line1", AnimatorControllerParameterType.Int);

            AddParam(ctrl, "EB_Speed", AnimatorControllerParameterType.Float, defaultFloat: 0.5f);
            AddParam(ctrl, "EB_Hold", AnimatorControllerParameterType.Float, defaultFloat: 0.5f);
            AddParam(ctrl, "EB_Height", AnimatorControllerParameterType.Float, defaultFloat: 0.3f);
            AddParam(ctrl, "EB_Scale", AnimatorControllerParameterType.Float, defaultFloat: 0.5f);

            // Local derived / timing parameters
            AddParam(ctrl, "EB_SpeedMul", AnimatorControllerParameterType.Float, defaultFloat: 1.0f);
            AddParam(ctrl, "EB_HoldSpeedMul", AnimatorControllerParameterType.Float, defaultFloat: 0.3333f);
            AddParam(ctrl, "EB_DummySink", AnimatorControllerParameterType.Float, defaultFloat: 0f);
            AddParam(ctrl, "EB_One", AnimatorControllerParameterType.Float, defaultFloat: 1.0f);

            for (int s = 0; s < SlotCount; s++)
            {
                AddParam(ctrl, $"EB_S{s}_Active", AnimatorControllerParameterType.Bool);
                AddParam(ctrl, $"EB_S{s}_PushTrig", AnimatorControllerParameterType.Bool);
                AddParam(ctrl, $"EB_S{s}_Len", AnimatorControllerParameterType.Int);
                AddParam(ctrl, $"EB_S{s}_Line1", AnimatorControllerParameterType.Int);
                AddParam(ctrl, $"EB_S{s}_Shown", AnimatorControllerParameterType.Int);
                AddParam(ctrl, $"EB_S{s}_Remaining", AnimatorControllerParameterType.Int);

                AddParam(ctrl, $"EB_S{s}_LenNorm", AnimatorControllerParameterType.Float);
                AddParam(ctrl, $"EB_S{s}_Line1Norm", AnimatorControllerParameterType.Float);
                AddParam(ctrl, $"EB_S{s}_ShownNorm", AnimatorControllerParameterType.Float);
                AddParam(ctrl, $"EB_S{s}_SubChar", AnimatorControllerParameterType.Float);
                AddParam(ctrl, $"EB_S{s}_HoldLeft", AnimatorControllerParameterType.Float);
                AddParam(ctrl, $"EB_S{s}_Alpha", AnimatorControllerParameterType.Float);

                for (int k = 0; k < MaxChars; k++)
                {
                    AddParam(ctrl, $"EB_S{s}_Col{k:D2}", AnimatorControllerParameterType.Float);
                    AddParam(ctrl, $"EB_S{s}_Row{k:D2}", AnimatorControllerParameterType.Float);
                }
            }
        }

        private static AnimatorControllerLayer AddLayer(AnimatorController ctrl, string name)
        {
            var layer = new AnimatorControllerLayer
            {
                name = name,
                defaultWeight = 1f,
                stateMachine = new AnimatorStateMachine { name = name, hideFlags = HideFlags.HideInHierarchy },
            };
            AssetDatabase.AddObjectToAsset(layer.stateMachine, ctrl);
            ctrl.AddLayer(layer);
            return layer;
        }

        private static void BuildConfigAndEnableLayers(AnimatorController ctrl)
        {
            // Reuse Layer 0 ("Base Layer" -> rename to EkacBubble_Enable)
            var layers = ctrl.layers;
            var enableLayer = layers[0];
            enableLayer.name = "EkacBubble_Enable";
            enableLayer.defaultWeight = 1f;
            ctrl.layers = layers;

            var smEn = enableLayer.stateMachine;
            var clipOn = CreateClip(ctrl, "EB_Enable_On");
            SetMaterialScalarCurve(clipOn, "_Enable", 1f);
            var clipOff = CreateClip(ctrl, "EB_Enable_Off");
            SetMaterialScalarCurve(clipOff, "_Enable", 0f);

            var stOn = smEn.AddState("On");
            stOn.writeDefaultValues = false;
            stOn.motion = clipOn;
            var stOff = smEn.AddState("Off");
            stOff.writeDefaultValues = false;
            stOff.motion = clipOff;
            smEn.defaultState = stOn;

            var trOff = AddInstantTransition(stOn, stOff);
            trOff.AddCondition(AnimatorConditionMode.IfNot, 0f, "EB_Enable");
            var trOn = AddInstantTransition(stOff, stOn);
            trOn.AddCondition(AnimatorConditionMode.If, 0f, "EB_Enable");

            // Config Speed & Hold mapping layers (separate 1D BlendTrees)
            Build1DParamLayer(ctrl, "EkacBubble_SpeedCfg", "EB_Speed", "EB_SpeedMul", new[]
            {
                (0.00f, 0.32f), // 4.0 chars/s
                (0.50f, 1.00f), // 12.5 chars/s (default)
                (1.00f, 2.00f), // 25.0 chars/s
            });

            Build1DParamLayer(ctrl, "EkacBubble_HoldCfg", "EB_Hold", "EB_HoldSpeedMul", new[]
            {
                (0.00f, 2.0000f), // 0.50s
                (0.25f, 0.5714f), // 1.75s
                (0.50f, 0.3333f), // 3.00s (default)
                (0.75f, 0.2222f), // 4.50s
                (1.00f, 0.1667f), // 6.00s
            });
        }

        private static void Build1DParamLayer(
            AnimatorController ctrl,
            string layerName,
            string driverParam,
            string targetAnimParam,
            (float threshold, float value)[] points)
        {
            var layer = AddLayer(ctrl, layerName);
            var bt = new BlendTree
            {
                name = layerName + "_BT",
                blendType = BlendTreeType.Simple1D,
                blendParameter = driverParam,
                useAutomaticThresholds = false,
                hideFlags = HideFlags.HideInHierarchy,
            };
            AssetDatabase.AddObjectToAsset(bt, ctrl);

            foreach (var (th, val) in points)
            {
                var clip = CreateClip(ctrl, $"{layerName}_{th:F2}");
                SetAnimParamCurve(clip, targetAnimParam, val, val, 1f / 60f);
                bt.AddChild(clip, th);
            }

            var st = layer.stateMachine.AddState("Map");
            st.writeDefaultValues = false;
            st.motion = bt;
            layer.stateMachine.defaultState = st;
        }

        private static VRCAvatarParameterDriver AddDriver(AnimatorState state)
        {
            var d = state.AddStateMachineBehaviour<VRCAvatarParameterDriver>();
            // Must be false so remote VRChat clients run the exact same local state copy & reveal animation!
            d.localOnly = false;
            return d;
        }

        private static void CopyParam(VRCAvatarParameterDriver driver, string src, string dst)
        {
            driver.parameters.Add(new VRC.SDKBase.VRC_AvatarParameterDriver.Parameter
            {
                type = VRC.SDKBase.VRC_AvatarParameterDriver.ChangeType.Copy,
                source = src,
                name = dst,
                convertRange = false,
            });
        }

        private static void CopyRange(VRCAvatarParameterDriver driver, string src, string dst, float sMin, float sMax, float dMin, float dMax)
        {
            driver.parameters.Add(new VRC.SDKBase.VRC_AvatarParameterDriver.Parameter
            {
                type = VRC.SDKBase.VRC_AvatarParameterDriver.ChangeType.Copy,
                source = src,
                name = dst,
                convertRange = true,
                sourceMin = sMin,
                sourceMax = sMax,
                destMin = dMin,
                destMax = dMax,
            });
        }

        private static void SetParam(VRCAvatarParameterDriver driver, string name, float val)
        {
            driver.parameters.Add(new VRC.SDKBase.VRC_AvatarParameterDriver.Parameter
            {
                type = VRC.SDKBase.VRC_AvatarParameterDriver.ChangeType.Set,
                name = name,
                value = val,
            });
        }

        private static void AddParamVal(VRCAvatarParameterDriver driver, string name, float val)
        {
            driver.parameters.Add(new VRC.SDKBase.VRC_AvatarParameterDriver.Parameter
            {
                type = VRC.SDKBase.VRC_AvatarParameterDriver.ChangeType.Add,
                name = name,
                value = val,
            });
        }

        private static void BuildReceiverLayer(AnimatorController ctrl, AnimationClip dummyClip)
        {
            var layer = AddLayer(ctrl, "EkacBubble_Receiver");
            var sm = layer.stateMachine;

            var idleStates = new AnimatorState[GenStates, SeqStates];
            for (int g = 0; g < GenStates; g++)
            {
                for (int s = 0; s < SeqStates; s++)
                {
                    var st = sm.AddState($"Idle_{g}_{s}");
                    st.writeDefaultValues = false;
                    st.motion = dummyClip;
                    idleStates[g, s] = st;
                }
            }
            sm.defaultState = idleStates[0, 0];

            var routeGen = sm.AddState("RouteGen");
            routeGen.writeDefaultValues = false;
            routeGen.motion = dummyClip;

            var routeSeq = new AnimatorState[GenStates];
            for (int g = 0; g < GenStates; g++)
            {
                var st = sm.AddState($"RouteSeq_{g}");
                st.writeDefaultValues = false;
                st.motion = dummyClip;
                routeSeq[g] = st;

                var toG = AddInstantTransition(routeGen, st);
                toG.AddCondition(AnimatorConditionMode.Equals, g, "EB_Gen");

                for (int s = 0; s < SeqStates; s++)
                {
                    var toGS = AddInstantTransition(st, idleStates[g, s]);
                    toGS.AddCondition(AnimatorConditionMode.Equals, s, "EB_Seq");
                }
            }

            // DoClear: reset all 3 slots and pulse PushTrig so Slot Life FSMs reset to Hidden
            var doClear = sm.AddState("DoClear");
            doClear.writeDefaultValues = false;
            doClear.motion = dummyClip;
            var clearDrv = AddDriver(doClear);
            for (int sl = 0; sl < SlotCount; sl++)
            {
                SetParam(clearDrv, $"EB_S{sl}_Active", 0f);
                SetParam(clearDrv, $"EB_S{sl}_Len", 0f);
                SetParam(clearDrv, $"EB_S{sl}_Line1", 0f);
                SetParam(clearDrv, $"EB_S{sl}_Shown", 0f);
                SetParam(clearDrv, $"EB_S{sl}_Remaining", 0f);
                SetParam(clearDrv, $"EB_S{sl}_Alpha", 0f);
                SetParam(clearDrv, $"EB_S{sl}_HoldLeft", 0f);
                SetParam(clearDrv, $"EB_S{sl}_PushTrig", 1f);
            }
            AddAlwaysInstant(doClear, routeGen);

            // DispatchSlice + WriteSlice_0..7
            var dispatchSlice = sm.AddState("DispatchSlice");
            dispatchSlice.writeDefaultValues = false;
            dispatchSlice.motion = dummyClip;

            for (int slice = 0; slice < NumSlices; slice++)
            {
                var ws = sm.AddState($"WriteSlice_{slice}");
                ws.writeDefaultValues = false;
                ws.motion = dummyClip;
                var wd = AddDriver(ws);

                int baseIdx = slice * SliceSize;
                for (int c = 0; c < SliceSize; c++)
                {
                    int k = baseIdx + c;
                    if (k < MaxChars)
                    {
                        CopyRange(wd, $"EB_C{c}_Col", $"EB_S0_Col{k:D2}", 0f, 63f, 0f, 1f);
                        CopyRange(wd, $"EB_C{c}_Row", $"EB_S0_Row{k:D2}", 0f, 63f, 0f, 1f);
                    }
                }
                CopyParam(wd, "EB_Len", "EB_S0_Len");
                CopyParam(wd, "EB_Line1", "EB_S0_Line1");
                CopyRange(wd, "EB_Len", "EB_S0_LenNorm", 0f, MaxChars, 0f, 1f);
                CopyRange(wd, "EB_Line1", "EB_S0_Line1Norm", 0f, MaxChars, 0f, 1f);

                var toWs = AddInstantTransition(dispatchSlice, ws);
                toWs.AddCondition(AnimatorConditionMode.Equals, slice, "EB_Slice");
                AddAlwaysInstant(ws, routeGen);
            }

            // DoPush: Slot2 <- Slot1, Slot1 <- Slot0, reset Slot0, pulse PushTrig for all slots
            var doPush = sm.AddState("DoPush");
            doPush.writeDefaultValues = false;
            doPush.motion = dummyClip;
            var pd = AddDriver(doPush);

            // Slot 2 <- Slot 1
            CopyParam(pd, "EB_S1_Active", "EB_S2_Active");
            CopyParam(pd, "EB_S1_Len", "EB_S2_Len");
            CopyParam(pd, "EB_S1_Line1", "EB_S2_Line1");
            CopyParam(pd, "EB_S1_Shown", "EB_S2_Shown");
            CopyParam(pd, "EB_S1_Remaining", "EB_S2_Remaining");
            CopyParam(pd, "EB_S1_Alpha", "EB_S2_Alpha");
            CopyParam(pd, "EB_S1_HoldLeft", "EB_S2_HoldLeft");
            for (int k = 0; k < MaxChars; k++)
            {
                CopyParam(pd, $"EB_S1_Col{k:D2}", $"EB_S2_Col{k:D2}");
                CopyParam(pd, $"EB_S1_Row{k:D2}", $"EB_S2_Row{k:D2}");
            }

            // Slot 1 <- Slot 0
            CopyParam(pd, "EB_S0_Active", "EB_S1_Active");
            CopyParam(pd, "EB_S0_Len", "EB_S1_Len");
            CopyParam(pd, "EB_S0_Line1", "EB_S1_Line1");
            CopyParam(pd, "EB_S0_Shown", "EB_S1_Shown");
            CopyParam(pd, "EB_S0_Remaining", "EB_S1_Remaining");
            CopyParam(pd, "EB_S0_Alpha", "EB_S1_Alpha");
            CopyParam(pd, "EB_S0_HoldLeft", "EB_S1_HoldLeft");
            for (int k = 0; k < MaxChars; k++)
            {
                CopyParam(pd, $"EB_S0_Col{k:D2}", $"EB_S1_Col{k:D2}");
                CopyParam(pd, $"EB_S0_Row{k:D2}", $"EB_S1_Row{k:D2}");
            }

            // Reset Slot 0 for new bubble
            SetParam(pd, "EB_S0_Active", 1f);
            CopyParam(pd, "EB_Len", "EB_S0_Len");
            CopyParam(pd, "EB_Line1", "EB_S0_Line1");
            SetParam(pd, "EB_S0_Shown", 0f);
            CopyParam(pd, "EB_Len", "EB_S0_Remaining");
            SetParam(pd, "EB_S0_Alpha", 0f);
            SetParam(pd, "EB_S0_HoldLeft", 1f);
            for (int k = 0; k < MaxChars; k++)
            {
                SetParam(pd, $"EB_S0_Col{k:D2}", 0f);
                SetParam(pd, $"EB_S0_Row{k:D2}", 0f);
            }

            SetParam(pd, "EB_S2_PushTrig", 1f);
            SetParam(pd, "EB_S1_PushTrig", 1f);
            SetParam(pd, "EB_S0_PushTrig", 1f);

            // After Push, if EB_Seq != 0 immediately write initial Slice, else route to Idle
            var pushToSlice = AddInstantTransition(doPush, dispatchSlice);
            pushToSlice.AddCondition(AnimatorConditionMode.NotEqual, 0, "EB_Seq");
            var pushToRoute = AddInstantTransition(doPush, routeGen);
            pushToRoute.AddCondition(AnimatorConditionMode.Equals, 0, "EB_Seq");

            // Wire Idle_{g}_{s} transitions in strict priority order: Clear -> Push -> Slice
            for (int g = 0; g < GenStates; g++)
            {
                for (int s = 0; s < SeqStates; s++)
                {
                    var st = idleStates[g, s];

                    var trClr = AddInstantTransition(st, doClear);
                    trClr.AddCondition(AnimatorConditionMode.If, 0f, "EB_Clear");

                    if (g != 0)
                    {
                        var trGenZero = AddInstantTransition(st, doClear);
                        trGenZero.AddCondition(AnimatorConditionMode.Equals, 0, "EB_Gen");
                    }

                    var trPush = AddInstantTransition(st, doPush);
                    trPush.AddCondition(AnimatorConditionMode.NotEqual, g, "EB_Gen");
                    trPush.AddCondition(AnimatorConditionMode.NotEqual, 0, "EB_Gen");
                    trPush.AddCondition(AnimatorConditionMode.Greater, 0, "EB_Len");
                    trPush.AddCondition(AnimatorConditionMode.IfNot, 0f, "EB_Clear");

                    if (g != 0)
                    {
                        var trSeq = AddInstantTransition(st, dispatchSlice);
                        trSeq.AddCondition(AnimatorConditionMode.NotEqual, s, "EB_Seq");
                        trSeq.AddCondition(AnimatorConditionMode.NotEqual, 0, "EB_Seq");
                        trSeq.AddCondition(AnimatorConditionMode.Equals, g, "EB_Gen");
                        trSeq.AddCondition(AnimatorConditionMode.IfNot, 0f, "EB_Clear");
                    }
                }
            }
        }

        private static void BuildSlotLifecycleLayer(
            AnimatorController ctrl,
            int s,
            AnimationClip dummy003,
            AnimationClip dummy005,
            AnimationClip dummy010)
        {
            var layer = AddLayer(ctrl, $"EkacBubble_Slot{s}_Life");
            var sm = layer.stateMachine;

            var subZero = CreateClip(ctrl, $"EB_S{s}_SubZero");
            SetAnimParamCurve(subZero, $"EB_S{s}_SubChar", 0f, 0f, 0.03f);

            var subStepClip = CreateClip(ctrl, $"EB_S{s}_SubCharStep");
            SetAnimParamCurve(subStepClip, $"EB_S{s}_SubChar", 0f, 1f, 0.08f);

            var holdSubZero010 = CreateClip(ctrl, $"EB_S{s}_HoldClip");
            SetAnimParamCurve(holdSubZero010, $"EB_S{s}_SubChar", 0f, 0f, 0.10f);

            var fadeSubZero005 = CreateClip(ctrl, $"EB_S{s}_FadeClip");
            SetAnimParamCurve(fadeSubZero005, $"EB_S{s}_SubChar", 0f, 0f, 0.05f);

            // Hidden
            var stHidden = sm.AddState("Hidden");
            stHidden.writeDefaultValues = false;
            stHidden.motion = subZero;
            var hd = AddDriver(stHidden);
            SetParam(hd, $"EB_S{s}_Active", 0f);
            SetParam(hd, $"EB_S{s}_Alpha", 0f);
            SetParam(hd, $"EB_S{s}_Shown", 0f);
            SetParam(hd, $"EB_S{s}_ShownNorm", 0f);
            SetParam(hd, $"EB_S{s}_LenNorm", 0f);
            SetParam(hd, $"EB_S{s}_Line1Norm", 0f);
            SetParam(hd, $"EB_S{s}_Remaining", 0f);
            SetParam(hd, $"EB_S{s}_HoldLeft", 0f);
            sm.defaultState = stHidden;

            // SyncEntry (triggered on PushTrig from Receiver)
            var stSync = sm.AddState("SyncEntry");
            stSync.writeDefaultValues = false;
            stSync.motion = subZero;
            var sd = AddDriver(stSync);
            SetParam(sd, $"EB_S{s}_PushTrig", 0f);
            CopyRange(sd, $"EB_S{s}_Len", $"EB_S{s}_LenNorm", 0f, MaxChars, 0f, 1f);
            CopyRange(sd, $"EB_S{s}_Line1", $"EB_S{s}_Line1Norm", 0f, MaxChars, 0f, 1f);
            CopyRange(sd, $"EB_S{s}_Shown", $"EB_S{s}_ShownNorm", 0f, MaxChars, 0f, 1f);

            var anyToSync = sm.AddAnyStateTransition(stSync);
            anyToSync.hasExitTime = false;
            anyToSync.duration = 0f;
            anyToSync.canTransitionToSelf = false;
            anyToSync.AddCondition(AnimatorConditionMode.If, 0f, $"EB_S{s}_PushTrig");

            // FadeIn A <-> B (4 * 0.03s = 0.12s smooth pop-in & upward glide)
            var stFadeInA = sm.AddState("FadeInA");
            stFadeInA.writeDefaultValues = false;
            stFadeInA.motion = subZero;
            AddParamVal(AddDriver(stFadeInA), $"EB_S{s}_Alpha", 0.25f);

            var stFadeInB = sm.AddState("FadeInB");
            stFadeInB.writeDefaultValues = false;
            stFadeInB.motion = subZero;
            AddParamVal(AddDriver(stFadeInB), $"EB_S{s}_Alpha", 0.25f);

            var stFadeInDone = sm.AddState("FadeInDone");
            stFadeInDone.writeDefaultValues = false;
            stFadeInDone.motion = subZero;
            SetParam(AddDriver(stFadeInDone), $"EB_S{s}_Alpha", 1.0f);

            // CharStep -> CharAdvance
            var stCharStep = sm.AddState("CharStep");
            stCharStep.writeDefaultValues = false;
            stCharStep.motion = subStepClip;
            stCharStep.speedParameterActive = true;
            stCharStep.speedParameter = "EB_SpeedMul";

            var stCharAdv = sm.AddState("CharAdvance");
            stCharAdv.writeDefaultValues = false;
            stCharAdv.motion = subZero;
            var cad = AddDriver(stCharAdv);
            AddParamVal(cad, $"EB_S{s}_Shown", 1f);
            AddParamVal(cad, $"EB_S{s}_Remaining", -1f);
            CopyRange(cad, $"EB_S{s}_Shown", $"EB_S{s}_ShownNorm", 0f, MaxChars, 0f, 1f);

            // HoldInit -> HoldA <-> HoldB (10 * 0.1s scaled by EB_HoldSpeedMul -> default 3.0s)
            var stHoldInit = sm.AddState("HoldInit");
            stHoldInit.writeDefaultValues = false;
            stHoldInit.motion = holdSubZero010;
            var hid = AddDriver(stHoldInit);
            SetParam(hid, $"EB_S{s}_Alpha", 1.0f);
            SetParam(hid, $"EB_S{s}_HoldLeft", 1.0f);

            var stHoldA = sm.AddState("HoldA");
            stHoldA.writeDefaultValues = false;
            stHoldA.motion = holdSubZero010;
            stHoldA.speedParameterActive = true;
            stHoldA.speedParameter = "EB_HoldSpeedMul";
            AddParamVal(AddDriver(stHoldA), $"EB_S{s}_HoldLeft", -0.1f);

            var stHoldB = sm.AddState("HoldB");
            stHoldB.writeDefaultValues = false;
            stHoldB.motion = holdSubZero010;
            stHoldB.speedParameterActive = true;
            stHoldB.speedParameter = "EB_HoldSpeedMul";
            AddParamVal(AddDriver(stHoldB), $"EB_S{s}_HoldLeft", -0.1f);

            // FadeOutA <-> FadeOutB (5 * 0.05s = 0.25s)
            var stFadeOutA = sm.AddState("FadeOutA");
            stFadeOutA.writeDefaultValues = false;
            stFadeOutA.motion = fadeSubZero005;
            AddParamVal(AddDriver(stFadeOutA), $"EB_S{s}_Alpha", -0.2f);

            var stFadeOutB = sm.AddState("FadeOutB");
            stFadeOutB.writeDefaultValues = false;
            stFadeOutB.motion = fadeSubZero005;
            AddParamVal(AddDriver(stFadeOutB), $"EB_S{s}_Alpha", -0.2f);

            // Wire SyncEntry branches (priority order!)
            var syToHidden = AddInstantTransition(stSync, stHidden);
            syToHidden.AddCondition(AnimatorConditionMode.IfNot, 0f, $"EB_S{s}_Active");

            // Continue fading out if Hold already expired (prevents resurrecting fading slots on push)
            var syToFadeOutEarly = AddInstantTransition(stSync, stFadeOutA);
            syToFadeOutEarly.AddCondition(AnimatorConditionMode.If, 0f, $"EB_S{s}_Active");
            syToFadeOutEarly.AddCondition(AnimatorConditionMode.Less, 1, $"EB_S{s}_Remaining");
            syToFadeOutEarly.AddCondition(AnimatorConditionMode.Less, 0.021f, $"EB_S{s}_HoldLeft");

            var syToFadeIn = AddInstantTransition(stSync, stFadeInA);
            syToFadeIn.AddCondition(AnimatorConditionMode.If, 0f, $"EB_S{s}_Active");
            syToFadeIn.AddCondition(AnimatorConditionMode.Less, 0.99f, $"EB_S{s}_Alpha");

            var syToChar = AddInstantTransition(stSync, stCharStep);
            syToChar.AddCondition(AnimatorConditionMode.If, 0f, $"EB_S{s}_Active");
            syToChar.AddCondition(AnimatorConditionMode.Greater, 0, $"EB_S{s}_Remaining");

            var syToHold = AddInstantTransition(stSync, stHoldA);
            syToHold.AddCondition(AnimatorConditionMode.If, 0f, $"EB_S{s}_Active");
            syToHold.AddCondition(AnimatorConditionMode.Greater, 0.02f, $"EB_S{s}_HoldLeft");

            var syToFadeOut = AddInstantTransition(stSync, stFadeOutA);
            syToFadeOut.AddCondition(AnimatorConditionMode.If, 0f, $"EB_S{s}_Active");

            // Wire FadeIn
            var fiAToB = AddExitTransition(stFadeInA, stFadeInB, 1f);
            fiAToB.AddCondition(AnimatorConditionMode.Less, 0.99f, $"EB_S{s}_Alpha");
            var fiAToDone = AddExitTransition(stFadeInA, stFadeInDone, 1f);
            fiAToDone.AddCondition(AnimatorConditionMode.Greater, 0.989f, $"EB_S{s}_Alpha");

            var fiBToA = AddExitTransition(stFadeInB, stFadeInA, 1f);
            fiBToA.AddCondition(AnimatorConditionMode.Less, 0.99f, $"EB_S{s}_Alpha");
            var fiBToDone = AddExitTransition(stFadeInB, stFadeInDone, 1f);
            fiBToDone.AddCondition(AnimatorConditionMode.Greater, 0.989f, $"EB_S{s}_Alpha");

            var fdToChar = AddInstantTransition(stFadeInDone, stCharStep);
            fdToChar.AddCondition(AnimatorConditionMode.Greater, 0, $"EB_S{s}_Remaining");
            var fdToHold = AddInstantTransition(stFadeInDone, stHoldInit);
            fdToHold.AddCondition(AnimatorConditionMode.Less, 1, $"EB_S{s}_Remaining");

            // Wire CharStep -> CharAdvance -> loop or HoldInit
            AddExitTransition(stCharStep, stCharAdv, 1f);
            var caToStep = AddInstantTransition(stCharAdv, stCharStep);
            caToStep.AddCondition(AnimatorConditionMode.Greater, 0, $"EB_S{s}_Remaining");
            var caToHold = AddInstantTransition(stCharAdv, stHoldInit);
            caToHold.AddCondition(AnimatorConditionMode.Less, 1, $"EB_S{s}_Remaining");

            // Wire Hold
            AddAlwaysInstant(stHoldInit, stHoldA);
            var hAToB = AddExitTransition(stHoldA, stHoldB, 1f);
            hAToB.AddCondition(AnimatorConditionMode.Greater, 0.02f, $"EB_S{s}_HoldLeft");
            var hAToOut = AddExitTransition(stHoldA, stFadeOutA, 1f);
            hAToOut.AddCondition(AnimatorConditionMode.Less, 0.021f, $"EB_S{s}_HoldLeft");

            var hBToA = AddExitTransition(stHoldB, stHoldA, 1f);
            hBToA.AddCondition(AnimatorConditionMode.Greater, 0.02f, $"EB_S{s}_HoldLeft");
            var hBToOut = AddExitTransition(stHoldB, stFadeOutA, 1f);
            hBToOut.AddCondition(AnimatorConditionMode.Less, 0.021f, $"EB_S{s}_HoldLeft");

            // Wire FadeOut
            var foAToB = AddExitTransition(stFadeOutA, stFadeOutB, 1f);
            foAToB.AddCondition(AnimatorConditionMode.Greater, 0.02f, $"EB_S{s}_Alpha");
            var foAToHide = AddExitTransition(stFadeOutA, stHidden, 1f);
            foAToHide.AddCondition(AnimatorConditionMode.Less, 0.021f, $"EB_S{s}_Alpha");

            var foBToA = AddExitTransition(stFadeOutB, stFadeOutA, 1f);
            foBToA.AddCondition(AnimatorConditionMode.Greater, 0.02f, $"EB_S{s}_Alpha");
            var foBToHide = AddExitTransition(stFadeOutB, stHidden, 1f);
            foBToHide.AddCondition(AnimatorConditionMode.Less, 0.021f, $"EB_S{s}_Alpha");
        }

        private static void BuildRenderLayer(AnimatorController ctrl)
        {
            var layer = AddLayer(ctrl, "EkacBubble_Render");
            var bt = new BlendTree
            {
                name = "EkacBubble_DirectRender",
                blendType = BlendTreeType.Direct,
                useAutomaticThresholds = false,
                hideFlags = HideFlags.HideInHierarchy,
            };
            AssetDatabase.AddObjectToAsset(bt, ctrl);

            var children = new List<ChildMotion>();

            void AddDirect(string animParam, string matProp, float maxVal)
            {
                var clip = CreateClip(ctrl, "R_" + matProp);
                SetMaterialScalarCurve(clip, matProp, maxVal);
                children.Add(new ChildMotion
                {
                    motion = clip,
                    timeScale = 1f,
                    directBlendParameter = animParam,
                });
            }

            // Global Height & Scale from 0..1 menu params (base + span: Height 0.12 -> 0.62, Scale 0.50 -> 1.50)
            AddDirect("EB_One", "_BaseHeight", 0.12f);
            AddDirect("EB_Height", "_BaseHeight", 0.50f);
            AddDirect("EB_One", "_BubbleScale", 0.50f);
            AddDirect("EB_Scale", "_BubbleScale", 1.00f);

            for (int s = 0; s < SlotCount; s++)
            {
                AddDirect($"EB_S{s}_Alpha", $"_S{s}_Alpha", 1.0f);
                AddDirect($"EB_S{s}_LenNorm", $"_S{s}_Len", MaxChars);
                AddDirect($"EB_S{s}_Line1Norm", $"_S{s}_Line1", MaxChars);
                AddDirect($"EB_S{s}_ShownNorm", $"_S{s}_Shown", MaxChars);
                AddDirect($"EB_S{s}_SubChar", $"_S{s}_Sub", 1.0f);

                for (int k = 0; k < MaxChars; k++)
                {
                    AddDirect($"EB_S{s}_Col{k:D2}", $"_S{s}_Col{k:D2}", 63.0f);
                    AddDirect($"EB_S{s}_Row{k:D2}", $"_S{s}_Row{k:D2}", 63.0f);
                }
            }

            bt.children = children.ToArray();

            var st = layer.stateMachine.AddState("DirectRender");
            st.writeDefaultValues = false;
            st.motion = bt;
            layer.stateMachine.defaultState = st;
        }

        private static GameObject BuildPrefab(Mesh quadMesh, Material mat, AnimatorController controller)
        {
            var root = new GameObject("EkacBubble");

            // 1. HeadTracker: ModularAvatarBoneProxy moves this onto HumanBodyBones.Head on build
            var headTracker = new GameObject("HeadTracker");
            headTracker.transform.SetParent(root.transform, false);
            var bp = headTracker.AddComponent<ModularAvatarBoneProxy>();
            bp.boneReference = HumanBodyBones.Head;
            bp.attachmentMode = BoneProxyAttachmentMode.AsChildAtRoot;

            // 2. BubbleAnchor: stays world-horizontal under EkacBubble root, tracks HeadTracker world position
            var anchor = new GameObject("BubbleAnchor");
            anchor.transform.SetParent(root.transform, false);
            var posCons = anchor.AddComponent<VRCPositionConstraint>();
            posCons.Sources.Add(new VRCConstraintSource
            {
                Weight = 1.0f,
                SourceTransform = headTracker.transform,
                ParentPositionOffset = Vector3.zero,
                ParentRotationOffset = Vector3.zero,
            });
            posCons.AffectsPositionX = true;
            posCons.AffectsPositionY = true;
            posCons.AffectsPositionZ = true;
            posCons.IsActive = true;
            posCons.Locked = true;

            // 3. BubbleMesh: single quad drawn with Cylindrical Billboard SDF Shader
            var meshGo = new GameObject("BubbleMesh");
            meshGo.transform.SetParent(anchor.transform, false);
            var mf = meshGo.AddComponent<MeshFilter>();
            mf.sharedMesh = quadMesh;
            var mr = meshGo.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            mr.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
            mr.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;

            // 4. ModularAvatarMergeAnimator (relative paths match BubbleAnchor/BubbleMesh)
            var mergeAnim = root.AddComponent<ModularAvatarMergeAnimator>();
            mergeAnim.animator = controller;
            mergeAnim.layerType = VRCAvatarDescriptor.AnimLayerType.FX;
            mergeAnim.pathMode = MergeAnimatorPathMode.Relative;
            mergeAnim.matchAvatarWriteDefaults = true;

            // 5. ModularAvatarParameters (82 synced bits)
            var maParams = root.AddComponent<ModularAvatarParameters>();
            void RegParam(string pName, ParameterSyncType syncType, int bitWidth = 8, ParameterRepresentation rep = ParameterRepresentation.Default, float defVal = 0f, bool saved = false)
            {
                maParams.parameters.Add(new ParameterConfig
                {
                    nameOrPrefix = pName,
                    syncType = syncType,
                    bitWidth = bitWidth,
                    representation = rep,
                    defaultValue = defVal,
                    hasExplicitDefaultValue = Mathf.Abs(defVal) > 0.0001f,
                    saved = saved,
                });
            }

            RegParam("EB_Enable", ParameterSyncType.Bool, 1, ParameterRepresentation.Default, 1f, true);
            RegParam("EB_Clear", ParameterSyncType.Bool, 1, ParameterRepresentation.Default, 0f, false);
            for (int c = 0; c < SliceSize; c++)
            {
                RegParam($"EB_C{c}_Col", ParameterSyncType.Int, 6, ParameterRepresentation.Unsigned, 0f, false);
                RegParam($"EB_C{c}_Row", ParameterSyncType.Int, 6, ParameterRepresentation.Unsigned, 0f, false);
            }
            RegParam("EB_Slice", ParameterSyncType.Int, 3, ParameterRepresentation.Unsigned, 0f, false);
            RegParam("EB_Seq", ParameterSyncType.Int, 2, ParameterRepresentation.Unsigned, 0f, false);
            RegParam("EB_Gen", ParameterSyncType.Int, 3, ParameterRepresentation.Unsigned, 0f, false);
            RegParam("EB_Len", ParameterSyncType.Int, 5, ParameterRepresentation.Unsigned, 0f, false);
            RegParam("EB_Line1", ParameterSyncType.Int, 5, ParameterRepresentation.Unsigned, 0f, false);

            RegParam("EB_Speed", ParameterSyncType.Float, 6, ParameterRepresentation.Unsigned, 0.5f, true);
            RegParam("EB_Hold", ParameterSyncType.Float, 6, ParameterRepresentation.Unsigned, 0.5f, true);
            RegParam("EB_Height", ParameterSyncType.Float, 6, ParameterRepresentation.Unsigned, 0.3f, true);
            RegParam("EB_Scale", ParameterSyncType.Float, 6, ParameterRepresentation.Unsigned, 0.5f, true);

            // 6. Expressions SubMenu ("头顶气泡") isolated under Menu child GameObject
            var menuRoot = new GameObject("BubbleMenu");
            menuRoot.transform.SetParent(root.transform, false);
            var installer = menuRoot.AddComponent<ModularAvatarMenuInstaller>();
            installer.installTargetMenu = null;
            var subMenuItem = menuRoot.AddComponent<ModularAvatarMenuItem>();
            subMenuItem.PortableControl.Type = PortableControlType.SubMenu;
            subMenuItem.label = "头顶气泡";
            subMenuItem.MenuSource = SubmenuSource.Children;

            void AddMenuToggle(string label, string param, bool isDefault)
            {
                var go = new GameObject(label);
                go.transform.SetParent(menuRoot.transform, false);
                var m = go.AddComponent<ModularAvatarMenuItem>();
                m.PortableControl.Type = PortableControlType.Toggle;
                m.PortableControl.Parameter = param;
                m.PortableControl.Value = 1f;
                m.label = label;
                m.isSynced = true;
                m.isSaved = true;
                m.isDefault = isDefault;
                m.automaticValue = false;
            }

            void AddMenuButton(string label, string param)
            {
                var go = new GameObject(label);
                go.transform.SetParent(menuRoot.transform, false);
                var m = go.AddComponent<ModularAvatarMenuItem>();
                m.PortableControl.Type = PortableControlType.Button;
                m.PortableControl.Parameter = param;
                m.PortableControl.Value = 1f;
                m.label = label;
                m.isSynced = true;
                m.isSaved = false;
                m.isDefault = false;
                m.automaticValue = false;
            }

            void AddMenuRadial(string label, string subParam)
            {
                var go = new GameObject(label);
                go.transform.SetParent(menuRoot.transform, false);
                var m = go.AddComponent<ModularAvatarMenuItem>();
                m.PortableControl.Type = PortableControlType.RadialPuppet;
                // Keep main Parameter empty so MA ParameterAssignerPass never creates a 1-bit dummy Bool
                m.PortableControl.Parameter = "";
                m.PortableControl.SubParameters = System.Collections.Immutable.ImmutableList.Create(subParam);
                m.label = label;
                m.isSynced = true;
                m.isSaved = true;
                m.isDefault = false;
                m.automaticValue = false;
            }

            AddMenuToggle("显示气泡", "EB_Enable", true);
            AddMenuButton("清空当前气泡", "EB_Clear");
            AddMenuRadial("出字速度", "EB_Speed");
            AddMenuRadial("停留时长(3s)", "EB_Hold");
            AddMenuRadial("头顶高度", "EB_Height");
            AddMenuRadial("气泡大小", "EB_Scale");

            var savedPrefab = PrefabUtility.SaveAsPrefabAsset(root, PrefabPath);
            UnityEngine.Object.DestroyImmediate(root);
            return savedPrefab;
        }

        public static void AttachToTargetAvatarInScene(string avatarName)
        {
            var avatarGo = GameObject.Find(avatarName);
            if (avatarGo == null)
                throw new Exception($"Avatar GameObject '{avatarName}' not found in active scene.");
            AttachToAvatar(avatarGo);
        }

        public static void AttachToAvatar(GameObject avatarGo)
        {
            if (avatarGo == null)
                throw new ArgumentNullException(nameof(avatarGo));

            // Replace previous EkacBubble child if present
            var existing = avatarGo.transform.Find("EkacBubble");
            if (existing != null)
            {
                UnityEngine.Object.DestroyImmediate(existing.gameObject);
            }

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            if (prefab == null)
                throw new Exception("Missing generated prefab at " + PrefabPath);

            var inst = PrefabUtility.InstantiatePrefab(prefab, avatarGo.transform) as GameObject;
            if (inst == null)
                throw new Exception("Failed to instantiate EkacBubble prefab.");
            inst.name = "EkacBubble";

            // Pre-snap Anchor at Ayusa's current Head position so it also previews cleanly in Edit mode
            var avatarAnim = avatarGo.GetComponent<Animator>();
            var headBone = avatarAnim != null ? avatarAnim.GetBoneTransform(HumanBodyBones.Head) : null;
            if (headBone != null)
            {
                var headTracker = inst.transform.Find("HeadTracker");
                var anchor = inst.transform.Find("BubbleAnchor");
                if (headTracker != null) headTracker.position = headBone.position;
                if (anchor != null) anchor.position = headBone.position;
            }

            var scene = SceneManager.GetActiveScene();
            UnityEditor.SceneManagement.EditorSceneManager.MarkSceneDirty(scene);
            UnityEditor.SceneManagement.EditorSceneManager.SaveScene(scene);
        }
    }
}
#endif
