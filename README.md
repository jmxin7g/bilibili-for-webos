# Bilibili for WebOS

**在 LG 电视上，用遥控器看 B 站。**

一个面向 LG webOS 电视的独立客户端。用遥控器浏览推荐、搜索视频和选集。扫码登录后，可以查看关注、稍后再看、观看历史和收藏。安装完成后，播放服务在电视上运行。

**[下载标准版](https://github.com/jmxin7g/bilibili-for-webos/releases/tag/v1.0.3)** · **[下载 Homebrew 版](https://github.com/jmxin7g/bilibili-for-webos/releases/tag/homebrew-v1.0.3)** · [安装指南](docs/INSTALL.md) · [源码与构建](docs/BUILD.md)

![LG webOS 电视上的 Bilibili 播放器与遥控器播放控件](docs/screenshots/player.jpg)

## 安装到电视

| 版本 | 适合谁 | 下载 |
| --- | --- | --- |
| **标准版 v1.0.3** | 首次手动安装，或升级之前从本项目下载的标准版 | [标准版 IPK](https://github.com/jmxin7g/bilibili-for-webos/releases/download/v1.0.3/com.jinmx.independent.playback_1.0.3_all.ipk) |
| **Homebrew v1.0.3** | 希望试用独立的 Homebrew 版，可与标准版同时安装 | [Homebrew IPK](https://github.com/jmxin7g/bilibili-for-webos/releases/download/homebrew-v1.0.3/io.github.jmxin7g.bilibili_1.0.3_all.ipk) |

两个版本都可以按[安装指南](docs/INSTALL.md)手动安装。Homebrew Channel 的目录进度见 [webosbrew/apps-repo #385](https://github.com/webosbrew/apps-repo/issues/385)。

Homebrew 版已在 **LG G6（webOS TV 26）** 验证启动、首页加载、游客模式 480p 播放和二维码显示。其他机型的兼容性仍待验证。可选画质取决于片源、账号和电视解码能力。

## 用遥控器操作

| 操作 | 遥控器上怎么做 |
| --- | --- |
| 打开侧栏 | 在浏览页顶端按返回，或在最左侧继续按左键 |
| 搜索 | 在侧栏选择 **搜索**，输入关键词、BV 号或剧集链接 |
| 登录 | 进入 **设置 → 扫码登录**，用手机哔哩哔哩 App 扫码确认 |
| 选集 | 在多 P 视频或剧集详情页，选择播放按钮旁的 **选集** |
| 播放 | 按确认键唤出控件，可调整画质、倍速、弹幕和字幕。控件隐藏时，左右键前后跳转 10 秒 |

<table>
<tr>
<td width="50%"><img src="docs/screenshots/search.jpg" alt="用电视屏幕键盘搜索视频"><br><strong>搜索视频</strong></td>
<td width="50%"><img src="docs/screenshots/video-detail.jpg" alt="视频详情页和播放入口"><br><strong>查看视频详情</strong></td>
</tr>
</table>

## 从源码构建

[浏览标准版源码](source/) · [构建说明和对应版本的源码包](docs/BUILD.md)

## 反馈问题

请在 [GitHub Issues](https://github.com/jmxin7g/bilibili-for-webos/issues/new) 附上电视型号、webOS 版本、应用版本和复现步骤。应用由独立开发者维护，Bilibili 和 LG 的名称与标识归各自权利人所有。
