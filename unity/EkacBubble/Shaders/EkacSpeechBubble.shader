Shader "EkacBubble/SpeechBubble"
{
    Properties
    {
        _AtlasTex ("Glyph SDF Atlas Page 0 (4096x4096)", 2D) = "black" {}
        _AtlasTex1 ("Glyph SDF Atlas Page 1 (4096x4096)", 2D) = "black" {}
        [NoScaleOffset] _SkinTex ("9-Slice Frame Skin (RGBA)", 2D) = "white" {}
        [NoScaleOffset] _BadgeTex ("Corner Badge / Sticker (RGBA)", 2D) = "black" {}

        // Frame mode & colors
        _FrameMode ("Frame Mode (0=Procedural, 1=9Slice, 2=Hybrid)", Float) = 0.0
        _BgColor ("Bubble Background Color (Top)", Color) = (1.0, 0.985, 0.975, 0.94)
        _BgColor2 ("Bubble Background Color (Bottom)", Color) = (0.985, 0.94, 0.955, 0.94)
        _BgGradient ("Background Vertical Gradient", Range(0.0, 1.0)) = 0.0
        _BorderColor ("Bubble Border Color", Color) = (0.91, 0.68, 0.67, 0.95)
        [HDR] _EmissionColor ("Additive Emission Tint", Color) = (0.0, 0.0, 0.0, 1.0)
        _EmissionStrength ("Glow / HDR Boost", Range(0.0, 3.0)) = 0.0

        // Box drop shadow
        _ShadowColor ("Drop Shadow Color", Color) = (0.14, 0.10, 0.12, 0.18)
        _ShadowOffsetX ("Shadow Offset X (em)", Range(-0.5, 0.5)) = 0.0
        _ShadowOffsetY ("Shadow Offset Y (em)", Range(-0.5, 0.5)) = -0.06
        _ShadowSoftness ("Shadow Softness (em)", Range(0.01, 0.5)) = 0.18

        // Procedural frame geometry
        _CornerRadius ("Corner Radius (em)", Range(0.0, 1.6)) = 0.34
        _BorderWidth ("Border Thickness (em)", Range(0.0, 0.30)) = 0.065
        _PadX ("Horizontal Padding (em)", Range(0.20, 1.50)) = 0.56
        _PadY ("Vertical Padding (em)", Range(0.15, 1.10)) = 0.36
        _LineHeight ("Line Height (em)", Range(1.00, 1.80)) = 1.28
        _BubbleGap ("Stack Vertical Gap (em)", Range(0.08, 0.90)) = 0.34

        // Speech tail (Slot 0)
        _TailEnable ("Enable Speech Tail", Float) = 1.0
        _TailWidth ("Tail Half-Width (em)", Range(0.06, 0.60)) = 0.22
        _TailHeight ("Tail Height (em)", Range(0.08, 0.60)) = 0.24
        _TailOffsetX ("Tail Offset X (em)", Range(-3.0, 3.0)) = 0.0

        // 9-Slice skin settings
        _SkinTint ("9-Slice Skin Tint", Color) = (1.0, 1.0, 1.0, 1.0)
        _SkinSlice ("9-Slice UV Borders (L, R, B, T)", Vector) = (0.25, 0.25, 0.25, 0.25)
        _SkinBorderEm ("9-Slice Corner Size (em)", Range(0.10, 2.00)) = 0.55

        // Decorative corner sticker / badge
        _BadgeEnable ("Enable Corner Badge", Float) = 0.0
        _BadgeTint ("Badge Tint", Color) = (1.0, 1.0, 1.0, 1.0)
        _BadgeCorner ("Badge Anchor (0=TL,1=TR,2=BL,3=BR,4=TopCenter)", Float) = 1.0
        _BadgeSize ("Badge Size (em)", Range(0.20, 2.50)) = 0.85
        _BadgeOffsetX ("Badge Offset X (em)", Range(-1.5, 1.5)) = 0.10
        _BadgeOffsetY ("Badge Offset Y (em)", Range(-1.5, 1.5)) = 0.15
        _BadgeSlot0Only ("Badge Only On Newest Bubble", Float) = 1.0

        // Text style, outline, shadow & motion
        _TextColor ("Text Color (Top/Main)", Color) = (0.18, 0.14, 0.16, 1.0)
        _TextColor2 ("Text Color (Bottom)", Color) = (0.36, 0.22, 0.30, 1.0)
        _TextGradient ("Text Vertical Gradient", Range(0.0, 1.0)) = 0.0
        _TextWeight ("Text Weight (Thin..Bold)", Range(-0.14, 0.16)) = 0.0
        _TextItalic ("Text Faux Italic", Range(-0.35, 0.35)) = 0.0
        _TextOutlineWidth ("Text Outline Width", Range(0.0, 0.24)) = 0.0
        _TextOutlineColor ("Text Outline Color", Color) = (1.0, 1.0, 1.0, 1.0)
        _TextShadowEnable ("Enable Text Shadow / Glow", Float) = 0.0
        _TextShadowColor ("Text Shadow / Glow Color", Color) = (0.0, 0.0, 0.0, 0.45)
        _TextShadowOffsetX ("Text Shadow Offset X", Range(-0.15, 0.15)) = 0.025
        _TextShadowOffsetY ("Text Shadow Offset Y", Range(-0.15, 0.15)) = -0.025
        _TextShadowSoftness ("Text Shadow Softness", Range(0.0, 0.25)) = 0.04
        _PopOffsetY ("Char Entry Rise Offset (em)", Range(-0.35, 0.35)) = -0.08
        _PopScale ("Char Entry Pop Scale", Range(0.5, 1.5)) = 1.0
        _WaveAmp ("Idle Wave Amplitude (em)", Range(0.0, 0.20)) = 0.0
        _WaveFreq ("Idle Wave Char Phase", Range(0.2, 3.0)) = 0.9
        _WaveSpeed ("Idle Wave Speed", Range(0.0, 12.0)) = 4.5

        // Runtime Animator-driven globals
        _Enable ("Global Enable", Float) = 1.0
        _BaseHeight ("Base Height Above Head (m)", Float) = 0.28
        _BubbleScale ("Bubble Scale", Float) = 1.0

        // Slot 0 (Newest, bottom)
        _S0_Alpha ("S0 Alpha", Float) = 0.0
        _S0_Len ("S0 Len (0..24)", Float) = 0.0
        _S0_Line1 ("S0 Line1 (0..24)", Float) = 0.0
        _S0_Shown ("S0 Shown (0..24)", Float) = 0.0
        _S0_Sub ("S0 SubChar (0..1)", Float) = 0.0

        _S0_Col00 ("S0 Col00", Float) = 0 _S0_Row00 ("S0 Row00", Float) = 0
        _S0_Col01 ("S0 Col01", Float) = 0 _S0_Row01 ("S0 Row01", Float) = 0
        _S0_Col02 ("S0 Col02", Float) = 0 _S0_Row02 ("S0 Row02", Float) = 0
        _S0_Col03 ("S0 Col03", Float) = 0 _S0_Row03 ("S0 Row03", Float) = 0
        _S0_Col04 ("S0 Col04", Float) = 0 _S0_Row04 ("S0 Row04", Float) = 0
        _S0_Col05 ("S0 Col05", Float) = 0 _S0_Row05 ("S0 Row05", Float) = 0
        _S0_Col06 ("S0 Col06", Float) = 0 _S0_Row06 ("S0 Row06", Float) = 0
        _S0_Col07 ("S0 Col07", Float) = 0 _S0_Row07 ("S0 Row07", Float) = 0
        _S0_Col08 ("S0 Col08", Float) = 0 _S0_Row08 ("S0 Row08", Float) = 0
        _S0_Col09 ("S0 Col09", Float) = 0 _S0_Row09 ("S0 Row09", Float) = 0
        _S0_Col10 ("S0 Col10", Float) = 0 _S0_Row10 ("S0 Row10", Float) = 0
        _S0_Col11 ("S0 Col11", Float) = 0 _S0_Row11 ("S0 Row11", Float) = 0
        _S0_Col12 ("S0 Col12", Float) = 0 _S0_Row12 ("S0 Row12", Float) = 0
        _S0_Col13 ("S0 Col13", Float) = 0 _S0_Row13 ("S0 Row13", Float) = 0
        _S0_Col14 ("S0 Col14", Float) = 0 _S0_Row14 ("S0 Row14", Float) = 0
        _S0_Col15 ("S0 Col15", Float) = 0 _S0_Row15 ("S0 Row15", Float) = 0
        _S0_Col16 ("S0 Col16", Float) = 0 _S0_Row16 ("S0 Row16", Float) = 0
        _S0_Col17 ("S0 Col17", Float) = 0 _S0_Row17 ("S0 Row17", Float) = 0
        _S0_Col18 ("S0 Col18", Float) = 0 _S0_Row18 ("S0 Row18", Float) = 0
        _S0_Col19 ("S0 Col19", Float) = 0 _S0_Row19 ("S0 Row19", Float) = 0
        _S0_Col20 ("S0 Col20", Float) = 0 _S0_Row20 ("S0 Row20", Float) = 0
        _S0_Col21 ("S0 Col21", Float) = 0 _S0_Row21 ("S0 Row21", Float) = 0
        _S0_Col22 ("S0 Col22", Float) = 0 _S0_Row22 ("S0 Row22", Float) = 0
        _S0_Col23 ("S0 Col23", Float) = 0 _S0_Row23 ("S0 Row23", Float) = 0

        // Slot 1 (Previous, middle)
        _S1_Alpha ("S1 Alpha", Float) = 0.0
        _S1_Len ("S1 Len (0..24)", Float) = 0.0
        _S1_Line1 ("S1 Line1 (0..24)", Float) = 0.0
        _S1_Shown ("S1 Shown (0..24)", Float) = 0.0
        _S1_Sub ("S1 SubChar (0..1)", Float) = 0.0

        _S1_Col00 ("S1 Col00", Float) = 0 _S1_Row00 ("S1 Row00", Float) = 0
        _S1_Col01 ("S1 Col01", Float) = 0 _S1_Row01 ("S1 Row01", Float) = 0
        _S1_Col02 ("S1 Col02", Float) = 0 _S1_Row02 ("S1 Row02", Float) = 0
        _S1_Col03 ("S1 Col03", Float) = 0 _S1_Row03 ("S1 Row03", Float) = 0
        _S1_Col04 ("S1 Col04", Float) = 0 _S1_Row04 ("S1 Row04", Float) = 0
        _S1_Col05 ("S1 Col05", Float) = 0 _S1_Row05 ("S1 Row05", Float) = 0
        _S1_Col06 ("S1 Col06", Float) = 0 _S1_Row06 ("S1 Row06", Float) = 0
        _S1_Col07 ("S1 Col07", Float) = 0 _S1_Row07 ("S1 Row07", Float) = 0
        _S1_Col08 ("S1 Col08", Float) = 0 _S1_Row08 ("S1 Row08", Float) = 0
        _S1_Col09 ("S1 Col09", Float) = 0 _S1_Row09 ("S1 Row09", Float) = 0
        _S1_Col10 ("S1 Col10", Float) = 0 _S1_Row10 ("S1 Row10", Float) = 0
        _S1_Col11 ("S1 Col11", Float) = 0 _S1_Row11 ("S1 Row11", Float) = 0
        _S1_Col12 ("S1 Col12", Float) = 0 _S1_Row12 ("S1 Row12", Float) = 0
        _S1_Col13 ("S1 Col13", Float) = 0 _S1_Row13 ("S1 Row13", Float) = 0
        _S1_Col14 ("S1 Col14", Float) = 0 _S1_Row14 ("S1 Row14", Float) = 0
        _S1_Col15 ("S1 Col15", Float) = 0 _S1_Row15 ("S1 Row15", Float) = 0
        _S1_Col16 ("S1 Col16", Float) = 0 _S1_Row16 ("S1 Row16", Float) = 0
        _S1_Col17 ("S1 Col17", Float) = 0 _S1_Row17 ("S1 Row17", Float) = 0
        _S1_Col18 ("S1 Col18", Float) = 0 _S1_Row18 ("S1 Row18", Float) = 0
        _S1_Col19 ("S1 Col19", Float) = 0 _S1_Row19 ("S1 Row19", Float) = 0
        _S1_Col20 ("S1 Col20", Float) = 0 _S1_Row20 ("S1 Row20", Float) = 0
        _S1_Col21 ("S1 Col21", Float) = 0 _S1_Row21 ("S1 Row21", Float) = 0
        _S1_Col22 ("S1 Col22", Float) = 0 _S1_Row22 ("S1 Row22", Float) = 0
        _S1_Col23 ("S1 Col23", Float) = 0 _S1_Row23 ("S1 Row23", Float) = 0

        // Slot 2 (Oldest, top)
        _S2_Alpha ("S2 Alpha", Float) = 0.0
        _S2_Len ("S2 Len (0..24)", Float) = 0.0
        _S2_Line1 ("S2 Line1 (0..24)", Float) = 0.0
        _S2_Shown ("S2 Shown (0..24)", Float) = 0.0
        _S2_Sub ("S2 SubChar (0..1)", Float) = 0.0

        _S2_Col00 ("S2 Col00", Float) = 0 _S2_Row00 ("S2 Row00", Float) = 0
        _S2_Col01 ("S2 Col01", Float) = 0 _S2_Row01 ("S2 Row01", Float) = 0
        _S2_Col02 ("S2 Col02", Float) = 0 _S2_Row02 ("S2 Row02", Float) = 0
        _S2_Col03 ("S2 Col03", Float) = 0 _S2_Row03 ("S2 Row03", Float) = 0
        _S2_Col04 ("S2 Col04", Float) = 0 _S2_Row04 ("S2 Row04", Float) = 0
        _S2_Col05 ("S2 Col05", Float) = 0 _S2_Row05 ("S2 Row05", Float) = 0
        _S2_Col06 ("S2 Col06", Float) = 0 _S2_Row06 ("S2 Row06", Float) = 0
        _S2_Col07 ("S2 Col07", Float) = 0 _S2_Row07 ("S2 Row07", Float) = 0
        _S2_Col08 ("S2 Col08", Float) = 0 _S2_Row08 ("S2 Row08", Float) = 0
        _S2_Col09 ("S2 Col09", Float) = 0 _S2_Row09 ("S2 Row09", Float) = 0
        _S2_Col10 ("S2 Col10", Float) = 0 _S2_Row10 ("S2 Row10", Float) = 0
        _S2_Col11 ("S2 Col11", Float) = 0 _S2_Row11 ("S2 Row11", Float) = 0
        _S2_Col12 ("S2 Col12", Float) = 0 _S2_Row12 ("S2 Row12", Float) = 0
        _S2_Col13 ("S2 Col13", Float) = 0 _S2_Row13 ("S2 Row13", Float) = 0
        _S2_Col14 ("S2 Col14", Float) = 0 _S2_Row14 ("S2 Row14", Float) = 0
        _S2_Col15 ("S2 Col15", Float) = 0 _S2_Row15 ("S2 Row15", Float) = 0
        _S2_Col16 ("S2 Col16", Float) = 0 _S2_Row16 ("S2 Row16", Float) = 0
        _S2_Col17 ("S2 Col17", Float) = 0 _S2_Row17 ("S2 Row17", Float) = 0
        _S2_Col18 ("S2 Col18", Float) = 0 _S2_Row18 ("S2 Row18", Float) = 0
        _S2_Col19 ("S2 Col19", Float) = 0 _S2_Row19 ("S2 Row19", Float) = 0
        _S2_Col20 ("S2 Col20", Float) = 0 _S2_Row20 ("S2 Row20", Float) = 0
        _S2_Col21 ("S2 Col21", Float) = 0 _S2_Row21 ("S2 Row21", Float) = 0
        _S2_Col22 ("S2 Col22", Float) = 0 _S2_Row22 ("S2 Row22", Float) = 0
        _S2_Col23 ("S2 Col23", Float) = 0 _S2_Row23 ("S2 Row23", Float) = 0
    }

    SubShader
    {
        Tags
        {
            "Queue" = "Transparent+150"
            "RenderType" = "Transparent"
            "IgnoreProjector" = "True"
            "DisableBatching" = "True"
        }

        Pass
        {
            Cull Off
            ZWrite Off
            ZTest LEqual
            Blend SrcAlpha OneMinusSrcAlpha

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.5
            #include "UnityCG.cginc"

            #define EM_SIZE 0.055

            sampler2D _AtlasTex;
            sampler2D _AtlasTex1;
            sampler2D _SkinTex;
            sampler2D _BadgeTex;

            float _FrameMode;
            fixed4 _BgColor;
            fixed4 _BgColor2;
            float _BgGradient;
            fixed4 _BorderColor;
            half4 _EmissionColor;
            float _EmissionStrength;

            fixed4 _ShadowColor;
            float _ShadowOffsetX;
            float _ShadowOffsetY;
            float _ShadowSoftness;

            float _CornerRadius;
            float _BorderWidth;
            float _PadX;
            float _PadY;
            float _LineHeight;
            float _BubbleGap;

            float _TailEnable;
            float _TailWidth;
            float _TailHeight;
            float _TailOffsetX;

            fixed4 _SkinTint;
            float4 _SkinSlice;
            float _SkinBorderEm;

            float _BadgeEnable;
            fixed4 _BadgeTint;
            float _BadgeCorner;
            float _BadgeSize;
            float _BadgeOffsetX;
            float _BadgeOffsetY;
            float _BadgeSlot0Only;

            fixed4 _TextColor;
            fixed4 _TextColor2;
            float _TextGradient;
            float _TextWeight;
            float _TextItalic;
            float _TextOutlineWidth;
            fixed4 _TextOutlineColor;
            float _TextShadowEnable;
            fixed4 _TextShadowColor;
            float _TextShadowOffsetX;
            float _TextShadowOffsetY;
            float _TextShadowSoftness;
            float _PopOffsetY;
            float _PopScale;
            float _WaveAmp;
            float _WaveFreq;
            float _WaveSpeed;

            float _Enable;
            float _BaseHeight;
            float _BubbleScale;

            // Non-serialized global uniforms for zero-upload-risk Scene/Game Editor preview
            uniform float _EB_PreviewActive;
            uniform float _EB_PreviewTime;
            uniform float4 _EB_PreviewMeta[3];
            uniform float _EB_PreviewCols[72];
            uniform float _EB_PreviewRows[72];

            #define DECLARE_SLOT_PROPS(N) \
                float _S##N##_Alpha; \
                float _S##N##_Len; \
                float _S##N##_Line1; \
                float _S##N##_Shown; \
                float _S##N##_Sub; \
                float _S##N##_Col00, _S##N##_Row00, _S##N##_Col01, _S##N##_Row01, _S##N##_Col02, _S##N##_Row02, _S##N##_Col03, _S##N##_Row03; \
                float _S##N##_Col04, _S##N##_Row04, _S##N##_Col05, _S##N##_Row05, _S##N##_Col06, _S##N##_Row06, _S##N##_Col07, _S##N##_Row07; \
                float _S##N##_Col08, _S##N##_Row08, _S##N##_Col09, _S##N##_Row09, _S##N##_Col10, _S##N##_Row10, _S##N##_Col11, _S##N##_Row11; \
                float _S##N##_Col12, _S##N##_Row12, _S##N##_Col13, _S##N##_Row13, _S##N##_Col14, _S##N##_Row14, _S##N##_Col15, _S##N##_Row15; \
                float _S##N##_Col16, _S##N##_Row16, _S##N##_Col17, _S##N##_Row17, _S##N##_Col18, _S##N##_Row18, _S##N##_Col19, _S##N##_Row19; \
                float _S##N##_Col20, _S##N##_Row20, _S##N##_Col21, _S##N##_Row21, _S##N##_Col22, _S##N##_Row22, _S##N##_Col23, _S##N##_Row23;

            DECLARE_SLOT_PROPS(0)
            DECLARE_SLOT_PROPS(1)
            DECLARE_SLOT_PROPS(2)

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 emPos : TEXCOORD0;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            struct SlotArrays
            {
                float alpha;
                int len;
                int line1;
                float exactReveal;
                float cols[24];
                float rows[24];
            };

            #define FILL_SLOT(S, PREFIX, BASE) \
                if (_EB_PreviewActive > 0.5) \
                { \
                    float4 _pm_##PREFIX = _EB_PreviewMeta[PREFIX]; \
                    S.alpha = saturate(_pm_##PREFIX.x); \
                    S.len = clamp((int)round(_pm_##PREFIX.y), 0, 24); \
                    int _pl1_##PREFIX = (int)round(_pm_##PREFIX.z); \
                    S.line1 = (_pl1_##PREFIX >= 1 && _pl1_##PREFIX < S.len) ? _pl1_##PREFIX : S.len; \
                    S.exactReveal = clamp(_pm_##PREFIX.w, 0.0, (float)S.len); \
                    for (int _pk_##PREFIX = 0; _pk_##PREFIX < 24; _pk_##PREFIX++) \
                    { \
                        S.cols[_pk_##PREFIX] = round(_EB_PreviewCols[BASE + _pk_##PREFIX]); \
                        S.rows[_pk_##PREFIX] = round(_EB_PreviewRows[BASE + _pk_##PREFIX]); \
                    } \
                } \
                else \
                { \
                    S.alpha = saturate(_S##PREFIX##_Alpha); \
                    S.len = clamp((int)round(_S##PREFIX##_Len), 0, 24); \
                    int _rawL1_##PREFIX = (int)round(_S##PREFIX##_Line1); \
                    S.line1 = (_rawL1_##PREFIX >= 1 && _rawL1_##PREFIX < S.len) ? _rawL1_##PREFIX : S.len; \
                    S.exactReveal = clamp(_S##PREFIX##_Shown + _S##PREFIX##_Sub, 0.0, (float)S.len); \
                    S.cols[0] = round(_S##PREFIX##_Col00); S.rows[0] = round(_S##PREFIX##_Row00); \
                    S.cols[1] = round(_S##PREFIX##_Col01); S.rows[1] = round(_S##PREFIX##_Row01); \
                    S.cols[2] = round(_S##PREFIX##_Col02); S.rows[2] = round(_S##PREFIX##_Row02); \
                    S.cols[3] = round(_S##PREFIX##_Col03); S.rows[3] = round(_S##PREFIX##_Row03); \
                    S.cols[4] = round(_S##PREFIX##_Col04); S.rows[4] = round(_S##PREFIX##_Row04); \
                    S.cols[5] = round(_S##PREFIX##_Col05); S.rows[5] = round(_S##PREFIX##_Row05); \
                    S.cols[6] = round(_S##PREFIX##_Col06); S.rows[6] = round(_S##PREFIX##_Row06); \
                    S.cols[7] = round(_S##PREFIX##_Col07); S.rows[7] = round(_S##PREFIX##_Row07); \
                    S.cols[8] = round(_S##PREFIX##_Col08); S.rows[8] = round(_S##PREFIX##_Row08); \
                    S.cols[9] = round(_S##PREFIX##_Col09); S.rows[9] = round(_S##PREFIX##_Row09); \
                    S.cols[10] = round(_S##PREFIX##_Col10); S.rows[10] = round(_S##PREFIX##_Row10); \
                    S.cols[11] = round(_S##PREFIX##_Col11); S.rows[11] = round(_S##PREFIX##_Row11); \
                    S.cols[12] = round(_S##PREFIX##_Col12); S.rows[12] = round(_S##PREFIX##_Row12); \
                    S.cols[13] = round(_S##PREFIX##_Col13); S.rows[13] = round(_S##PREFIX##_Row13); \
                    S.cols[14] = round(_S##PREFIX##_Col14); S.rows[14] = round(_S##PREFIX##_Row14); \
                    S.cols[15] = round(_S##PREFIX##_Col15); S.rows[15] = round(_S##PREFIX##_Row15); \
                    S.cols[16] = round(_S##PREFIX##_Col16); S.rows[16] = round(_S##PREFIX##_Row16); \
                    S.cols[17] = round(_S##PREFIX##_Col17); S.rows[17] = round(_S##PREFIX##_Row17); \
                    S.cols[18] = round(_S##PREFIX##_Col18); S.rows[18] = round(_S##PREFIX##_Row18); \
                    S.cols[19] = round(_S##PREFIX##_Col19); S.rows[19] = round(_S##PREFIX##_Row19); \
                    S.cols[20] = round(_S##PREFIX##_Col20); S.rows[20] = round(_S##PREFIX##_Row20); \
                    S.cols[21] = round(_S##PREFIX##_Col21); S.rows[21] = round(_S##PREFIX##_Row21); \
                    S.cols[22] = round(_S##PREFIX##_Col22); S.rows[22] = round(_S##PREFIX##_Row22); \
                    S.cols[23] = round(_S##PREFIX##_Col23); S.rows[23] = round(_S##PREFIX##_Row23); \
                }

            fixed4 CompositeOver(fixed4 under, fixed4 over)
            {
                float outA = over.a + under.a * (1.0 - over.a);
                if (outA < 1e-5) return fixed4(0, 0, 0, 0);
                fixed3 outRgb = (over.rgb * over.a + under.rgb * under.a * (1.0 - over.a)) / outA;
                return fixed4(outRgb, saturate(outA));
            }

            float SampleAtlasSDF(float col, float row, float2 cellUV, float2 ddxChar, float2 ddyChar)
            {
                float2 clampedCell = clamp(cellUV, 2.5 / 64.0, 1.0 - 2.5 / 64.0);
                float page = step(63.5, row);
                float localRow = clamp(row - page * 64.0, 0.0, 63.0);
                float2 atlasUV = float2(
                    (clamp(col, 0.0, 63.0) + clampedCell.x) / 64.0,
                    ((63.0 - localRow) + clampedCell.y) / 64.0
                );
                if (page < 0.5)
                    return tex2Dgrad(_AtlasTex, atlasUV, ddxChar, ddyChar).r;
                return tex2Dgrad(_AtlasTex1, atlasUV, ddxChar, ddyChar).r;
            }

            float GlyphAdvance(float col, float row)
            {
                if (col < 0.5 && row < 0.5) return 0.0;
                if (row < 0.5 && col < 31.5) return 0.36;
                if (row < 0.5 || (row < 1.5 && col < 31.5)) return 0.60;
                if (row < 1.5) return 0.78;
                return 1.00;
            }

            float CharRevealWeight(int idx, float exactRev)
            {
                float d = exactRev - (float)idx;
                if (d <= 0.0) return 0.0;
                if (d >= 1.0) return 1.0;
                return smoothstep(0.0, 0.85, d);
            }

            void ComputeBoxSize(SlotArrays s, out float boxW, out float boxH, out float contentW)
            {
                float padX = max(_PadX, 0.10);
                float padY = max(_PadY, 0.10);
                float lineH = max(_LineHeight, 0.90);

                float w0 = 0.0;
                float w1 = 0.0;
                for (int k = 0; k < 24; k++)
                {
                    if (k >= s.len) break;
                    float adv = GlyphAdvance(s.cols[k], s.rows[k]);
                    float wt = CharRevealWeight(k, s.exactReveal);
                    if (k < s.line1) w0 += adv * wt;
                    else w1 += adv * wt;
                }
                contentW = max(max(w0, w1), 0.75);
                float r2Prog = (s.line1 < s.len) ? saturate(s.exactReveal - (float)s.line1) : 0.0;
                float rows = 1.0 + smoothstep(0.0, 1.0, r2Prog);
                boxW = contentW + 2.0 * padX;
                boxH = rows * lineH + 2.0 * padY;
            }

            float sdRoundBox(float2 p, float2 halfSize, float radius)
            {
                float r = clamp(radius, 0.0, min(halfSize.x, halfSize.y));
                float2 q = abs(p) - halfSize + r;
                return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
            }

            float sdTriangleDown(float2 p, float halfBase, float height)
            {
                p.x = abs(p.x);
                float2 a = float2(halfBase, 0.0);
                float2 b = float2(0.0, -height);
                float2 ba = b - a;
                float2 pa = p - a;
                float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
                float d = length(pa - ba * t);
                float crossZ = ba.x * pa.y - ba.y * pa.x;
                float inside = (p.y <= 0.0 && crossZ <= 0.0) ? -1.0 : 1.0;
                return d * inside;
            }

            float2 SampleNineSliceUV(float2 local01, float2 boxSizeEm, float4 sliceLRBT, float borderEm)
            {
                float4 sl = clamp(sliceLRBT, 0.0, 0.49);
                float2 bEm = min(float2(borderEm, borderEm), 0.48 * boxSizeEm);
                float2 pEm = saturate(local01) * boxSizeEm;

                float u = saturate(local01.x);
                if (sl.x > 0.001 || sl.y > 0.001)
                {
                    if (pEm.x < bEm.x && sl.x > 0.001)
                        u = (pEm.x / max(bEm.x, 1e-4)) * sl.x;
                    else if (pEm.x > boxSizeEm.x - bEm.x && sl.y > 0.001)
                        u = 1.0 - ((boxSizeEm.x - pEm.x) / max(bEm.x, 1e-4)) * sl.y;
                    else
                        u = lerp(sl.x, 1.0 - sl.y, saturate((pEm.x - bEm.x) / max(boxSizeEm.x - 2.0 * bEm.x, 1e-4)));
                }

                float v = saturate(local01.y);
                if (sl.z > 0.001 || sl.w > 0.001)
                {
                    if (pEm.y < bEm.y && sl.z > 0.001)
                        v = (pEm.y / max(bEm.y, 1e-4)) * sl.z;
                    else if (pEm.y > boxSizeEm.y - bEm.y && sl.w > 0.001)
                        v = 1.0 - ((boxSizeEm.y - pEm.y) / max(bEm.y, 1e-4)) * sl.w;
                    else
                        v = lerp(sl.z, 1.0 - sl.w, saturate((pEm.y - bEm.y) / max(boxSizeEm.y - 2.0 * bEm.y, 1e-4)));
                }
                return float2(u, v);
            }

            v2f vert(appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

                float objScale = max(length(float3(unity_ObjectToWorld[0][1], unity_ObjectToWorld[1][1], unity_ObjectToWorld[2][1])), 0.01);
                float scale = max(_BubbleScale, 0.01) * objScale;
                float3 worldOrigin = mul(unity_ObjectToWorld, float4(0, 0, 0, 1)).xyz + float3(0, _BaseHeight * objScale, 0);

                float3 toCam = _WorldSpaceCameraPos - worldOrigin;
                toCam.y = 0.0;
                if (dot(toCam, toCam) < 1e-6)
                {
                    toCam = float3(0, 0, 1);
                }
                float3 forward = normalize(toCam);
                float3 up = float3(0, 1, 0);
                float3 right = normalize(cross(forward, up));

                float3 localScaled = float3(v.vertex.x * scale, v.vertex.y * scale, 0.0);
                float3 worldPos = worldOrigin + right * localScaled.x + up * localScaled.y;

                o.pos = UnityWorldToClipPos(worldPos);
                o.emPos = float2(v.vertex.x / EM_SIZE, v.vertex.y / EM_SIZE);
                return o;
            }

            fixed4 RenderSlot(SlotArrays s, float baseY, float boxW, float boxH, float contentW, bool isSlot0, float2 emPos, float2 ddxGrid, float2 ddyGrid, float emPerPixel, float animTime)
            {
                float2 center = float2(0.0, baseY + 0.5 * boxH);
                float2 halfSize = float2(0.5 * boxW, 0.5 * boxH);
                int fMode = (int)round(_FrameMode);

                float cornerR = max(_CornerRadius, 0.0);
                float borderW = max(_BorderWidth, 0.0);
                float padY = max(_PadY, 0.10);
                float lineH = max(_LineHeight, 0.90);

                float dBox = sdRoundBox(emPos - center, halfSize, cornerR);
                if (isSlot0 && _TailEnable > 0.5 && fMode != 1)
                {
                    float tw = max(_TailWidth, 0.05);
                    float th = max(_TailHeight, 0.05);
                    float maxTailShift = max(halfSize.x - cornerR - tw, 0.0);
                    float tailX = clamp(_TailOffsetX, -maxTailShift, maxTailShift);
                    float dTail = sdTriangleDown(emPos - float2(tailX, baseY + 0.04), tw, th) - min(0.03, cornerR * 0.5);
                    dBox = min(dBox, dTail);
                }

                // Soft drop shadow
                fixed4 col = fixed4(0, 0, 0, 0);
                if (_ShadowColor.a > 0.004)
                {
                    float2 shadowCenter = center + float2(_ShadowOffsetX, _ShadowOffsetY);
                    float dShadow = sdRoundBox(emPos - shadowCenter, halfSize + 0.03, cornerR);
                    float shSoft = max(_ShadowSoftness, 0.015);
                    float shadowAlpha = smoothstep(shSoft, -0.04, dShadow) * _ShadowColor.a;
                    col = fixed4(_ShadowColor.rgb, shadowAlpha);
                }

                float aa = clamp(fwidth(dBox) * 1.25, 0.015, 0.09);
                float outerMask = 1.0 - smoothstep(-aa, aa, dBox);
                float innerMask = 1.0 - smoothstep(-aa, aa, dBox + borderW);

                float2 localBox01 = (emPos - (center - halfSize)) / max(float2(boxW, boxH), 1e-4);
                float textClipMask = outerMask;

                if (fMode == 0 || fMode == 2)
                {
                    float bgT = saturate((1.0 - localBox01.y) * _BgGradient);
                    fixed4 bgFill = lerp(_BgColor, _BgColor2, bgT);
                    fixed4 procFill = (borderW > 0.002) ? lerp(_BorderColor, bgFill, innerMask) : bgFill;
                    procFill.a *= outerMask;
                    col = CompositeOver(col, procFill);
                    textClipMask = (borderW > 0.002) ? innerMask : outerMask;
                }

                if (fMode == 1 || fMode == 2)
                {
                    if (localBox01.x >= 0.0 && localBox01.x <= 1.0 && localBox01.y >= 0.0 && localBox01.y <= 1.0)
                    {
                        float2 skinUV = SampleNineSliceUV(localBox01, float2(boxW, boxH), _SkinSlice, max(_SkinBorderEm, 0.08));
                        fixed4 skinSample = tex2Dlod(_SkinTex, float4(skinUV, 0, 0)) * _SkinTint;
                        // Smooth 1px outer rect edge for 9-slice mode
                        float rectEdge = min(min(localBox01.x * boxW, (1.0 - localBox01.x) * boxW), min(localBox01.y * boxH, (1.0 - localBox01.y) * boxH));
                        skinSample.a *= smoothstep(0.0, 0.04, rectEdge);
                        col = CompositeOver(col, skinSample);
                        if (fMode == 1)
                        {
                            textClipMask = smoothstep(0.0, 0.06, rectEdge);
                        }
                    }
                    else if (fMode == 1)
                    {
                        textClipMask = 0.0;
                    }
                }

                // Text layout inside bubble (multi-glyph overlap-safe compositing)
                if (textClipMask > 0.01 && s.len > 0 && s.exactReveal > 0.0)
                {
                    float topRowY = baseY + boxH - padY - 0.5 * lineH;
                    float botRowY = topRowY - lineH;
                    float leftX = -0.5 * contentW;

                    float dyTop = abs(emPos.y - topRowY);
                    float dyBot = abs(emPos.y - botRowY);
                    bool twoLines = (s.line1 < s.len && s.exactReveal > (float)s.line1);
                    float maxPopExtra = max(_PopScale - 1.0, 0.0) * 0.74;
                    float shExtraY = (_TextShadowEnable > 0.5) ? (abs(_TextShadowOffsetY) + _TextShadowSoftness) : 0.0;
                    float waveMargin = abs(_WaveAmp) + abs(_PopOffsetY) + maxPopExtra + shExtraY + 0.14;
                    float rowBand = 0.62 * lineH + waveMargin;

                    bool hitRow0 = (dyTop <= rowBand);
                    bool hitRow1 = (twoLines && dyBot <= rowBand);

                    if (hitRow0 || hitRow1)
                    {
                        float center = clamp(0.5 - _TextWeight, 0.18, 0.82);
                        bool hasSh = (_TextShadowEnable > 0.5 && _TextShadowColor.a > 0.004);
                        bool hasOutline = (_TextOutlineWidth > 0.002);

                        fixed4 shadowLayer = fixed4(0, 0, 0, 0);
                        fixed4 outlineLayer = fixed4(0, 0, 0, 0);
                        fixed4 fillLayer = fixed4(0, 0, 0, 0);

                        float cursorX = leftX;
                        for (int k = 0; k < 24; k++)
                        {
                            if (k >= s.len) break;
                            if (k == s.line1) cursorX = leftX;

                            float gc = s.cols[k];
                            float gr = s.rows[k];
                            float adv = GlyphAdvance(gc, gr);
                            float wt = CharRevealWeight(k, s.exactReveal);
                            if (wt <= 0.001) break;

                            bool onRow0 = (k < s.line1);
                            bool rowCandidate = onRow0 ? hitRow0 : hitRow1;

                            if (rowCandidate && !(gc < 1.5 && gr < 0.5))
                            {
                                float rowCenterY = onRow0 ? topRowY : botRowY;
                                float charCenterX = cursorX + 0.5 * adv;
                                float popScale = max(lerp(_PopScale, 1.0, wt), 0.25);
                                float glyphScale = 1.48 * popScale;
                                float popY = (1.0 - wt) * _PopOffsetY;
                                float waveY = (_WaveAmp > 0.001) ? (sin(animTime * _WaveSpeed + (float)k * _WaveFreq) * _WaveAmp * wt) : 0.0;

                                float localY = emPos.y - (rowCenterY + popY + waveY);
                                float localX = (emPos.x - _TextItalic * localY) - charCenterX;
                                float2 cellUV = float2(localX / glyphScale + 0.5, localY / glyphScale + 0.505);
                                float2 shCellRaw = cellUV - float2(_TextShadowOffsetX, _TextShadowOffsetY) / glyphScale;

                                bool inMain = (cellUV.x > 0.02 && cellUV.x < 0.98 && cellUV.y > 0.02 && cellUV.y < 0.98);
                                bool inShadow = hasSh && (shCellRaw.x > 0.02 && shCellRaw.x < 0.98 && shCellRaw.y > 0.02 && shCellRaw.y < 0.98);

                                if (inMain || inShadow)
                                {
                                    float2 ddxChar = ddxGrid / popScale;
                                    float2 ddyChar = ddyGrid / popScale;
                                    float edgeW = clamp(emPerPixel * (4.0 / glyphScale) * 0.9, 0.022, 0.16);

                                    if (inShadow)
                                    {
                                        float sdfSh = SampleAtlasSDF(gc, gr, shCellRaw, ddxChar, ddyChar);
                                        float shSoft = max(_TextShadowSoftness, edgeW);
                                        float shEdge = center - _TextOutlineWidth;
                                        float shMask = smoothstep(shEdge - shSoft, shEdge + shSoft, sdfSh) * _TextShadowColor.a * wt * textClipMask;
                                        if (shMask > 0.002)
                                        {
                                            shadowLayer = CompositeOver(shadowLayer, fixed4(_TextShadowColor.rgb, shMask));
                                        }
                                    }

                                    if (inMain)
                                    {
                                        float sdf = SampleAtlasSDF(gc, gr, cellUV, ddxChar, ddyChar);
                                        float fillMask = smoothstep(center - edgeW, center + edgeW, sdf);
                                        float tGrad = saturate((1.0 - cellUV.y) * _TextGradient);
                                        fixed4 fillCol = lerp(_TextColor, _TextColor2, tGrad);

                                        if (hasOutline)
                                        {
                                            float outerGlyph = smoothstep(center - _TextOutlineWidth - edgeW, center - _TextOutlineWidth + edgeW, sdf);
                                            float ringMask = lerp(saturate(outerGlyph - fillMask), outerGlyph, fillCol.a);
                                            float outA = _TextOutlineColor.a * ringMask * wt * textClipMask;
                                            if (outA > 0.002)
                                            {
                                                outlineLayer = CompositeOver(outlineLayer, fixed4(_TextOutlineColor.rgb, outA));
                                            }
                                        }

                                        float fillA = fillCol.a * fillMask * wt * textClipMask;
                                        if (fillA > 0.002)
                                        {
                                            fillLayer = CompositeOver(fillLayer, fixed4(fillCol.rgb, fillA));
                                        }
                                    }
                                }
                            }
                            cursorX += adv;
                        }

                        if (shadowLayer.a > 0.002) col = CompositeOver(col, shadowLayer);
                        if (outlineLayer.a > 0.002) col = CompositeOver(col, outlineLayer);
                        if (fillLayer.a > 0.002) col = CompositeOver(col, fillLayer);
                    }
                }

                // Optional decorative corner sticker / badge
                if (_BadgeEnable > 0.5 && (_BadgeSlot0Only < 0.5 || isSlot0))
                {
                    int bAnchor = (int)round(_BadgeCorner);
                    float2 anchorPos = center + float2(halfSize.x, halfSize.y); // 1: TR default
                    if (bAnchor == 0) anchorPos = center + float2(-halfSize.x, halfSize.y);
                    else if (bAnchor == 2) anchorPos = center + float2(-halfSize.x, -halfSize.y);
                    else if (bAnchor == 3) anchorPos = center + float2(halfSize.x, -halfSize.y);
                    else if (bAnchor == 4) anchorPos = center + float2(0.0, halfSize.y);

                    anchorPos += float2(_BadgeOffsetX, _BadgeOffsetY);
                    float bSize = max(_BadgeSize, 0.15);
                    float2 bUV = (emPos - anchorPos) / bSize + 0.5;
                    if (bUV.x >= 0.0 && bUV.x <= 1.0 && bUV.y >= 0.0 && bUV.y <= 1.0)
                    {
                        fixed4 badgeSample = tex2Dlod(_BadgeTex, float4(bUV, 0, 0)) * _BadgeTint;
                        col = CompositeOver(col, badgeSample);
                    }
                }

                if (col.a < 0.004) return fixed4(0, 0, 0, 0);

                if (_EmissionStrength > 0.001)
                {
                    col.rgb = col.rgb * (1.0 + _EmissionStrength) + _EmissionColor.rgb * _EmissionStrength;
                }

                col.a *= s.alpha;
                return col;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);

                if (_Enable < 0.5 && _EB_PreviewActive < 0.5)
                {
                    discard;
                    return fixed4(0, 0, 0, 0);
                }

                float2 ddxGrid = ddx(i.emPos) / (64.0 * 1.48);
                float2 ddyGrid = ddy(i.emPos) / (64.0 * 1.48);
                float emPerPixel = max(fwidth(i.emPos.x), fwidth(i.emPos.y));
                float animTime = (_EB_PreviewActive > 0.5) ? _EB_PreviewTime : _Time.y;

                SlotArrays s0, s1, s2;
                FILL_SLOT(s0, 0, 0)
                FILL_SLOT(s1, 1, 24)
                FILL_SLOT(s2, 2, 48)

                float w0 = 0, h0 = 0, cw0 = 0;
                float w1 = 0, h1 = 0, cw1 = 0;
                float w2 = 0, h2 = 0, cw2 = 0;

                if (s0.alpha > 0.005 && s0.len > 0) ComputeBoxSize(s0, w0, h0, cw0);
                if (s1.alpha > 0.005 && s1.len > 0) ComputeBoxSize(s1, w1, h1, cw1);
                if (s2.alpha > 0.005 && s2.len > 0) ComputeBoxSize(s2, w2, h2, cw2);

                float gapY = max(_BubbleGap, 0.05);
                int fMode = (int)round(_FrameMode);
                float y0 = (_TailEnable > 0.5 && fMode != 1) ? max(_TailHeight + 0.10, 0.24) : 0.24;
                float occ0 = (s0.alpha > 0.005 && s0.len > 0) ? (h0 + gapY) * smoothstep(0.0, 0.30, s0.alpha) : 0.0;
                float y1 = y0 + occ0;
                float occ1 = (s1.alpha > 0.005 && s1.len > 0) ? (h1 + gapY) * smoothstep(0.0, 0.30, s1.alpha) : 0.0;
                float y2 = y1 + occ1;

                float shReach = max(_ShadowSoftness, 0.02) + 0.08 + max(abs(_ShadowOffsetX), abs(_ShadowOffsetY));
                float bdReach = (_BadgeEnable > 0.5) ? (0.5 * max(_BadgeSize, 0.15) + max(abs(_BadgeOffsetX), abs(_BadgeOffsetY)) + 0.12) : 0.0;
                float extraX = max(shReach, bdReach) + 0.25;
                float extraTop = max(shReach, bdReach) + 0.20;
                float extraBotOther = max(shReach, bdReach) + 0.18;
                float extraBot0 = max(extraBotOther, (_TailEnable > 0.5 && fMode != 1) ? (_TailHeight + 0.14) : 0.18);

                fixed4 outCol = fixed4(0, 0, 0, 0);

                // Back-to-front composition (Slot 2 -> Slot 1 -> Slot 0) so overlapping shadows/badges blend seamlessly
                if (s2.alpha > 0.005 && s2.len > 0 &&
                    abs(i.emPos.x) <= 0.5 * w2 + extraX &&
                    i.emPos.y >= y2 - extraBotOther && i.emPos.y <= y2 + h2 + extraTop)
                {
                    fixed4 c2 = RenderSlot(s2, y2, w2, h2, cw2, false, i.emPos, ddxGrid, ddyGrid, emPerPixel, animTime);
                    if (c2.a > 0.003) outCol = CompositeOver(outCol, c2);
                }

                if (s1.alpha > 0.005 && s1.len > 0 &&
                    abs(i.emPos.x) <= 0.5 * w1 + extraX &&
                    i.emPos.y >= y1 - extraBotOther && i.emPos.y <= y1 + h1 + extraTop)
                {
                    fixed4 c1 = RenderSlot(s1, y1, w1, h1, cw1, false, i.emPos, ddxGrid, ddyGrid, emPerPixel, animTime);
                    if (c1.a > 0.003) outCol = CompositeOver(outCol, c1);
                }

                if (s0.alpha > 0.005 && s0.len > 0 &&
                    abs(i.emPos.x) <= 0.5 * w0 + extraX &&
                    i.emPos.y >= y0 - extraBot0 && i.emPos.y <= y0 + h0 + extraTop)
                {
                    fixed4 c0 = RenderSlot(s0, y0, w0, h0, cw0, true, i.emPos, ddxGrid, ddyGrid, emPerPixel, animTime);
                    if (c0.a > 0.003) outCol = CompositeOver(outCol, c0);
                }

                if (outCol.a <= 0.003) discard;
                return outCol;
            }
            ENDCG
        }
    }
    CustomEditor "EkacBubble.Editor.EkacBubbleShaderGUI"
}
