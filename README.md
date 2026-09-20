# React Chat Interface

基于 React 的 AI 聊天界面，提供类似 ChatGPT 的用户体验。

## How to Run

### Docker 部署（推荐）

```bash
# 构建并启动服务
docker-compose up --build -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f frontend-user

# 停止服务
docker-compose down
```

### 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 生产构建
npm run build
```

## Services

| 服务名称 | 端口 | 说明 |
|---------|------|------|
| frontend-user | 8081 | 前端用户端 - React Chat Interface |

访问地址：http://localhost:8081

## 测试账号

| 类型 | 值 |
|------|-----|
| API Key | `sk-buouxmhplmkqskzzcpmvixsttjzggzupfrkzpscfpwwqvucp` |
| 平台 | [SiliconFlow](https://siliconflow.com) |

> 注：请前往 SiliconFlow 平台(https://siliconflow.com) 注册并获取自己的 API Key

## 题目内容

请帮我设计一个基于React的类OpenAI聊天界面，需满足以下功能：

1. **用户配置模块**
   - 提供API Key输入框（支持本地存储，避免重复填写）
   - 支持选择siliconflow平台的模型和参数（temperature、max_tokens信息)

2. **对话交互界面**
   - 仿ChatGPT的聊天布局：左侧历史会话列表，右侧主聊天区
   - 支持多轮对话，保留上下文（通过messages数组传递历史记录）
   - 实现流式响应（逐字输出效果），使用Server-Sent Events或OpenAI的stream参数

3. **功能增强**
   - 消息Markdown渲染（代码高亮、链接解析等）
   - 一键复制回复内容
   - 响应耗时统计与token用量显示

4. **错误处理与状态管理**
   - 网络错误、API限流等异常提示
   - 加载状态动画（如发送中、流式响应时）

5. **技术栈建议**
   - UI库：Ant Design或Material-UI
   - 状态管理：Zustand或Context API
   - 流式处理：使用`openai`库的`stream`参数或自定义SSE连接

**附加要求：**
- 提供完整的React Hooks实现方案
- 优先考虑TypeScript类型安全
- 兼容移动端布局
- 提供完整的readme.md文档

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 18 + TypeScript |
| UI | Ant Design 5 |
| 状态管理 | Zustand 5 |
| API 调用 | OpenAI SDK |
| Markdown | react-markdown + rehype-highlight + remark-gfm |
| 构建工具 | Vite 5 |
| 测试 | Vitest + fast-check |

## 功能特性

- 多轮对话，完整上下文保留
- 流式响应，逐字输出效果
- Markdown 渲染，代码语法高亮
- 对话历史管理，本地持久化
- 对话导出/导入，跨设备迁移（详见下文）
- 响应式布局，移动端适配
- Token 用量统计，响应时间显示
- 一键复制回复内容

## 对话导出 / 导入

把一次对话打包成 JSON 文件带走，在另一台机器上还原：

- **导出**：侧边栏中鼠标悬停某个对话，点击下载图标，即可把该对话的全部消息（正文 + 时间）保存为 `.json` 文件。
- **导入**：点击侧边栏标题栏的上传图标，选择之前导出的文件即可还原为新对话。

导入行为保证：

| 场景 | 行为 |
|------|------|
| 正文缺失、时间格式不对、条数超过上限（500 条） | 整体拒绝导入，并逐条给出可读的处理建议；现有对话不受任何影响 |
| 同一份文件重复上传 | 按内容指纹去重，直接定位到已导入的对话，不会重复创建 |
| 读取中断 / 校验失败 / 存储失败 | 全部或没有（原子性），不会只还原一半 |
| 还原结果 | 消息条数与先后次序与导出时完全一致 |
| 多次导入不同文件 | 每次生成新对话，互不覆盖，已有对话保持不变 |

## API 配置

使用 SiliconFlow 平台 API 服务：

- **Base URL**: `https://api.siliconflow.com/v1`
- **支持模型**:
  - DeepSeek V3 (`deepseek-ai/DeepSeek-V3`)
  - Qwen 2.5 72B (`Qwen/Qwen2.5-72B-Instruct`)
  - Qwen 2.5 32B (`Qwen/Qwen2.5-32B-Instruct`)

## 目录结构

```
src/
├── components/       # UI 组件
│   ├── Chat/         # 聊天组件
│   ├── Sidebar/      # 侧边栏
│   ├── Config/       # 配置面板
│   ├── Common/       # 通用组件
│   └── Layout/       # 布局组件
├── stores/           # Zustand 状态管理
├── services/         # 服务层
├── hooks/            # 自定义 Hooks
├── types/            # TypeScript 类型
├── utils/            # 工具函数
└── styles/           # 全局样式
```

## 脚本命令

```bash
npm run dev          # 启动开发服务器
npm run build        # 生产构建
npm run preview      # 预览生产版本
npm run lint         # ESLint 检查
npm run test         # 运行测试
```

## License

MIT
