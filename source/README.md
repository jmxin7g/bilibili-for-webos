# 标准版源码

这是 Bilibili for WebOS **标准版 v1.0.3** 的源码快照。若要复现 Homebrew 版的安装包，请使用该版本对应的[源码附件](../docs/BUILD.md)。

| 位置 | 内容 |
| --- | --- |
| [`app/`](app/) | 电视界面、遥控器导航、登录和播放器 |
| [`service/`](service/) | 电视端 Luna 服务入口及调用校验 |
| [`server.mjs`](server.mjs) 和同级模块 | Bilibili 接口、登录会话、媒体代理和播放逻辑 |
| [`tools/`](tools/) | webOS IPK 打包和模拟器工具 |
| [`tests/`](tests/) | 单元测试、模拟器和真机测试入口 |
| [`vendor/`](vendor/) | 随源码提供的第三方组件及其许可 |

在当前目录执行 `npm ci` 安装依赖。环境要求、测试和打包步骤见[构建指南](../docs/BUILD.md)。
