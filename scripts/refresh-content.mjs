#!/usr/bin/env node
/**
 * Tech Radar · 内容刷新脚本
 *
 * 从 GitHub Search API 抓取各技术方向的活跃高星项目（真实元数据，不改写原文），
 * 合并编辑精选的一手技术文档 / 文章，生成 data/posts.json 供站点读取。
 *
 * 用法：
 *   node scripts/refresh-content.mjs
 *   GITHUB_TOKEN=ghp_xxx node scripts/refresh-content.mjs   # 限额提升至 30 次/分钟
 *
 * 匿名调用 GitHub Search API 限额为 10 次/分钟，脚本内置节流与重试。
 * 中文导读来自可选的 data/editorial.json，格式：{ "owner/repo": "一句话点评" }。
 * 内容只做「聚合 + 索引 + 导读」，不复制、不洗稿任何原文正文。
 *
 * 数据清洗说明：GitHub 搜索结果中存在大量近两年新建的刷星营销号，
 * 因此以「仓库创建时间」为主过滤器，辅以星数上限、黑名单与跨分类去重。
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT = path.join(DATA_DIR, 'posts.json');
const TOKEN = process.env.GITHUB_TOKEN || '';

// 刷星号几乎都是 2024 年之后新建；只保留此前创建的老项目
const CREATED_BEFORE = new Date('2024-06-01T00:00:00Z').getTime();
const MIN_STARS = 3000;
const MAX_STARS = 300000;

const CATEGORIES = [
  {
    id: 'frontend', name: '前端', en: 'Frontend', icon: 'layout', accent: '#38BDF8',
    desc: '框架、构建工具、浏览器与交互工程',
    query: 'topic:frontend stars:>15000 created:<2024-06-01 pushed:>2025-01-01',
  },
  {
    id: 'python', name: 'Python / 后端', en: 'Python & Backend', icon: 'server', accent: '#FBBF24',
    desc: 'Web 框架、数据工程与服务端生态',
    query: 'language:python stars:>30000 created:<2024-06-01 pushed:>2025-01-01',
  },
  {
    id: 'java', name: 'Java', en: 'Java', icon: 'coffee', accent: '#F97316',
    desc: 'JVM、Spring 生态与企业级开发',
    query: 'language:java stars:>15000 created:<2024-06-01 pushed:>2025-01-01',
  },
  {
    id: 'cpp', name: 'C / C++', en: 'C & C++', icon: 'cpu', accent: '#94A3B8',
    desc: '系统编程、性能与底层基础设施',
    query: 'language:cpp stars:>15000 created:<2024-06-01 pushed:>2025-01-01',
  },
  {
    id: 'llm', name: '大模型算法', en: 'LLM & Algorithms', icon: 'brain', accent: '#22C55E',
    desc: '训练、推理、微调与评测',
    query: 'topic:llm stars:>8000 created:<2024-06-01 pushed:>2025-01-01',
  },
  {
    id: 'agent', name: 'Agent 开发', en: 'Agent Engineering', icon: 'bot', accent: '#2DD4BF',
    desc: '工具调用、上下文工程与多智能体',
    query: 'topic:agent stars:>5000 created:<2024-06-01 pushed:>2025-01-01',
  },
  {
    id: 'infra', name: '云原生 / 基础设施', en: 'Cloud Native', icon: 'cloud', accent: '#60A5FA',
    desc: '容器、编排、可观测性与交付',
    query: 'topic:kubernetes stars:>8000 created:<2024-06-01 pushed:>2025-01-01',
  },
  {
    id: 'systems', name: '系统 / 数据库', en: 'Systems & Data', icon: 'database', accent: '#FACC15',
    desc: 'Rust / Go、存储引擎与分布式系统',
    query: 'language:rust stars:>12000 created:<2024-06-01 pushed:>2025-01-01',
  },
  {
    id: 'practice', name: '工程实践', en: 'Engineering', icon: 'wrench', accent: '#34D399',
    desc: '官方文档、方法论与深度长文',
    query: null,
  },
];

// 明确剔除的仓库（刷星、营销聚合号、与分类明显不符）
const BLOCKLIST = new Set([
  'Leonxlnx/taste-skill',
  'affaan-m/ECC',
  'NousResearch/hermes-agent',
  'DietrichGebert/ponytail',
  'ultraworkers/claw-code',
  'farion1231/cc-switch',
  'Panniantong/Agent-Reach',
  'career-ops-hq/career-ops',
  'hugohe3/ppt-master',
  'ZhuLinsen/daily_stock_analysis',
  'pbakaus/impeccable',
  'GitHubDaily/GitHubDaily',
  'thedaviddias/Front-End-Checklist',
  'MisterBooo/LeetCodeAnimation',
  'firecrawl/firecrawl',
  'shareAI-lab/learn-claude-code',
]);

// 描述中出现这些词的条目直接跳过（营销 / 与主题无关）
const NOISE_WORDS = /job search|stock analysis|ppt|powerpoint|leetcode|awesome-|checklist|interview questions/i;

// 编辑精选：稳定、权威的一手文档与文章（真实 URL，长期可访问）
const CURATED = [
  { title: 'MDN Web Docs', url: 'https://developer.mozilla.org/zh-CN/', source: 'Mozilla', category: 'frontend', tags: ['Web 标准', 'HTML', 'CSS'], note: '前端事实标准，查 API 语义与浏览器兼容性的第一站。' },
  { title: 'React 官方教程 · Learn React', url: 'https://react.dev/learn', source: 'React', category: 'frontend', tags: ['React', '组件', '状态'], note: '用官方心智模型重学 React，比二手教程少走很多弯路。' },
  { title: 'TypeScript Handbook', url: 'https://www.typescriptlang.org/docs/handbook/intro.html', source: 'Microsoft', category: 'frontend', tags: ['TypeScript', '类型系统'], note: '类型体操之前，先把官方 Handbook 的类型收窄与泛型讲透。' },
  { title: 'web.dev', url: 'https://web.dev/', source: 'Google', category: 'frontend', tags: ['性能', 'Web 平台'], note: 'Core Web Vitals 与现代 Web 能力的一手实践指南。' },

  { title: 'Python 官方教程（中文）', url: 'https://docs.python.org/zh-cn/3/tutorial/index.html', source: 'Python Software Foundation', category: 'python', tags: ['Python', '入门'], note: '语言特性以官方为准，避免被博客里的过时写法带偏。' },
  { title: 'FastAPI 官方文档', url: 'https://fastapi.tiangolo.com/zh/', source: 'FastAPI', category: 'python', tags: ['FastAPI', 'API', '异步'], note: '类型注解驱动的接口开发范式，Python 后端近年最值得读的文档。' },
  { title: 'Django 文档（中文）', url: 'https://docs.djangoproject.com/zh-hans/', source: 'Django', category: 'python', tags: ['Django', 'ORM', '全栈'], note: ' batteries-included 路线的完整参考，ORM 与 Admin 设计值得一读。' },

  { title: 'Spring Boot Reference', url: 'https://docs.spring.io/spring-boot/', source: 'VMware / Broadcom', category: 'java', tags: ['Spring Boot', '企业级'], note: '自动配置与条件装配的原始出处，排查 Bean 问题必查。' },
  { title: 'JVM Specification', url: 'https://docs.oracle.com/javase/specs/jvms/se21/html/', source: 'Oracle', category: 'java', tags: ['JVM', '字节码', '规范'], note: '类加载、内存区域、指令集的权威定义，面试追问的终点。' },
  { title: 'Apache Kafka 文档', url: 'https://kafka.apache.org/documentation/', source: 'Apache', category: 'java', tags: ['Kafka', '消息队列', '分布式'], note: '分区、副本与消费语义讲得最清楚的一份文档。' },

  { title: 'cppreference.com', url: 'https://en.cppreference.com/w/', source: 'C++ Community', category: 'cpp', tags: ['C++', '标准库', '参考'], note: '标准库语义与 C++11→C++23 特性差异的查询底本。' },
  { title: 'Standard C++ (isocpp.org)', url: 'https://isocpp.org/', source: 'ISO C++', category: 'cpp', tags: ['C++', '标准', '提案'], note: '跟进标准演进与 WG21 提案，判断哪些特性值得引入项目。' },
  { title: 'LLVM Documentation', url: 'https://llvm.org/docs/', source: 'LLVM', category: 'cpp', tags: ['LLVM', '编译器', 'IR'], note: '想理解编译器后端与 IR，这是绕不开的入口。' },

  { title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762', source: 'arXiv', category: 'llm', tags: ['Transformer', '论文'], note: '一切现代大模型的起点，值得逐段精读而不是只看解读。' },
  { title: 'Hugging Face Transformers 文档', url: 'https://huggingface.co/docs/transformers/index', source: 'Hugging Face', category: 'llm', tags: ['Transformers', '微调', '推理'], note: '模型加载、Tokenizer、Trainer 的工程事实标准。' },
  { title: 'vLLM 官方文档', url: 'https://docs.vllm.ai/', source: 'vLLM', category: 'llm', tags: ['推理', 'PagedAttention', '吞吐'], note: '生产环境做高吞吐推理，先看 PagedAttention 与调度策略。' },

  { title: 'Anthropic Engineering Blog', url: 'https://www.anthropic.com/engineering', source: 'Anthropic', category: 'agent', tags: ['Agent', '上下文工程', '工程'], note: 'Agent 设计时最值得追的一手工程复盘，尤其是上下文与工具设计。' },
  { title: 'Building Effective Agents', url: 'https://www.anthropic.com/engineering/building-effective-agents', source: 'Anthropic', category: 'agent', tags: ['Agent', '工作流', '架构'], note: '把「什么时候该用 Agent、什么时候用工作流」讲得很克制的一篇。' },
  { title: 'Model Context Protocol', url: 'https://modelcontextprotocol.io/', source: 'MCP', category: 'agent', tags: ['MCP', '工具协议'], note: '工具接入的事实协议，做 Agent 集成绕不开。' },
  { title: 'LangChain 官方文档', url: 'https://docs.langchain.com/', source: 'LangChain', category: 'agent', tags: ['LangChain', '编排'], note: 'Agent 编排与可观测性的组件清单，适合对照自己的实现查漏。' },

  { title: 'Kubernetes 中文文档', url: 'https://kubernetes.io/zh-cn/docs/home/', source: 'CNCF', category: 'infra', tags: ['Kubernetes', '编排'], note: '概念→任务→参考三层结构，排查调度与网络问题的依据。' },
  { title: 'Prometheus 官方文档', url: 'https://prometheus.io/docs/introduction/overview/', source: 'CNCF', category: 'infra', tags: ['监控', '指标', 'PromQL'], note: '指标体系与 PromQL 的权威定义，告警规则别靠抄。' },
  { title: 'Docker Docs', url: 'https://docs.docker.com/', source: 'Docker', category: 'infra', tags: ['容器', '镜像', '交付'], note: '镜像分层与构建缓存讲清楚，能省掉大量体积与CI时间。' },

  { title: 'PostgreSQL 官方文档', url: 'https://www.postgresql.org/docs/', source: 'PostgreSQL', category: 'systems', tags: ['PostgreSQL', '数据库'], note: '事务隔离、索引与执行计划的权威说明，别靠猜。' },
  { title: 'The Rust Programming Language', url: 'https://doc.rust-lang.org/book/', source: 'Rust', category: 'systems', tags: ['Rust', '所有权', '系统编程'], note: '所有权与生命周期的官方讲法，入门系统编程的必读书。' },
  { title: 'Redis Documentation', url: 'https://redis.io/docs/latest/', source: 'Redis', category: 'systems', tags: ['Redis', '缓存', '数据结构'], note: '数据结构与持久化取舍写得很直白，缓存设计前先读。' },

  { title: 'Google SRE Book（目录）', url: 'https://sre.google/sre-book/table-of-contents/', source: 'Google', category: 'practice', tags: ['SRE', '可靠性', 'SLO'], note: '把「稳定性」变成可度量工程实践的经典框架。' },
  { title: 'The Twelve-Factor App（中文）', url: 'https://12factor.net/zh_cn/', source: 'Heroku', category: 'practice', tags: ['架构', '配置', '交付'], note: '云原生应用设计的十二条基线，至今仍适合做架构评审清单。' },
  { title: 'Google Engineering Practices', url: 'https://google.github.io/eng-practices/', source: 'Google', category: 'practice', tags: ['Code Review', '工程规范'], note: '代码评审到底该看什么，这份文档给了可执行的尺度。' },
  { title: 'Refactoring Guru', url: 'https://refactoring.guru/', source: 'Refactoring Guru', category: 'practice', tags: ['重构', '设计模式'], note: '模式与坏味道配图解，适合当速查手册而不是通读。' },
  { title: 'CNCF Cloud Native Landscape', url: 'https://landscape.cncf.io/', source: 'CNCF', category: 'practice', tags: ['云原生', '技术选型'], note: '做技术选型时用它看清生态全貌，避免只盯着熟悉的那几个。' },
  { title: 'Designing Data-Intensive Applications', url: 'https://dataintensive.net/', source: 'Martin Kleppmann', category: 'practice', tags: ['数据系统', '分布式'], note: '把存储、复制、分区、一致性串成一条线的那本书。' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ghSearch(query, perPage = 12) {
  const url = 'https://api.github.com/search/repositories?q=' + encodeURIComponent(query) +
    `&sort=stars&order=desc&per_page=${perPage}`;
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'meetoffer-tech-radar',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 403 || res.status === 429) {
      await sleep(8000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    return json.items || [];
  }
  throw new Error('GitHub API 被限流，重试已耗尽（可设置 GITHUB_TOKEN 提升限额）');
}

function toRepoPost(r, cat) {
  return {
    id: 'gh-' + r.id,
    title: r.name,
    fullName: r.full_name,
    url: r.html_url,
    source: 'GitHub',
    sourceLabel: 'GitHub 开源项目',
    category: cat.id,
    tags: (r.topics || []).slice(0, 4),
    stars: r.stargazers_count,
    language: r.language || '—',
    description: r.description || '',
    updatedAt: r.pushed_at,
    createdAt: r.created_at,
    kind: 'repo',
    featured: false,
  };
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  let editorial = {};
  try {
    editorial = JSON.parse(await readFile(path.join(DATA_DIR, 'editorial.json'), 'utf8'));
  } catch { /* 可选文件 */ }

  const posts = [];
  const seen = new Set();

  for (const cat of CATEGORIES) {
    if (!cat.query) continue;
    process.stdout.write(`抓取 ${cat.name} ... `);
    try {
      const items = await ghSearch(cat.query);
      const cleaned = items
        .filter((r) => !r.archived && !r.fork && r.description)
        .filter((r) => !BLOCKLIST.has(r.full_name))
        .filter((r) => !NOISE_WORDS.test(r.description))
        .filter((r) => r.stargazers_count >= MIN_STARS && r.stargazers_count < MAX_STARS)
        .filter((r) => new Date(r.created_at).getTime() < CREATED_BEFORE)
        .filter((r) => !seen.has(r.full_name))
        .slice(0, 7);
      cleaned.forEach((r) => {
        seen.add(r.full_name);
        posts.push(toRepoPost(r, cat));
      });
      console.log(`${cleaned.length} 条`);
    } catch (e) {
      console.log(`失败：${e.message}`);
    }
    await sleep(TOKEN ? 400 : 1500); // 匿名 10 次/分钟
  }

  CURATED.forEach((c, i) => {
    posts.push({
      id: 'doc-' + String(i + 1).padStart(2, '0'),
      title: c.title,
      fullName: null,
      url: c.url,
      source: c.source,
      sourceLabel: '精选一手文档',
      category: c.category,
      tags: c.tags,
      stars: null,
      language: '文档',
      description: c.note,
      note: c.note,
      updatedAt: null,
      createdAt: null,
      kind: 'article',
      featured: false,
    });
  });

  // 人工策展层：中文导读 / 分类修正 / 剔除，统一来自 data/editorial.json
  // 值可为字符串（仅导读）或对象 { note, category, drop }
  const curated = posts.filter((p) => {
    const e = p.fullName ? editorial[p.fullName] : null;
    if (!e) return true;
    if (typeof e === 'string') { p.note = e; return true; }
    if (e.drop) return false;
    if (e.note) p.note = e.note;
    if (e.category) p.category = e.category;
    return true;
  });
  posts.length = 0;
  posts.push(...curated);

  // 每个分类 star 最高的一条设为精选
  for (const cat of CATEGORIES) {
    const top = posts
      .filter((p) => p.category === cat.id && p.kind === 'repo')
      .sort((a, b) => (b.stars || 0) - (a.stars || 0))[0];
    if (top) top.featured = true;
  }

  const payload = {
    site: 'MeetOffer Tech',
    generatedAt: new Date().toISOString(),
    source: 'GitHub Search API + 编辑精选（原文不改写，仅聚合与导读）',
    categories: CATEGORIES.map(({ query, ...c }) => c),
    total: posts.length,
    posts,
  };

  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`\n已生成 ${OUT}`);
  console.log(`共 ${posts.length} 条（仓库 ${posts.filter((p) => p.kind === 'repo').length} / 文档 ${posts.filter((p) => p.kind === 'article').length}）`);
  CATEGORIES.forEach((c) => {
    const n = posts.filter((p) => p.category === c.id).length;
    console.log(`  ${c.name.padEnd(18)} ${n} 条`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
