# 来源与授权
STT 分句、读音映射、音节播放、录音 worklet 与音节库来自 Pal-AI-Lab/Coopanion 本地快照（0.2.20），AGPL-3.0-or-later。保留原代码注释与本目录 LICENSE；修改集中在宿主接口适配，以及 web/speech.js（尾音单周期锁定延展替换 WSOLA）。
https://github.com/Pal-AI-Lab/Coopanion
vendor/speech/data 中的 Unicode、CMUdict、IPADIC 授权见同目录声明。音节库由上游使用 Edge TTS Xiaoyi 音色生成；重建脚本用于说明其来源，分发音频前应核对服务和素材许可。
SenseVoiceSmall 权重另按 FunASR 模型许可使用，下载源和 SHA-256 在 src/asr.ts 中。sherpa-onnx 为 Apache-2.0。模型权重不打入安装包。

品牌素材：图标由用户提供，樱花背景以用户参考图经 imagegen 生成，仅保留项目内优化版本。原图位于上级 pic/，未覆盖。
