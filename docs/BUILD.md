# 获取源码与构建电视安装包

[返回项目首页](../README.md)

## 获取源码

仓库的 [`source/`](../source/) 提供标准版 v1.0.3 的可浏览源码。要复现特定 Release，请下载下表中的对应附件。

| 版本 | 对应的源码快照 |
| --- | --- |
| 标准版 v1.0.3 | [标准版源码 ZIP](https://github.com/jmxin7g/bilibili-for-webos/releases/download/v1.0.3/bilibili-for-webos-v1.0.3-source.zip) |
| Homebrew v1.0.3 | [Homebrew 版源码 ZIP](https://github.com/jmxin7g/bilibili-for-webos/releases/download/homebrew-v1.0.3/bilibili-for-webos-homebrew-v1.0.3-source.zip) |

GitHub 自动生成的 **Source code (zip)** 和 **Source code (tar.gz)** 打包的是标签当时的仓库内容。上表链接通向对应安装包所用的源码附件。

## 构建

安装 **Node.js 20.12.2 或更高版本**和 **LG webOS CLI**。解压源码附件后，在包含 `package.json` 的目录运行下列命令。通过仓库获取时，先进入 `source/`。

```sh
npm ci
npm test
npm run package:tv
```

IPK 会生成在 `output/tv-build/`。在电脑上预览时，运行 `npm start`，再打开 `http://127.0.0.1:8769/`。

| 目录 | 内容 |
| --- | --- |
| `app/` | 电视界面、播放器、登录交互和遥控器导航 |
| `service/` | 电视端 Luna 服务入口与应用调用校验 |
| `tests/` | 单元测试、模拟器及真机测试脚本 |
| `tools/` | TV 打包与模拟器辅助脚本 |
| `vendor/` | 随源码提供的第三方组件与许可 |

第三方组件按随附许可分发。项目自身目前未采用开源许可证。
