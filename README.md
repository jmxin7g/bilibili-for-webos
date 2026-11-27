# Bilibili for WebOS

Bilibili for WebOS 是一款用遥控器操作的 LG webOS 电视端哔哩哔哩客户端。应用和播放服务一起安装在电视上，配对和安装完成后，可以从电视主页直接打开。

**[下载 v1.0.3 安装包（IPK）](https://github.com/jmxin7g/bilibili-for-webos/releases/download/v1.0.3/com.jinmx.independent.playback_1.0.3_all.ipk)** · [版本说明和源码下载](https://github.com/jmxin7g/bilibili-for-webos/releases/tag/v1.0.3)

## 主要功能

- 浏览推荐、热门和分区，按关键词、BV 号或哔哩哔哩视频和剧集链接查找内容。
- 打开视频详情、选集和 UP 主主页，播放普通多 P 视频及可访问的剧集。
- 用手机扫码登录后查看关注更新、稍后再看、观看历史和收藏夹，支持切换账号。
- 支持断点续播、画质选择、倍速、弹幕和片源提供的字幕。

## 安装到电视

1. 在 LG 电视的应用商店安装 **Developer Mode**。打开后登录 LG Developer 账号，开启 **Dev Mode Status**，按电视提示重启。
2. 电脑和电视连到同一局域网。电脑安装 **webOS CLI**，用 `ares-setup-device` 添加电视，记下设备名。在电视的 Developer Mode 页面开启 **Key Server**，再用 `ares-novacom --device my-tv --getkey` 完成配对。将 `my-tv` 换成你的设备名，按提示输入电视上的 Passphrase。[LG 官方配对指南](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app)
3. 下载上方的 `.ipk`。在电脑终端进入下载目录，运行以下命令，继续使用你设置的设备名。

   ```sh
   ares-install -d my-tv com.jinmx.independent.playback_1.0.3_all.ipk
   ares-launch -d my-tv com.jinmx.independent.playback
   ```

4. 以后可从电视主页打开 **bilibili**。升级时，使用同一条 `ares-install` 命令安装新版 IPK。Developer Mode 的 **Remain Session** 会显示剩余时间，记得在到期前选择 **EXTEND**。

## 用遥控器操作

| 想做什么 | 怎么操作 |
| --- | --- |
| 打开侧栏 | 在浏览页顶部按返回键，或在最左侧继续按左键。页面已经向下滚动时，返回键会先回到顶部。 |
| 搜索视频 | 侧栏进入 **搜索**，用屏幕键盘输入关键词、BV 号，或输入剧集链接、`ss` / `ep` 编号。选中结果后按确认键。 |
| 登录账号 | 侧栏进入 **设置 → 扫码登录**。已有账号时选择 **添加账号**。用手机哔哩哔哩 App 扫描电视上的二维码，在手机上确认登录。 |
| 选集 | 在多 P 视频或剧集的详情页，选中播放按钮旁的列表图标 **选集**，用方向键选中想看的那一集，再按确认键播放。 |
| 控制播放 | 播放时按确认键唤出控制栏。控制栏收起时，左右键后退或前进 10 秒。可在控制栏调整画质、倍速、弹幕和字幕。 |
| 刷新推荐或分区 | 在侧栏再次确认 **推荐**，或在分区页再次确认当前分区标签。 |

## 界面预览

**搜索** · 用遥控器在屏幕键盘输入关键词，右侧会显示搜索结果。

![电视端的屏幕键盘和视频搜索结果](docs/screenshots/search.jpg)

**视频详情** · 打开视频卡片可查看简介和相关推荐。多 P 视频和剧集会显示选集入口。

![视频详情页和播放入口](docs/screenshots/video-detail.jpg)

**播放器** · 按确认键可呼出播放控制栏，调整画质、倍速、字幕和弹幕。

![播放器的暂停、跳转和画质控制](docs/screenshots/player.jpg)

## 兼容性和播放

开发目标为 **LG webOS TV 26**。其他 webOS 版本的兼容性，以及 v1.0.3 在真机上的完整播放流程，仍待验证。可选画质取决于片源、账号权限和电视解码能力，地区限制由哔哩哔哩决定。遇到卡顿可先试 **自动** 画质或手动降低一档。

## 从源码构建

需要 **Node.js 20.12.2 或更新版本**以及 **LG webOS CLI**。在发布页下载 `bilibili-for-webos-v1.0.3-source.zip`，解压后在源码根目录运行：

```sh
npm ci
npm test
npm run package:tv
```

标准 IPK 输出到 `output/tv-build/`。如果只想在电脑上预览，运行 `npm start` 后打开 `http://127.0.0.1:8769/`。

本项目由独立开发者维护。哔哩哔哩与 LG 的名称和标识属于各自权利人。第三方组件按随附许可分发，项目自身源码尚未选定开源许可证。

遇到问题可提交 [GitHub Issue](https://github.com/jmxin7g/bilibili-for-webos/issues)，附上电视型号、webOS 版本、应用版本和复现步骤。
