# 蓝牙墨水屏网页控制端 (Bluetooth E-Ink Web Controller)

## 📖 项目目的 (Project Purpose)
本项目旨在提供一个轻量级、跨平台、免安装的网页前端工具，用于控制 4.2 寸（400×300 分辨率）三色（黑/白/红）蓝牙墨水显示屏。

相比依赖特定移动 App 或桌面客户端的方案，这个项目希望让用户仅通过浏览器完成：文本排版、字体定制、图像量化预览，并最终将图像发送到设备，实现更低门槛的 DIY 交互体验。

---

## ✅ 当前已实现功能 (Implemented)

1. **文本生成 SVG**：输入多行文字后生成 SVG，默认白底。
2. **屏幕方向切换**：支持横向（400×300）与竖向（300×400）画布输出。
3. **三色文本输出**：支持黑色或红色文本（背景白色，红色基准 `#FF0000`）。
4. **预览后导出流程**：先“更新预览”，确认无误后再导出 SVG。
5. **字体能力**：
   - 在线字体（Google Fonts 预置）
   - 上传本地字体（`.ttf` / `.otf` / `.woff` / `.woff2`）
6. **Atkinson 模拟预览**：基于 Canvas 的三色量化 + Atkinson 误差扩散预览。
7. **Firefox 发送通道（升级版）**：
   - 本地 WebSocket 蓝牙桥接发送流程（Ubuntu + BlueZ）
   - 支持分包大小、分包间隔配置
   - 支持前端进度条显示（progress/done）
   - 支持 ACK 分组校验与失败重试（每 N 包）

---

## 🧭 Firefox 蓝牙能力说明（重点）

- **Firefox 目前不支持 Web Bluetooth API**，因此网页无法像 Chrome/Edge 那样直接访问 `navigator.bluetooth`。
- 针对 Ubuntu + Firefox，本项目提供可运行替代方案：
  - 浏览器页面通过 WebSocket 连接本地 `tools/bluetooth_bridge.py`
  - 桥接服务使用 `bleak` 调用系统蓝牙栈（BlueZ）写入 GATT Characteristic

也就是说：
- 纯前端 Firefox 无法直连 BLE；
- 但可通过“Firefox 前端 + 本地桥接进程”达到可用发送体验。

---

## ⚙️ 当前实现流程 (Current Workflow)

1. 输入文本并设置参数（方向、字号、行高、边距、对齐、字体、颜色）。
2. 点击“更新预览”，生成目标尺寸 SVG。
3. 在页面中查看 SVG 预览与 Atkinson 三色模拟预览。
4. 可选：导出 SVG。
5. Firefox 下填写 MAC 与 Characteristic UUID，设置分包参数并发送 2-bit 打包像素数据。

---

## 🚀 Ubuntu + Firefox 使用方式

### 1) 启动网页

```bash
python -m http.server 8000
```

然后在 Firefox 打开 `http://127.0.0.1:8000`。

### 2) 启动蓝牙桥接服务（另一个终端）

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r tools/requirements.txt
python tools/bluetooth_bridge.py
```

默认监听：`ws://127.0.0.1:8765`。

### 3) 在页面发送

- WebSocket 地址：`ws://127.0.0.1:8765`
- 设备 MAC 地址：你的墨水屏蓝牙地址
- Characteristic UUID：你的设备写入特征值 UUID
- 分包大小：建议从 120~180 字节尝试
- 分包间隔：建议从 10~30ms 调整
- ACK 每 N 包：建议先用 10
- ACK UUID / 期望 hex：按设备协议填写
- 最大重试次数：建议 2~3

---

## 🎨 前端设计示意图

见：`docs/frontend-design.md`（包含 IA、时序图、线框草图）。

---

## 🗂 文件结构 (Project Structure)

- `index.html`：页面结构与交互控件
- `styles.css`：界面样式
- `app.js`：SVG 生成、字体处理、Atkinson 预览、2-bit 打包与 WebSocket 发送
- `tools/bluetooth_bridge.py`：Ubuntu 本地蓝牙桥接服务（含分包发送 + ACK 校验 + 重试 + 进度回传）
- `tools/requirements.txt`：桥接服务 Python 依赖
- `docs/frontend-design.md`：前端设计示意图
