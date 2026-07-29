# 邀请码与账号管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有邮箱密码认证上增加邀请码注册、学生账号停用、一次性临时密码和管理员后台管理。

**Architecture:** 邀请码、账号状态和管理审计进入 PostgreSQL；`AuthService.register()` 在单个事务中完成邀请码占用和账号创建。管理员接口继续使用现有 `RoleGuard`，前端沿用 `AdminWorkspace` 和 `useRoleWorkspaceData` 的资源加载模式。

**Tech Stack:** NestJS 10、Prisma 5、PostgreSQL、React 18、TypeScript 5、Node test runner、现有 scrypt/JWT 会话实现。

## Global Constraints

- 公开注册只能创建 `STUDENT`，教师和管理员仍由服务器端管理流程创建。
- 注册必须提交姓名、邮箱、8–128 位密码和有效邀请码。
- 邀请码校验、用户创建、兑换记录和使用次数增加必须在同一 PostgreSQL 事务中完成。
- 停用账号必须撤销全部刷新令牌，并拒绝后续登录和刷新。
- 一次性临时密码首次登录后必须修改。
- 不接入短信或邮件验证码，不记录明文密码、完整邀请码或令牌。
- 生产环境继续保持 `ALLOW_DEMO_AUTH=false`。
- 每个任务遵循测试先行；只暂存本任务列出的文件。

---

## File Structure

- `prisma/schema.prisma`：新增邀请码、兑换、账号状态、强制改密和审计事件模型。
- `prisma/migrations/20260729120000_invitation_accounts/migration.sql`：创建枚举、表、索引和现有用户默认状态。
- `apps/api/src/auth/password.ts`：集中导出密码校验、哈希和验证，供注册、登录和临时密码复用。
- `apps/api/src/auth/invitation-policy.ts`：无数据库依赖的邀请码状态判断。
- `apps/api/src/auth/invitation.service.ts`：邀请码生成、列表、停用和事务内兑换。
- `apps/api/src/auth/account-admin.service.ts`：账号停用、恢复和临时密码。
- `apps/api/src/auth/admin-accounts.controller.ts`：管理员邀请码与账号接口。
- `apps/api/src/auth/auth.service.ts`、`auth.controller.ts`、`auth.module.ts`：接入邀请码、账号状态和改密。
- `apps/api/src/operations/audit-event.service.ts`、`operations.module.ts`：记录业务级审计事件。
- `apps/web/src/features/auth/AccountPanel.tsx`、`apps/web/src/hooks/useAuth.ts`、`apps/web/src/api/endpoints/auth.ts`：邀请码注册与强制改密前端流程。
- `apps/web/src/features/admin/InvitationManagementPanel.tsx`：邀请码管理。
- `apps/web/src/features/admin/StudentAccountActions.tsx`：停用、恢复和临时密码操作。
- `apps/web/src/features/admin/AdminWorkspace.tsx`、`useAdminWorkspaceActions.ts`：组合新增面板和状态操作。
- `apps/web/src/api/types.ts`、`endpoints/dashboard.ts`、`hooks/useRoleWorkspaceData.ts`：管理接口类型和加载逻辑。
- `test/invitation-policy.test.js`、`test/invitation-api-contract.test.js`、`test/account-management-ui.test.js`：快速单元与静态契约测试。
- `scripts/integration-postgres.mjs`：真实 PostgreSQL 下的并发兑换、停用和临时密码验收。

### Task 1: 数据模型与密码模块

**Files:**
- Create: `prisma/migrations/20260729120000_invitation_accounts/migration.sql`
- Create: `apps/api/src/auth/password.ts`
- Create: `test/invitation-schema.test.js`
- Modify: `prisma/schema.prisma`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `scripts/user-provisioning.mjs`
- Test: `test/invitation-schema.test.js`
- Test: `test/user-provisioning.test.js`

**Interfaces:**
- Produces: `hashPassword(password: string): Promise<string>`
- Produces: `verifyPassword(password: string, stored: string): Promise<boolean>`
- Produces: `validatePassword(value?: string): string`
- Produces: Prisma models `InvitationCode`, `InvitationRedemption`, `AuditEvent`
- Produces: `User.accountStatus`, `User.mustChangePassword`

- [ ] **Step 1: 写失败的 schema 契约测试**

```js
// test/invitation-schema.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

test('schema stores invitation redemption and account lifecycle state', () => {
  assert.match(schema, /enum AccountStatus\s*\{[\s\S]*ACTIVE[\s\S]*DISABLED[\s\S]*\}/);
  assert.match(schema, /model InvitationCode\s*\{[\s\S]*codeHash\s+String\s+@unique/);
  assert.match(schema, /maxUses\s+Int/);
  assert.match(schema, /usedCount\s+Int\s+@default\(0\)/);
  assert.match(schema, /model InvitationRedemption\s*\{[\s\S]*@@unique\(\[invitationCodeId,\s*userId\]\)/);
  assert.match(schema, /accountStatus\s+AccountStatus\s+@default\(ACTIVE\)/);
  assert.match(schema, /mustChangePassword\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /model AuditEvent\s*\{/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/invitation-schema.test.js`

Expected: FAIL，提示缺少 `AccountStatus` 或 `InvitationCode`。

- [ ] **Step 3: 增加 Prisma 模型和迁移**

在 `schema.prisma` 中加入并建立关系：

```prisma
enum AccountStatus {
  ACTIVE
  DISABLED
}

model InvitationCode {
  id          String                 @id @default(cuid())
  codeHash    String                 @unique
  codePrefix  String
  label       String
  maxUses     Int
  usedCount   Int                    @default(0)
  startsAt    DateTime               @default(now())
  expiresAt   DateTime
  disabledAt  DateTime?
  createdById String
  createdAt   DateTime               @default(now())
  createdBy   User                   @relation("CreatedInvitations", fields: [createdById], references: [id])
  redemptions InvitationRedemption[]

  @@index([expiresAt, disabledAt])
}

model InvitationRedemption {
  id               String         @id @default(cuid())
  invitationCodeId String
  userId           String
  redeemedAt       DateTime       @default(now())
  invitationCode   InvitationCode @relation(fields: [invitationCodeId], references: [id], onDelete: Restrict)
  user             User           @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@unique([invitationCodeId, userId])
  @@index([userId])
}

model AuditEvent {
  id         String   @id @default(cuid())
  actorId    String?
  action     String
  targetType String
  targetId   String?
  result     String
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([createdAt])
  @@index([actorId, createdAt])
  @@index([action, createdAt])
}
```

向 `User` 增加 `accountStatus`、`mustChangePassword`、`createdInvitations` 和 `invitationRedemptions`。迁移 SQL 必须为现有用户写入 `ACTIVE/false`，再设置非空约束。

- [ ] **Step 4: 抽取密码函数并复用**

```ts
// apps/api/src/auth/password.ts
import { BadRequestException } from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export function validatePassword(value?: string) {
  if (!value || value.length < 8 || value.length > 128) {
    throw new BadRequestException('密码长度必须为 8–128 位');
  }
  return value;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, saltValue, hashValue] = stored.split('$');
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```

从 `auth.service.ts` 删除重复私有实现；`scripts/user-provisioning.mjs` 保持输出格式兼容。

- [ ] **Step 5: 生成 Prisma Client 并运行测试**

Run: `npx prisma generate --schema prisma/schema.prisma`

Expected: exit 0。

Run: `node --test test/invitation-schema.test.js test/user-provisioning.test.js`

Expected: 所有测试 PASS。

- [ ] **Step 6: 提交**

```bash
git add prisma/schema.prisma prisma/migrations/20260729120000_invitation_accounts/migration.sql apps/api/src/auth/password.ts apps/api/src/auth/auth.service.ts scripts/user-provisioning.mjs test/invitation-schema.test.js test/user-provisioning.test.js package-lock.json
git commit -m "feat: add invitation and account lifecycle schema"
```

### Task 2: 邀请码策略、服务和事务注册

**Files:**
- Create: `apps/api/src/auth/invitation-policy.ts`
- Create: `apps/api/src/auth/invitation.service.ts`
- Create: `apps/api/src/auth/dto/register-account.dto.ts`
- Create: `test/invitation-policy.test.js`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Test: `test/invitation-policy.test.js`
- Test: `scripts/integration-postgres.mjs`

**Interfaces:**
- Consumes: `hashPassword()` and `validatePassword()` from Task 1
- Produces: `InvitationService.create(input, actorId): Promise<CreatedInvitation>`
- Produces: `InvitationService.registerStudent(input): Promise<User>`
- Produces: `RegisterAccountDto { inviteCode; email; password; name }`
- Produces: `POST /auth/register` requiring `inviteCode`

- [ ] **Step 1: 写失败的邀请码状态测试**

```js
// test/invitation-policy.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');
const { invitationAvailability } = require('../apps/api/src/auth/invitation-policy.ts');

const now = new Date('2026-07-29T10:00:00.000Z');

test('invitationAvailability rejects disabled, expired and exhausted codes', () => {
  assert.equal(invitationAvailability({ disabledAt: now, startsAt: now, expiresAt: new Date('2026-07-30'), usedCount: 0, maxUses: 1 }, now), 'disabled');
  assert.equal(invitationAvailability({ disabledAt: null, startsAt: now, expiresAt: new Date('2026-07-29T09:00:00Z'), usedCount: 0, maxUses: 1 }, now), 'expired');
  assert.equal(invitationAvailability({ disabledAt: null, startsAt: now, expiresAt: new Date('2026-07-30'), usedCount: 1, maxUses: 1 }, now), 'exhausted');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/invitation-policy.test.js`

Expected: FAIL，提示找不到 `invitation-policy.ts`。

- [ ] **Step 3: 实现纯策略和安全码处理**

```ts
export type InvitationAvailability = 'available' | 'not_started' | 'expired' | 'disabled' | 'exhausted';

export function invitationAvailability(
  code: { disabledAt: Date | null; startsAt: Date; expiresAt: Date; usedCount: number; maxUses: number },
  now = new Date(),
): InvitationAvailability {
  if (code.disabledAt) return 'disabled';
  if (code.startsAt > now) return 'not_started';
  if (code.expiresAt <= now) return 'expired';
  if (code.usedCount >= code.maxUses) return 'exhausted';
  return 'available';
}
```

`InvitationService` 使用 `randomBytes(18).toString('base64url')` 生成明文码，仅在创建响应中返回一次；数据库只存 `HMAC-SHA256` 哈希和前 6 位前缀。

- [ ] **Step 4: 配置全局与认证端点限流**

Run: `npm install @nestjs/throttler -w apps/api`

Expected: package files update，exit 0。

在 `AppModule` 注册 `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])` 和全局 `ThrottlerGuard`。在 `AuthController` 覆盖敏感端点：

```ts
@Post('register')
@Throttle({ default: { ttl: 60_000, limit: 5 } })
register(@Body() input: RegisterAccountDto) {
  return this.authService.register(input);
}

@Post('login')
@Throttle({ default: { ttl: 60_000, limit: 10 } })
login(@Body() input: LoginAccountDto) {
  return this.authService.login(input);
}
```

- [ ] **Step 5: 实现事务注册**

```ts
async registerStudent(input: RegisterAccountDto) {
  const normalized = {
    email: normalizeEmail(input.email),
    name: validateName(input.name),
    password: validatePassword(input.password),
    codeHash: this.hashCode(input.inviteCode),
  };

  const passwordHash = await hashPassword(normalized.password);
  return this.prisma.$transaction(async (tx) => {
    const invitation = await tx.invitationCode.findUnique({ where: { codeHash: normalized.codeHash } });
    if (!invitation || invitationAvailability(invitation) !== 'available') {
      throw new BadRequestException('邀请码无效、已过期或已用完');
    }
    const claimed = await tx.invitationCode.updateMany({
      where: {
        id: invitation.id,
        disabledAt: null,
        startsAt: { lte: new Date() },
        expiresAt: { gt: new Date() },
        usedCount: { lt: invitation.maxUses },
      },
      data: { usedCount: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new BadRequestException('邀请码已用完，请联系管理员');
    const user = await tx.user.create({
      data: {
        email: normalized.email,
        name: normalized.name,
        passwordHash,
        role: 'STUDENT',
        accountStatus: 'ACTIVE',
        invitationRedemptions: { create: { invitationCodeId: invitation.id } },
      },
    });
    return user;
  }, { isolationLevel: 'Serializable' });
}
```

`AuthService.register()` 调用该服务后继续复用 `createSession()`。Prisma 唯一邮箱异常必须映射为“邮箱已注册”，且整个事务回滚邀请码计数。

- [ ] **Step 6: 扩展真实 PostgreSQL 集成场景**

在 `scripts/integration-postgres.mjs` 中：

```js
const invite = await createInvitationAsAdmin({ maxUses: 1 });
const attempts = await Promise.allSettled([
  registerWithInvite(invite.code, 'invite-a@example.com'),
  registerWithInvite(invite.code, 'invite-b@example.com'),
]);
ensure(attempts.filter((item) => item.status === 'fulfilled').length === 1, 'one-use invitation must create exactly one account');
const stored = await prisma.invitationCode.findUnique({ where: { id: invite.id } });
ensure(stored.usedCount === 1, 'invitation count must remain one');
```

- [ ] **Step 7: 运行测试**

Run: `node --test test/invitation-policy.test.js`

Expected: PASS。

Run: `npm run build:api`

Expected: exit 0。

Run: `npm run test:integration:postgres`

Expected: 并发单次邀请码仅成功一个注册，全部现有集成场景继续 PASS。

- [ ] **Step 8: 提交**

```bash
git add apps/api/package.json package-lock.json apps/api/src/app.module.ts apps/api/src/auth/invitation-policy.ts apps/api/src/auth/invitation.service.ts apps/api/src/auth/dto/register-account.dto.ts apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.module.ts test/invitation-policy.test.js scripts/integration-postgres.mjs
git commit -m "feat: require invitations for student registration"
```

### Task 3: 业务审计与管理员邀请码 API

**Files:**
- Create: `apps/api/src/operations/audit-event.service.ts`
- Create: `apps/api/src/auth/admin-accounts.controller.ts`
- Create: `apps/api/src/auth/dto/create-invitation.dto.ts`
- Create: `test/invitation-api-contract.test.js`
- Modify: `apps/api/src/operations/operations.module.ts`
- Modify: `apps/api/src/auth/invitation.service.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Test: `test/invitation-api-contract.test.js`

**Interfaces:**
- Produces: `AuditEventService.record(input: AuditEventInput): Promise<void>`
- Produces: `GET /admin/invitations`
- Produces: `POST /admin/invitations`
- Produces: `POST /admin/invitations/:invitationId/disable`
- Produces: responses that expose `code` only from create, never from list

- [ ] **Step 1: 写失败的接口契约测试**

```js
test('admin invitation controller is admin-only and never lists full codes', async () => {
  const source = await readFile(new URL('../apps/api/src/auth/admin-accounts.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /@Controller\('admin'\)/);
  assert.match(source, /@UseGuards\(RoleGuard\)/);
  assert.match(source, /@Roles\('admin'\)/);
  assert.match(source, /@Get\('invitations'\)/);
  assert.match(source, /@Post\('invitations'\)/);
  assert.match(source, /@Post\('invitations\/:invitationId\/disable'\)/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/invitation-api-contract.test.js`

Expected: FAIL，文件不存在。

- [ ] **Step 3: 实现审计服务**

```ts
export type AuditAction =
  | 'invitation.create'
  | 'invitation.disable'
  | 'invitation.redeem'
  | 'account.disable'
  | 'account.restore'
  | 'account.temporary_password'
  | 'account.create_managed'
  | 'question_import.preview'
  | 'question_import.confirm'
  | 'question_import.disable';

export interface AuditEventInput {
  actorId?: string;
  action: AuditAction;
  targetType: 'invitation' | 'user' | 'question_import';
  targetId?: string;
  result: 'success' | 'rejected' | 'failed';
  metadata?: Record<string, string | number | boolean>;
}

async record(input: AuditEventInput) {
  await this.prisma.auditEvent.create({ data: input });
}
```

邀请码审计元数据只记录批次名、最大次数和码前缀；不得记录明文邀请码。

- [ ] **Step 4: 实现管理员 Controller**

```ts
@Controller('admin')
@UseGuards(RoleGuard)
@Roles('admin')
export class AdminAccountsController {
  constructor(
    private readonly invitations: InvitationService,
    private readonly accounts: AccountAdminService,
  ) {}

  @Get('invitations')
  listInvitations() {
    return this.invitations.list();
  }

  @Post('invitations')
  createInvitation(@CurrentUser() user: UserProfile, @Body() input: CreateInvitationDto) {
    return this.invitations.create(input, user.id);
  }

  @Post('invitations/:invitationId/disable')
  disableInvitation(@CurrentUser() user: UserProfile, @Param('invitationId') id: string) {
    return this.invitations.disable(id, user.id);
  }
}
```

- [ ] **Step 5: 运行测试和构建**

Run: `node --test test/invitation-api-contract.test.js`

Expected: PASS。

Run: `npm run build:api`

Expected: exit 0。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/operations/audit-event.service.ts apps/api/src/operations/operations.module.ts apps/api/src/auth/admin-accounts.controller.ts apps/api/src/auth/dto/create-invitation.dto.ts apps/api/src/auth/invitation.service.ts apps/api/src/auth/auth.module.ts test/invitation-api-contract.test.js
git commit -m "feat: add admin invitation management API"
```

### Task 4: 账号停用、临时密码和强制改密

**Files:**
- Create: `apps/api/src/auth/account-admin.service.ts`
- Create: `apps/api/src/auth/dto/change-password.dto.ts`
- Create: `apps/api/src/auth/dto/create-managed-user.dto.ts`
- Modify: `apps/api/src/auth/admin-accounts.controller.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/role.guard.ts`
- Modify: `apps/api/src/study/admin-user.repository.ts`
- Modify: `packages/shared/src/domain.ts`
- Modify: `apps/web/src/api/types.ts`
- Modify: `scripts/integration-postgres.mjs`
- Test: `scripts/integration-postgres.mjs`

**Interfaces:**
- Produces: `POST /admin/users/:userId/disable`
- Produces: `POST /admin/users/:userId/restore`
- Produces: `POST /admin/users/:userId/temporary-password`
- Produces: `POST /admin/users` for `teacher` or `admin`
- Produces: `POST /auth/change-password`
- Produces: `UserProfile.mustChangePassword?: boolean`

- [ ] **Step 1: 先加入失败的集成断言**

```js
const disabled = await adminRequest(`/admin/users/${student.id}/disable`, { method: 'POST' });
ensure(disabled.accountStatus === 'disabled', 'admin must disable the student');
ensure((await login(student.email, student.password)).status === 403, 'disabled student login must be rejected');
ensure((await refresh(student.refreshToken)).status === 401, 'disabled student refresh token must be revoked');
```

- [ ] **Step 2: 运行集成测试确认失败**

Run: `npm run test:integration:postgres`

Expected: FAIL，管理员停用接口返回 404。

- [ ] **Step 3: 实现账号管理事务**

```ts
async disable(userId: string, actorId: string) {
  return this.prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { accountStatus: 'DISABLED' },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditEvent.create({
      data: { actorId, action: 'account.disable', targetType: 'user', targetId: userId, result: 'success' },
    });
    return user;
  });
}
```

`restore()` 只恢复 `ACTIVE`，不自动恢复旧会话。`createTemporaryPassword()` 生成至少 16 位随机密码、保存哈希、设置 `mustChangePassword=true` 并撤销旧令牌；明文临时密码只在本次响应返回。

`createManagedUser()` 只接受 `role: 'teacher' | 'admin'`，生成一次性临时密码并设置 `mustChangePassword=true`。学生必须继续通过邀请码注册，管理员接口不得绕过该规则：

```ts
async createManagedUser(input: CreateManagedUserDto, actorId: string) {
  if (input.role !== 'teacher' && input.role !== 'admin') {
    throw new BadRequestException('学生账号必须通过邀请码注册');
  }
  const temporaryPassword = generateTemporaryPassword();
  const user = await this.prisma.user.create({
    data: {
      email: normalizeEmail(input.email),
      name: validateName(input.name),
      role: input.role === 'teacher' ? 'TEACHER' : 'ADMIN',
      passwordHash: await hashPassword(temporaryPassword),
      accountStatus: 'ACTIVE',
      mustChangePassword: true,
    },
  });
  await this.audit.record({
    actorId,
    action: 'account.create_managed',
    targetType: 'user',
    targetId: user.id,
    result: 'success',
    metadata: { role: input.role },
  });
  return { user: toManagedUser(user), temporaryPassword };
}
```

- [ ] **Step 4: 在认证链路强制账号状态**

`login()`、`refresh()` 和 `requireRole()` 均检查 `accountStatus`。访问令牌加入随机 `sessionVersion` 会扩大本阶段范围，因此停用即时生效通过 `RoleGuard` 查询当前用户状态实现。`packages/shared/src/domain.ts` 的 `UserProfile` 增加 `accountStatus?: 'active' | 'disabled'` 和 `mustChangePassword?: boolean`：

```ts
async assertActiveUser(userId: string) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { accountStatus: true, mustChangePassword: true },
  });
  if (!user || user.accountStatus !== 'ACTIVE') throw new ForbiddenException('账号已停用');
  return user;
}
```

把 `RoleGuard.canActivate()` 改为 `async`，验证 JWT 后调用 `assertActiveUser()`。若 `mustChangePassword=true`，仅允许 `/auth/change-password` 和 `/auth/logout`；其他接口返回 403 和稳定错误码 `PASSWORD_CHANGE_REQUIRED`。

- [ ] **Step 5: 实现改密**

```ts
@Post('change-password')
@UseGuards(RoleGuard)
@Roles('student', 'teacher', 'admin')
changePassword(@CurrentUser() user: UserProfile, @Body() input: ChangePasswordDto) {
  return this.authService.changePassword(user.id, input.currentPassword, input.newPassword);
}
```

更新密码、清除 `mustChangePassword` 并撤销其他刷新令牌，当前请求返回新的完整会话。

- [ ] **Step 6: 运行集成测试与构建**

Run: `npm run test:integration:postgres`

Expected: 停用、恢复、临时密码、强制改密和原有学习链路全部 PASS。

Run: `npm run build:api`

Expected: exit 0。

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/auth/account-admin.service.ts apps/api/src/auth/dto/change-password.dto.ts apps/api/src/auth/dto/create-managed-user.dto.ts apps/api/src/auth/admin-accounts.controller.ts apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.service.ts apps/api/src/auth/role.guard.ts apps/api/src/study/admin-user.repository.ts packages/shared/src/domain.ts apps/web/src/api/types.ts scripts/integration-postgres.mjs
git commit -m "feat: manage student account lifecycle"
```

### Task 5: 注册、邀请码和学生账号前端

**Files:**
- Create: `apps/web/src/features/admin/InvitationManagementPanel.tsx`
- Create: `apps/web/src/features/admin/StudentAccountActions.tsx`
- Create: `apps/web/src/features/admin/ManagedUserCreationPanel.tsx`
- Create: `test/account-management-ui.test.js`
- Modify: `apps/web/src/features/auth/AccountPanel.tsx`
- Modify: `apps/web/src/hooks/useAuth.ts`
- Modify: `apps/web/src/features/admin/AdminWorkspace.tsx`
- Modify: `apps/web/src/features/admin/useAdminWorkspaceActions.ts`
- Modify: `apps/web/src/hooks/useRoleWorkspaceData.ts`
- Modify: `apps/web/src/api/endpoints/auth.ts`
- Modify: `apps/web/src/api/endpoints/dashboard.ts`
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/api/index.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `test/account-management-ui.test.js`

**Interfaces:**
- Consumes: Task 3/4 管理 API
- Produces: `InvitationList`, `CreatedInvitation`, `AdminManagedUser.accountStatus`
- Produces: 注册表单字段 `inviteCode`

- [ ] **Step 1: 写失败的 UI 契约测试**

```js
test('registration UI requires invitation code and admin UI exposes invitation management', async () => {
  const account = await readFile(new URL('../apps/web/src/features/auth/AccountPanel.tsx', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../apps/web/src/features/admin/AdminWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(account, /name="inviteCode"/);
  assert.match(account, /邀请码/);
  assert.match(admin, /InvitationManagementPanel/);
  assert.match(admin, /StudentAccountActions/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/account-management-ui.test.js`

Expected: FAIL，注册表单没有 `inviteCode`。

- [ ] **Step 3: 接入注册和强制改密**

```ts
export async function registerAccount(input: {
  inviteCode: string;
  email: string;
  password: string;
  name: string;
}): Promise<AuthSession> {
  return requestAuthSession('/auth/register', input);
}
```

`AccountPanel` 注册模式增加邀请码和确认密码；`useAuth` 在客户端先校验两次密码一致。会话返回 `mustChangePassword` 时显示独立改密表单，不加载角色工作区数据。

- [ ] **Step 4: 增加管理类型和请求函数**

```ts
export interface AdminInvitation {
  id: string;
  codePrefix: string;
  label: string;
  maxUses: number;
  usedCount: number;
  startsAt: string;
  expiresAt: string;
  disabledAt?: string;
  status: 'active' | 'not_started' | 'expired' | 'disabled' | 'exhausted';
}

export interface CreatedInvitation extends AdminInvitation {
  code: string;
}
```

新增 `fetchAdminInvitations()`、`createAdminInvitation()`、`disableAdminInvitation()`、`disableAdminUser()`、`restoreAdminUser()` 和 `createTemporaryPassword()`，全部使用 `authenticatedFetch`。

- [ ] **Step 5: 实现管理员面板**

`InvitationManagementPanel` 提供批次名、过期时间和最大次数表单。创建成功后用只读区域显示一次完整邀请码，并提供 `navigator.clipboard.writeText()` 复制按钮；列表只显示前缀。

`StudentAccountActions`：

```tsx
<button type="button" onClick={() => onSetStatus(user.id, user.accountStatus === 'active' ? 'disabled' : 'active')}>
  {user.accountStatus === 'active' ? '停用账号' : '恢复账号'}
</button>
<button type="button" onClick={() => onCreateTemporaryPassword(user.id)}>
  生成临时密码
</button>
```

临时密码和完整邀请码都只保存在组件内存；关闭结果提示后立即丢弃。

`ManagedUserCreationPanel` 只提供“教师”和“管理员”角色选项，提交姓名和邮箱后显示一次性临时密码；不提供“学生”选项。

- [ ] **Step 6: 运行 UI 测试和构建**

Run: `node --test test/account-management-ui.test.js test/auth-gate-ui.test.js`

Expected: PASS。

Run: `npm run build:web`

Expected: TypeScript 和 Vite 构建 exit 0。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/features/admin/InvitationManagementPanel.tsx apps/web/src/features/admin/StudentAccountActions.tsx apps/web/src/features/admin/ManagedUserCreationPanel.tsx apps/web/src/features/auth/AccountPanel.tsx apps/web/src/hooks/useAuth.ts apps/web/src/features/admin/AdminWorkspace.tsx apps/web/src/features/admin/useAdminWorkspaceActions.ts apps/web/src/hooks/useRoleWorkspaceData.ts apps/web/src/api/endpoints/auth.ts apps/web/src/api/endpoints/dashboard.ts apps/web/src/api/types.ts apps/web/src/api/index.ts apps/web/src/App.tsx apps/web/src/styles.css test/account-management-ui.test.js
git commit -m "feat: add invitation and account management UI"
```

### Task 6: 完整验收与操作文档

**Files:**
- Create: `docs/admin/invitations-and-accounts.md`
- Modify: `scripts/staging-smoke.mjs`
- Modify: `test/staging-smoke.test.js`
- Modify: `docs/staging-smoke.md`
- Test: `test/staging-smoke.test.js`

**Interfaces:**
- Consumes: Tasks 1–5
- Produces: 邀请注册、停用和恢复的可重复冒烟流程

- [ ] **Step 1: 先更新失败的冒烟测试**

```js
test('staging smoke requires an invitation for first registration', async () => {
  const result = await runStagingSmoke(config, {
    fetchImpl,
    invitationCode: 'SMOKE-INVITATION',
    log: () => {},
  });
  assert.equal(result.checks >= 10, true);
  assert.equal(calls.some((call) => call.body?.includes('SMOKE-INVITATION')), true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/staging-smoke.test.js`

Expected: FAIL，冒烟注册请求未提交邀请码。

- [ ] **Step 3: 更新冒烟脚本和文档**

新增必需环境变量 `STAGING_SMOKE_INVITATION`。冒烟路径验证：

1. 无邀请码注册返回 400。
2. 有效邀请码注册或既有账号登录成功。
3. 学生完成 onboarding 和任务。
4. 登出重登后数据仍在。
5. 演示登录保持禁用。

管理员操作文档写清楚“创建、复制、停用邀请码”“停用/恢复学生”“临时密码必须改密”三条路径，并标注完整邀请码和临时密码只显示一次。

- [ ] **Step 4: 运行完整验证**

Run: `npm test`

Expected: 全部 Node tests PASS。

Run: `npm run build:api`

Expected: exit 0。

Run: `npm run build:web`

Expected: exit 0。

Run: `npm run test:integration:postgres`

Expected: 邀请、并发兑换、账号状态、学习数据持久化全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add docs/admin/invitations-and-accounts.md docs/staging-smoke.md scripts/staging-smoke.mjs test/staging-smoke.test.js
git commit -m "docs: verify invitation account workflow"
```
