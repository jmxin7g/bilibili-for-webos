<p align="center">
  <img src="docs/screenshots/cover.jpg" alt="Bilibili for WebOS，展示电视播放器和屏幕搜索键盘">
</p>

<p align="center">
  <strong>把 B 站带到 LG 电视上。</strong><br>
  为遥控器设计的独立 webOS 客户端，支持搜索、选集、弹幕和断点续播。
</p>

<p align="center">
  <a href="https://github.com/jmxin7g/bilibili-for-webos/releases/latest"><strong>下载标准版</strong></a> ·
  <a href="#安装到电视"><strong>安装到电视</strong></a> ·
  <a href="#界面预览">界面预览</a> ·
  <a href="docs/BUILD.md">开发与构建</a>
</p>

## 安装到电视

**第一次安装，选标准版。** 如果电视已经装过本项目的标准版，继续下载同一版本渠道的 IPK，即可覆盖更新。

1. **下载 IPK。** 打开 [最新标准版](https://github.com/jmxin7g/bilibili-for-webos/releases/latest)，在 **Assets** 下载名称以 `com.jinmx.independent.playback` 开头的 `.ipk` 文件。
2. **配对电视。** 在 LG 电视安装并开启 **Developer Mode**。电脑和电视连到同一网络后，用 [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases/latest) 添加电视。
3. **安装并打开。** 在 Dev Manager 中选择电视，进入 **Apps → Installed → Install**，选择刚下载的 IPK。之后从电视主页打开 **bilibili**。

[查看完整配对步骤和终端命令](docs/INSTALL.md)

> **Homebrew 版** 与标准版使用不同的应用 ID，可以同时安装，首次使用需要重新扫码。[下载 Homebrew 版](https://github.com/jmxin7g/bilibili-for-webos/releases/tag/homebrew-v1.0.3) · [社区目录进度](https://github.com/webosbrew/apps-repo/issues/385)

## 在电视上能做什么

- **找视频。** 浏览推荐、热门和分区，也可以输入关键词、BV 号或剧集链接。
- **选集和播放。** 普通多 P 视频和剧集可在详情页选集。播放时可调整画质、倍速、弹幕和片源提供的字幕。
- **继续上次观看。** 电视端记录播放进度。用手机扫码登录后，还可以查看关注更新、稍后再看、历史和收藏。

## 界面预览

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/search.jpg" alt="电视上的搜索结果和屏幕键盘"><br><strong>用遥控器搜索</strong></td>
    <td width="50%" align="center"><img src="docs/screenshots/video-detail.jpg" alt="视频详情、播放入口与相关推荐"><br><strong>在详情页选视频</strong></td>
  </tr>
</table>

播放时按遥控器确认键可呼出控制栏。控件收起时，按左右键可前后跳转 10 秒。

## 兼容性与反馈

Homebrew v1.0.3 已在 **LG G6（webOS TV 26）** 验证启动、首页加载、游客模式 480p 播放和二维码显示。其他机型和画质的表现取决于片源、账号及电视解码能力。

遇到问题请到 [GitHub Issues](https://github.com/jmxin7g/bilibili-for-webos/issues/new) 附上电视型号、webOS 版本、应用版本和复现步骤。

## 从源码构建

[浏览源码与目录说明](source/) · [构建命令与版本源码下载](docs/BUILD.md)

本项目由独立开发者维护。Bilibili 和 LG 的名称与标识归各自权利人所有。
