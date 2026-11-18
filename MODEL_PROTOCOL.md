# ekac-bubble 本机模型协议 v1
仅绑定 ws://127.0.0.1:9011/?token=<软件本次运行生成的令牌>。令牌显示在界面，程序重启失效；仅用于本机软件适配器。参数端口占用时明确提示，不自动更换端口。
所有帧为 JSON，含 v:1 和 type。客户端只接收，不具备麦克风或文件操作权。
begin: {id,text,pitchHz,unitsPerSecond,unitDurationMs,sound}，新消息替换上条显示。完整文本为 UTF-8 JSON 字符串。unitDurationMs 为单音节发声时长（60–400 ms，默认100）；unitsPerSecond 为最大发声频率，音节之间不会重叠。
reveal: {id,count,elapsedMs}，count 为已显示 Unicode 码点数（非 UTF-16 下标）；客户端只应用当前 id 的进度，elapsedMs 相对本句开始。
end: {id}，语音与出字已完成，保留最终文字到下一句或取消。
cancel: {id}，立即终止当前消息并清除显示。
连接后首先收到 snapshot: {state:null | begin字段+count+elapsedMs?+ended?}；据此恢复当前气泡，重连不会重播已经播过的音频。
音频由软件通过选择的设备播放，不走 WebSocket 或 OSC。VRChat 头顶模型气泡由软件内置 OSC 发送器经 127.0.0.1:9000 `/avatar/parameters/EB_*` 直接驱动 `ekac气泡插件.unitypackage`；本机 9011 端口同步输出协议帧供预览与第三方本地适配器使用。

仅模型气泡模式开启监听，通用游戏与 Chatbox 模式不启动此端口。音频仍经用户选择的输出设备，不通过本协议发送。
