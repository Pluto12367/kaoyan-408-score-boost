# 腾讯云轻量服务器部署手册（小规模体验）

这份手册是当前推荐的“小规模、10–20 人封闭体验”部署路径：使用一台腾讯云轻量应用服务器、Ubuntu、Docker 和暂时的公网 IP。它不是长期生产方案；公网 IP 的 HTTP 只用于封闭体验，不能重复使用管理员密码或真实敏感数据。

## 0. 准备与边界

购买腾讯云轻量应用服务器时选择：**Ubuntu LTS、至少 2 GB 内存、至少 50 GB 系统盘**。记下实例的公网 IPv4 地址和你自己办公网络的固定公网 IP（或公司 VPN 的 CIDR）。

在轻量应用服务器控制台打开“防火墙”，删除不需要的默认放通规则，只保留下列入站规则：

| 用途 | 协议 / 端口 | 来源 |
| --- | --- | --- |
| 网站访问 | TCP 80 | `0.0.0.0/0` |
| 服务器管理（SSH） | TCP 22 | **仅管理员公网 IP 或 CIDR**，例如 `203.0.113.8/32` |

不要开放 3000、5432、任何数据库端口或“全部 TCP”。腾讯云轻量防火墙默认规则可能向所有 IPv4 地址开放 22 和 80；请以控制台中的最终规则为准。规则说明和最小授权原则见腾讯云官方的[管理实例防火墙](https://cloud.tencent.com/document/product/1207/44577/)。

## 1. 登录服务器并安装 Docker

从你的电脑登录（把地址替换为服务器公网 IP）：

```sh
ssh ubuntu@服务器公网IP
```

按 [Docker 官方 Ubuntu 安装文档](https://docs.docker.com/engine/install/ubuntu/) 安装 Docker Engine 和 Docker Compose plugin。安装完成后，重新登录一次，然后确认：

```sh
docker --version
docker compose version
curl --version
```

三个命令都应输出版本号。请只跟随上述 Docker 官方文档，不要执行来源不明的一键安装脚本。

## 2. 上传代码与配置生产环境

推荐在服务器上使用 Git 克隆代码；如果你没有 Git 远程仓库，也可以从本机安全地上传完整项目目录。以下以 Git 为例：

```sh
git clone <你的仓库地址> kaoyan-408-score-boost
cd kaoyan-408-score-boost
cp deploy/tencent-ip/.env.production.example .env.production
chmod 600 .env.production
```

编辑 `.env.production`，将 `PUBLIC_IP` 改为这台服务器的实际公网 IPv4。必须替换 `POSTGRES_PASSWORD` 与 `JWT_SECRET` 的示例值；请勿把 `.env.production` 提交到 Git、发到群聊，或粘贴到工单中。

可在服务器上各执行一次下列命令生成候选随机值，再复制到编辑器中对应的等号右侧：

```sh
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
openssl rand -base64 48 | tr '+/' '-_' | tr -d '='
```

第一条可用作数据库密码，第二条可用作 JWT 密钥。生成后立即关闭终端滚屏共享；命令输出本身就是秘密。保存配置后，检查权限：

```sh
ls -l .env.production
```

权限应只允许当前管理员读取（通常是 `-rw-------`）。

## 3. 一键首次部署

在项目根目录执行：

```sh
chmod +x deploy/tencent-ip/deploy.sh deploy/tencent-ip/rollback.sh
./deploy/tencent-ip/deploy.sh
```

脚本会检查 Docker、Compose、配置文件与公网 IP，验证 Compose 配置。已有且健康的数据库会先生成备份；首次部署会明确跳过备份。随后脚本构建并启动服务，最多 60 秒检查 `http://127.0.0.1/health`，最后输出公网入口 `http://服务器公网IP` 与服务状态。

浏览器打开输出的地址，确认可以看到登录页。部署脚本不会删除数据库卷，也不会打印 `.env.production` 中的密钥。

## 4. 创建第一个管理员与学生体验

首次没有管理员账号时，在服务器的项目根目录运行下面命令。它把现有的账号创建脚本临时复制进正在运行的 `app` 容器；输入你自己的邮箱、显示名和独立的强密码。命令不要保存到 shell 历史，不要使用其他网站的密码。

```sh
read -rsp '输入管理员独立强密码：' admin_password; echo
app_container=$(docker compose --env-file .env.production -f compose.production.yml ps -q app)
docker cp scripts/user-provisioning.mjs "$app_container":/app/user-provisioning.mjs
docker cp scripts/create-teacher-user.mjs "$app_container":/app/create-first-admin.mjs
docker compose --env-file .env.production -f compose.production.yml exec app \
  node /app/create-first-admin.mjs --role admin \
  --email admin@example.com --name '系统管理员' --password "$admin_password"
unset admin_password
```

登录 `http://服务器公网IP` 后，进入管理员工作区的“邀请码管理”：填写批次名称、可用次数（封闭体验建议按实际人数）和过期时间，创建后**立即**复制完整邀请码。完整邀请码只显示一次。把邀请码发给受邀学生；学生在注册页输入邀请码、姓名、邮箱和自己的密码后，完成个人学习资料与题目练习。管理员应逐一确认学生能登录、能完成一次练习，并在管理员面板看到该学生。

体验期只邀请 10–20 人。这个 HTTP 阶段不应收集高敏感信息，也不要让管理员、教师或学生复用任何已有密码。

## 5. 日常状态、日志与升级

在项目根目录运行：

```sh
docker compose --env-file .env.production -f compose.production.yml ps
docker compose --env-file .env.production -f compose.production.yml logs --tail=200
curl -fsS http://127.0.0.1/health
```

升级前先获取并核对目标代码，再执行同一个部署脚本：

```sh
git fetch --all --tags
git switch <已审核的分支>
git pull --ff-only
./deploy/tencent-ip/deploy.sh
```

`docker compose up --wait` 会等待服务运行或健康；本项目还会额外请求网关健康端点。其行为见 Docker 官方 [`docker compose up`](https://docs.docker.com/reference/cli/docker/compose/up/) 文档。

## 6. 备份、定时备份与隔离恢复演练

手动备份：

```sh
docker compose --env-file .env.production -f compose.production.yml --profile tools run --rm backup
ls -lh backups/
```

安装每天 03:15 的定时备份（需要 root 权限）：

```sh
sudo ./deploy/tencent-ip/install-backup-cron.sh
sudo cat /etc/cron.d/kaoyan408-backup
```

选择一个备份文件进行隔离恢复演练；该命令会使用独立的临时数据库容器，不会恢复到正在使用的生产数据库：

```sh
./deploy/tencent-ip/verify-restore.sh backups/kaoyan408-YYYYMMDDTHHMMSSZ.dump
```

建议至少在首次部署后和每月各做一次恢复演练。备份文件应再复制到独立、受访问控制的位置；不要只保存在同一台服务器上。

## 7. 安全回滚

先找到已验证可用的 commit：

```sh
git log --oneline -10
```

确认项目目录没有未提交变更（`git status --short` 没有输出）后，执行：

```sh
./deploy/tencent-ip/rollback.sh <已验证的commit>
```

脚本会验证目标 commit、再次确认工作区干净、先备份数据库，记录当前 commit，切换到目标版本并重建。目标版本 60 秒内不健康时，它会自动切回原 commit 并重建原应用镜像；然后立刻查看日志：

```sh
docker compose --env-file .env.production -f compose.production.yml logs --tail=200
```

**重要：数据库迁移不会自动回滚。** 如果版本的数据库迁移不兼容，请停止继续操作，使用已验证备份进行单独的恢复评估；不要执行 `docker compose down -v`，它会删除数据卷。

Git 的 `switch --detach <commit>` 用于精确切换到历史 commit；官方说明见 [git-switch](https://git-scm.com/docs/git-switch)。

## 8. 服务器重启后的检查

服务器重启后重新登录，执行：

```sh
docker compose --env-file .env.production -f compose.production.yml ps
curl -fsS http://127.0.0.1/health
```

三个服务应为运行状态，PostgreSQL 和应用应健康；再用浏览器访问 `http://服务器公网IP`，用一个测试学生账号完成登录与练习。若服务未启动，先查第 5 节日志，再核对 Docker 服务是否已启用。

## 9. 从临时 HTTP 迁移到正式 HTTPS

当你拥有正式域名、完成必要备案并准备好 HTTPS 证书后，应先在测试环境验证域名、证书、反向代理和回调地址。随后把 `.env.production` 中的 `WEB_ORIGIN` 改为 `https://你的域名`，将 `ALLOW_INSECURE_HTTP_IP` 改为 `false`，并按新的 HTTPS 部署方案更新网关与防火墙。确认 HTTPS 健康检查和登录正常后再运行部署脚本。

不要在 HTTP 与 HTTPS 之间混用同一组账户密码；临时公网 IP 体验结束后，应撤销体验邀请码、关闭 HTTP 入口，并保留可验证的备份。
