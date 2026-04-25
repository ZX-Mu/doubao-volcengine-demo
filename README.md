# Volcengine Speech Demo

这个项目用于自己本地验证火山引擎豆包语音服务的ap能力和官方接入链路

- 语音识别：流式语音识别模型 2.0
- 语音合成：豆包语音合成大模型 2.0

## 当前实现

- 浏览器侧录音使用原生 `getUserMedia + AudioWorklet`
- 开发期由 Vite 本地代理转发官方请求，避免浏览器无法给 WebSocket 设置 `X-Api-*` 鉴权头的问题
- TTS 通过本地 `/api/proxy/tts/sse` 请求官方单向流式接口，并在前端汇总返回的音频分片
- 配置弹窗内提供“方案1 JWT 测试模式”：本地 Vite 服务用长期 Access Token 换取短期 JWT，前端直连 WebSocket 时通过 query 传递 `api_access_key=Jwt%3B%20<jwt_token>`

## 启动

1. 安装依赖

```bash
npm install
```

2. 启动开发服务

```bash
npm run dev
```

3. 打开页面后填写：

- `App ID`
- `Access Token`
- `ASR Resource ID`，默认 `volc.seedasr.sauc.duration`
- `TTS Resource ID`，默认 `seed-tts-2.0`

## 方案1 JWT 直连验证

1. 打开右下方控制台顶部的“配置参数”。
2. 填入 `App ID` 和长期 `Access Token`。
3. 在“方案1 JWT 测试模式”区域点击“获取 JWT Token 并启用”。
4. 看到顶部配置条显示“方案1 JWT 测试”和 JWT 剩余时间后，执行以下任一验证：

- ASR：选择“双向流式模式（优化版）”，点击“检查握手”或“开始识别”。该模式会直接连接 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`，并在 URL query 中传递 `api_access_key=Jwt%3B%20<jwt_token>`。
- TTS：选择“单向流式模式（WebSocket V3 直连）”或“双向流式模式（WebSocket V3 直连）”，点击“立即开始合成”。这两种模式会让浏览器直接连接官方 WebSocket，并用 JWT query 鉴权。

如果要对照原始长期 token 链路，在配置弹窗里切回 `Access Token` 即可。运行日志不会输出真实 token，浏览器控制台中的直连 URL 也会脱敏。

## 凭据说明

- 这个项目不会在仓库内提供真实的 `App ID` 或 `Access Token`
- 运行时需要你在本地页面里手动填写自己的火山引擎凭据
- 凭据仅用于本地调试，请不要把真实 token 写死到源码、配置文件或 README
- JWT 测试 token 只保存在浏览器 localStorage，过期后需要重新点击获取
- 如果要上传到 GitHub，建议只保留示例值、占位符和说明文档

## 提交到 GitHub 前

- 不要提交真实的 `.env`、`.env.local` 等本地环境文件
- 当前仓库中的 `.env.example` 仅用于示例，不包含真实敏感信息
- 如果你在本地页面里填过真实 token，那是浏览器本地数据，不属于仓库内容

## 已知说明

- 当前目标是“先跑通官方能力”
- TTS 现在返回流，前端为了稳定性会先汇总音频分片，再交给浏览器播放和下载，暂时没处理流式播放
- 如果后续要扩展 `chunked`、更多 TTS 模式或更多 ASR 参数，可以直接在现有代理层上继续加
