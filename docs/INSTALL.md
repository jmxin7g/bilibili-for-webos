# 安装到 LG 电视

[返回项目首页](../README.md)

## 选择安装包

| 版本 | 应用 ID | 下载 |
| --- | --- | --- |
| **标准版** | `com.jinmx.independent.playback` | [最新标准版](https://github.com/jmxin7g/bilibili-for-webos/releases/latest) |
| **Homebrew 版** | `io.github.jmxin7g.bilibili` | [Homebrew v1.0.3](https://github.com/jmxin7g/bilibili-for-webos/releases/tag/homebrew-v1.0.3) |

从发布页 **Assets** 选择对应的 `.ipk`。两个版本可以同时安装，各自保存登录状态。首次打开另一版需要重新扫码。更新已有应用时，使用相同应用 ID 的新版 IPK。

## 开启 Developer Mode

1. 在 LG 电视上安装 **Developer Mode**，用 LG Developer 账号登录。开启 **Dev Mode Status**，按照电视提示重启。
2. 重启后再次打开 **Developer Mode**。记下电视 IP，并打开 **Key Server**，记下页面显示的 **Passphrase**。
3. 确保电脑和电视连接到同一局域网。[LG 配对指南](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app)

## 用 webOS Dev Manager 安装

1. 从 [Dev Manager 发布页](https://github.com/webosbrew/dev-manager-desktop/releases/latest) 安装电脑对应的版本。
2. 在 Dev Manager 添加电视，填写 IP 和电视显示的 Passphrase。配对成功后，从设备下拉菜单选中电视。
3. 打开 **Apps → Installed → Install**，选择下载的 `.ipk`。安装完成后，到电视主页打开 **bilibili**。

## 用 webOS CLI 安装

<details>
<summary>展开配对和安装命令</summary>

在电脑上安装 LG 的 webOS CLI。使用 `ares-setup-device` 添加电视。记录设备名称，例如 `my-tv`。端口为 `9922`，SSH 用户为 `prisoner`。

在电视的 Developer Mode 里开启 **Key Server**，再在电脑终端取配对密钥。命令提示时，输入电视显示的 Passphrase。

```sh
ares-novacom --device my-tv --getkey
```

进入下载 IPK 所在的目录，选择对应版本的一组命令。若设备名或安装包文件名不同，请用实际名称。

**标准版**

```sh
ares-install -d my-tv com.jinmx.independent.playback_1.0.3_all.ipk
ares-launch -d my-tv com.jinmx.independent.playback
```

**Homebrew 版**

```sh
ares-install -d my-tv io.github.jmxin7g.bilibili_1.0.3_all.ipk
ares-launch -d my-tv io.github.jmxin7g.bilibili
```

</details>

## 第一次打开

- 方向键移动焦点，确认键选择。在页面顶端按返回键，或在最左侧继续按左键，可打开侧栏。
- 在 **设置 → 扫码登录** 打开二维码，用手机哔哩哔哩 App 扫码确认。
- 要延长电视上的 Developer Mode，在剩余时间归零前打开 **Developer Mode → EXTEND**。
