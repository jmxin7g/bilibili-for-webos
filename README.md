# Bilibili for WebOS

面向 LG webOS 电视的第三方哔哩哔哩客户端。通过遥控器浏览推荐和分区、搜索关键词或 BV 号、查看分集和 UP 主主页，支持弹幕、字幕、倍速和断点续播。电视端内置服务，日常使用无需电脑常驻。

## 安装

1. 在电视上启用 Developer Mode，在同一局域网的电脑上安装 webOS CLI，按 [LG 官方指南](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app) 配对。
2. 从 [v1.0.0 Releases](https://github.com/jmxin7g/bilibili-for-webos/releases/tag/v1.0.0) 的 Assets 下载 `.ipk`。
3. 在安装包目录运行以下命令，将 `my-tv` 换成配对时设置的设备名。

```sh
ares-install -d my-tv com.jinmx.independent.playback_1.0.0_all.ipk
ares-launch -d my-tv com.jinmx.independent.playback
```

## 使用

- 方向键移动焦点，确认键打开视频或唤出播放控件。播放控件隐藏时，左右键可快退或快进 10 秒。
- 在浏览页顶部按返回键，或在最左侧继续按左键，打开侧栏。
- 在 **设置 → 添加账号** 用手机哔哩哔哩 App 扫码并确认。登录后可访问关注更新、稍后再看、观看历史和收藏夹。

## 兼容性与源码

以 LG webOS TV 26 为开发目标。此版尚未完成真机功能验证，4K 和 HDR 的播放稳定性仍待验证。完整源码和构建说明可在 Release 的 `bilibili-for-webos-v1.0.0-source.zip` 附件下载。
