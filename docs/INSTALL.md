# 安装到 LG 电视

[返回项目首页](../README.md#bilibili-for-webos)

## 1. 在电视上开启 Developer Mode

在 LG 电视应用商店安装 **Developer Mode**，登录 LG Developer 账号，开启 **Dev Mode Status**，按提示重启。将电脑和电视连到同一局域网。

## 2. 配对电脑与电视

在电脑安装 **webOS CLI**。在终端运行 `ares-setup-device`，使用电视 IP 添加设备，并将设备名设为 `my-tv`，或记下你自己的设备名。在电视的 Developer Mode 页面开启 **Key Server**，再运行以下命令并按提示输入电视上的 Passphrase。[LG 官方配对指南](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app)

```sh
ares-novacom --device my-tv --getkey
```

## 3. 选择一个安装包

将安装包下载到电脑，在终端进入下载目录，选择下面一组命令。把 `my-tv` 换成你的设备名。

### 标准版

[下载标准版 IPK](https://github.com/jmxin7g/bilibili-for-webos/releases/download/v1.0.3/com.jinmx.independent.playback_1.0.3_all.ipk)

```sh
ares-install -d my-tv com.jinmx.independent.playback_1.0.3_all.ipk
ares-launch -d my-tv com.jinmx.independent.playback
```

### Homebrew 版

[下载 Homebrew 版 IPK](https://github.com/jmxin7g/bilibili-for-webos/releases/download/homebrew-v1.0.3/io.github.jmxin7g.bilibili_1.0.3_all.ipk)

```sh
ares-install -d my-tv io.github.jmxin7g.bilibili_1.0.3_all.ipk
ares-launch -d my-tv io.github.jmxin7g.bilibili
```

电视把这两个版本识别为两个独立应用。Homebrew 版首次登录需要重新扫码。手动升级时，请安装与当前应用相同渠道的新版 IPK。

## 4. 从电视主页打开应用

在电视主页打开 **bilibili**。Developer Mode 的 **Remain Session** 显示剩余时间，到期前可选择 **EXTEND** 延长。
