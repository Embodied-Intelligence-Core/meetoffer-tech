# MeetOffer Tech · 全技术雷达

一个覆盖全技术方向的中文技术情报站：聚合 GitHub 高星项目与权威一手技术文档，只做**筛选、归类、导读**，所有条目直达原始出处。站点带服务端密码门禁，当前为邀请制访问。

> 在线访问：<https://meetoffer-tech.app.workbuddy.host/?sharecode=NYXJCZXBZH>（计划绑定 `tech.meetoffer.cn`） · 代码开源：本仓库 · 内容来源：互联网公开资料

## 为什么做这个

技术信息太散：框架更新、论文、官方文档、工程博客散落在各处，二手解读又常常失真。这个站只解决一件事 —— 把值得读的一手来源收进一页，按方向索引，附一句中文导读，点击即达原文。不复制正文、不洗稿。

## 覆盖方向

| 方向 | 内容 |
| --- | --- |
| 前端 | React / Vite / TypeScript / 跨端 / 构建工具 |
| Python / 后端 | Web 框架、数据工程、工具链 |
| Java | JVM、Spring 生态、企业级项目 |
| C / C++ | 系统编程、引擎、高性能基础设施 |
| 大模型算法 | 训练、推理、微调、论文 |
| Agent 开发 | 工具调用、上下文工程、多智能体框架 |
| 云原生 / 基础设施 | 容器编排、网关、可观测性 |
| 系统 / 数据库 | Rust / 运行时 / 存储引擎 |
| 工程实践 | 官方文档、方法论、评审规范 |

## 特性

- **服务端密码门禁**：未验证时 `/api/posts` 直接返回 401，内容数据不下发（不是前端隐藏）。
- **内容不在静态目录**：`data/posts.json` 位于 `public/` 之外，无法通过 URL 直接读取。
- **明文密码不入库**：仓库只保存 SHA-256 哈希；会话签名密钥不落盘，默认每次启动随机生成。
- **可重复刷新**：一条命令重新抓取 GitHub 数据，内容不会停在写死的那天。
- **人工策展层**：中文导读、分类修正、异常条目剔除集中在 `data/editorial.json`。
- **零第三方依赖**：Node.js 原生 HTTP 服务 + 原生前端，无构建步骤。
- **设计系统**：遵循 [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) 的 `Developer Tool / IDE` 规则（Code dark + run green），SVG 图标、可见 focus、reduced-motion、4.5:1 对比度、375/768/1024/1440 响应式。

## 快速开始

要求 Node.js >= 18。

```bash
git clone https://github.com/Embodied-Intelligence-Core/meetoffer-tech.git
cd meetoffer-tech
cp config.example.json config.json   # 仓库不含真实 config.json
npm run password -- "你的访问密码"   # 只写入 SHA-256 哈希
npm start
```

打开 `http://localhost:3000`，输入刚设置的密码即可。

`config.json` 已在 `.gitignore` 中，访问密码的明文与哈希都不会进入仓库。随时可改密码：

```bash
npm run password -- "新密码"
npm start          # 重启后生效
```

该命令只把新密码的 SHA-256 哈希写入 `config.json`，明文不会写入任何文件。

### 环境变量（可选）

复制 `.env.example` 按需填写：

| 变量 | 说明 |
| --- | --- |
| `PORT` | 监听端口，默认 `3000`（部署平台通常自动注入） |
| `SESSION_SECRET` | 会话签名密钥。留空时每次启动随机生成（推荐，密钥不随仓库泄露） |
| `HTTPS` | 站点位于 HTTPS 之后时设为 `1`，为 cookie 加 `Secure` |
| `GITHUB_TOKEN` | 仅刷新内容时使用，可把 GitHub Search API 限额从 10 次/分钟提升到 30 次/分钟 |

## 刷新内容

```bash
npm run refresh
# 或带 token（更高限额）
GITHUB_TOKEN=ghp_xxx npm run refresh
```

脚本 `scripts/refresh-content.mjs` 会：

1. 按 8 个方向调用 GitHub Search API 抓取活跃高星仓库；
2. 清洗数据 —— 按**仓库创建时间**过滤近两年新建的刷星营销号，并做星数上限、黑名单、噪声词与跨分类去重；
3. 合并 `CURATED` 中的权威一手文档（官方文档、论文、规范）；
4. 应用 `data/editorial.json` 的人工导读与分类修正；
5. 生成 `data/posts.json`。

> 搜索结果里存在大量刷星账号，因此「创建时间早于 2024-06」是主要可信度过滤器。若某类条目偏少，可调整脚本中的 `CATEGORIES[].query` 或补充 `CURATED`。

## 目录结构

```
.
├── server.js                    # Node 原生 HTTP 服务 + 密码门禁
├── config.json                  # 站点名 + 密码哈希（无明文）
├── package.json
├── public/
│   ├── index.html               # 单页结构与内联 SVG 图标集
│   └── assets/
│       ├── style.css            # 设计系统与响应式
│       ├── app.js               # 门禁、筛选、搜索、排序
│       └── favicon.svg
├── data/
│   ├── posts.json               # 生成的内容数据（服务端读取，不公开暴露）
│   └── editorial.json           # 人工导读 / 分类修正 / 剔除
├── scripts/
│   ├── refresh-content.mjs      # 内容抓取与清洗
│   └── set-password.mjs         # 修改访问密码
├── .env.example
├── LICENSE                      # MIT
└── README.md
```

## 部署

服务监听 `process.env.PORT` 并绑定 `0.0.0.0`，可直接部署到任意单端口 Node 托管环境：

```bash
PORT=8080 npm start
```

自定义域名 `tech.meetoffer.cn` 只需在 DNS 处把该子域 CNAME 到托管平台提供的域名，并在平台绑定即可，代码无需改动。

> 安全边界说明：本项目是**访问控制**，不是内容加密。由于仓库开源，`data/posts.json` 本身是公开的；密码用于限制线上站点的访问入口。若需要真正保密内容，请将内容数据改为部署时注入且不提交到仓库。

## 内容规范

- 只做聚合、索引与导读，**不复制、不改写原文正文**。
- 每条内容都必须带可点击的原始出处链接。
- 仓库描述保留 GitHub 原文；中文内容来自 `editorial.json` 的人工策展。
- 新增来源优先选择官方文档、论文、规范与项目主仓库。

## License

[MIT](./LICENSE) © 2026 Embodied-Intelligence-Core
