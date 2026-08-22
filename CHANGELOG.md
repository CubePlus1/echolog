# Changelog

## 0.2.0 — 2026-08-22

- 新增 opt-in screen-understanding：Provider 配置、macOS Keychain 密钥、显式截图测试、周期/立即 vision 识别和结构化历史。
- 新增 `EchoLogScreenCapture.app`，使用固定 Bundle ID 承载 ScreenCaptureKit 与屏幕录制权限；截图仅在单次请求临时目录中存在。
- 新增独立 screen-understanding Web 管理页和 `el screen understanding` CLI 查询/运行命令。
- 扩展 Codex Plugin，提供只读 `$echolog:screen-understanding` Skill。
- 完成 tmux-status v3 contract、语义验证和 Agent conversation↔pane 恢复映射。
- 新增面向 Agent 的独立运行手册，以及包含源码、构建产物、依赖、权限 App、manifest 和 SHA-256 的 macOS arm64 发布包。

### Distribution note

v0.2.0 的 macOS App 资产使用 ad-hoc 签名并通过严格 codesign 校验，但未经过 Apple Developer ID 签名或 notarization。首次运行可能需要用户在“隐私与安全性”中手动允许。
