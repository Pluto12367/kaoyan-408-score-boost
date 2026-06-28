# React + TypeScript + NestJS + PostgreSQL 渐进迁移路线

当前线上版本仍由根目录静态原型提供服务。新架构先并行放在 `apps/` 和 `packages/` 中，等关键功能验证稳定后再切换部署入口。

## 目录分层

- `apps/web`：React + TypeScript + Vite 学生端与后续后台前端。
- `apps/api`：NestJS API，先提供题库、知识点、练习记录、报告、诊断计划等接口。
- `packages/shared`：前后端共享领域类型与学习分析纯函数。
- `prisma/schema.prisma`：PostgreSQL 数据模型，覆盖用户、知识点、题目、练习记录、学习计划、AI 答疑日志。

## 迁移阶段

1. 架构并行：保留当前 GitHub Pages 静态原型，新增 React/NestJS/PostgreSQL 骨架。
2. 逻辑抽离：把诊断、计划、错因、报告算法迁入 `packages/shared`，前端和后端共用同一套规则。
3. 前端替换：先用 React 重做学生端核心闭环，再逐步迁移教师端和管理端。
4. 后端接入：NestJS 从内存数据切换到 Prisma + PostgreSQL，优先落地题库、练习记录、错题本。
5. 部署切换：前端部署到 Vercel/Netlify，后端部署到 Render/Fly.io/Railway，数据库使用 Supabase/Neon/Railway PostgreSQL。

## 本地启动目标

安装依赖后：

```bash
npm run dev:web
npm run dev:api
```

数据库准备：

```bash
cp .env.example .env
npm run prisma:generate -w apps/api
npm run prisma:migrate -w apps/api
```

正式编译：

```bash
npm run build:shared
npm run build:web
npm run build:api
```

## 切换原则

- 线上体验优先稳定，未完成的 React 版本不直接覆盖当前 Pages 页面。
- 新增功能优先写进共享领域模型，避免前后端各写一套规则。
- AI 答疑先只做解释、追问、相似题推荐，不作为唯一评分来源。
