# Directory Structure

> How frontend code is organized in this project.

---

## Overview

前端是**零依赖、零构建的原生三件套**——不是 React/Vite。视觉与交互参照「流年志」：宣纸/墨/朱砂/鎏金配色的 CSS 3D 翻页史书。由 Fastify 直接静态托管 `web/`，改完文件刷新浏览器即生效（无 build 步骤）。

---

## Directory Layout

```
web/
├── index.html    # 序幕 + 3D 书本舞台骨架（页由 JS 生成）
├── styles.css    # 全部样式：CSS 变量基调 + 3D 翻页 + 各页型
└── app.js        # 单 IIFE：API 客户端、faces 构建、翻页引擎、轮询、交互
```

## Module Organization（app.js 内部分区，按注释分节）

1. **API**：`api()/post()/patchReq()/del()` fetch 封装，相对路径 `/api/...`（同源免鉴权）
2. **数据**：`data` 全局 + `loadAll()/loadLive()`；`liveSignature()` 决定是否整本重排
3. **faces 构建**：`buildFaces()` 把数据摊成「面」序列（plate/toc/era/entry/summary/active/form/note/blank），偶数补白
4. **渲染**：`renderFace(face)` 返回 HTML 字符串；**所有动态文本过 `esc()`/属性过 `escA()`**
5. **书本引擎**：sheet 翻转 + `layoutSheets()` 维护唯一 translateZ 深度（preserve-3d 下 z-index 无效）
6. **交互**：事件委托挂在 `#pages`（faces 会整体重建，勿绑在具体节点）；`data-act`/`data-goto` 属性驱动
7. **计时**：`[data-timer]` 元素带 `data-base/fetched/paused`，每秒 `tickTimers()` 就地更新文本；`data-live-id` 让同一记录的多个计时器（正文页+目录页）一起刷新

## Naming Conventions

- CSS 类小写连字符，按页型前缀分组（`toc-`、`ts-`、`live-`、`form-`）
- 颜色/字体只用 `:root` CSS 变量（--ink/--paper/--cinnabar/--gold/--kai/--serif），不写裸色值

## 关键约束

- 重建书页会销毁输入框——轮询重排前必须 `isEditing()` 检查
- 翻页手势（wheel/drag）须跳过 `INTERACTIVE` 选择器内的目标
- 重建时加 `.no-anim` 双 rAF 移除，避免翻页动画闪烁
