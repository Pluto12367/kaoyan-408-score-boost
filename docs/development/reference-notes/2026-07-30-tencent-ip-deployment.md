# Tencent Cloud public-IP pilot reference check

## Task

- Feature: production environment validation for a temporary public-IP HTTP pilot.
- Files: environment validator, API bootstrap validation, production example, and environment tests.

## References reviewed

| Source | Link | Useful pattern | Adopted? |
| --- | --- | --- | --- |
| Docker Compose startup order | https://docs.docker.com/compose/how-tos/startup-order/ | A dependent service can wait for a database health check using `depends_on` with `service_healthy`; a running container is not necessarily ready. | Yes: keep database readiness checks as the deployment health-gate pattern. |
| NGINX reverse proxy | https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy | Route a scoped location to an internal upstream and forward the request through the proxy, keeping the application service behind the proxy boundary. | Yes: retain the same-origin `/api` route as the only API path in the HTTP pilot. |
| NGINX `proxy_pass` directive | https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass | When `proxy_pass` includes a URI, that URI replaces the normalized request portion matching the location. | Yes: use `location /api/` with `proxy_pass http://app:3000/` so the upstream receives the path without the browser-only `/api` prefix. |
| Docker multi-stage builds | https://docs.docker.com/build/building/multi-stage/ | Name build stages and copy only generated artifacts into a separate runtime image. | Yes: build Vite assets in Node and copy only `apps/web/dist` plus the Nginx configuration into the final Nginx image. |
| Docker Official Image: postgres | https://hub.docker.com/_/postgres | Configure the official image through documented environment variables and preserve database data with the documented volume location; do not expose it publicly. | Yes: keep PostgreSQL on the internal Docker network with its existing environment-driven configuration. |
| OWASP Transport Layer Security Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html | Use TLS for all public pages and APIs; any HTTP exception needs a strictly limited, temporary boundary. | Yes: HTTPS remains required by default; the exception is opt-in and narrowly validated. |

## Adopted deployment and validation boundaries

- Health checks: deployment services should use health checks and wait for database readiness before dependent services start.
- Internal network: the API-to-PostgreSQL path remains internal; the public edge handles the browser-facing route.
- Environment variables: retain explicit production values, reject placeholders, and keep `ALLOW_DEMO_AUTH=false` outside development.
- Temporary HTTP exception: only `ALLOW_INSECURE_HTTP_IP=true` with a root `http://` IPv4 `WEB_ORIGIN` and same-origin `VITE_API_BASE_URL=/api` is valid. HTTP domains, paths, query strings, fragments, other API paths, and every configuration without the explicit flag remain rejected.

No external source code is copied; these patterns are reimplemented in this repository's validators.

## Task 3 production Compose topology addendum

| Source | Link | Useful pattern | Adopted? |
| --- | --- | --- | --- |
| Docker Compose startup order | https://docs.docker.com/compose/how-tos/startup-order/ | `depends_on.condition: service_healthy` waits for a declared health check, while ordinary startup order only waits until a container runs. | Yes: `app` waits for PostgreSQL and `gateway` waits for the app health check. |
| PostgreSQL Docker Official Image | https://hub.docker.com/_/postgres | For PostgreSQL 17 and earlier, mount persistent data at `/var/lib/postgresql/data`; the official image's initialization variables only apply to a fresh data directory. | Yes: PostgreSQL 16 uses the named `postgres_data` volume at that exact path and its documented initialization variables. |

The topology exposes only the gateway on host port 80. The application and database remain on Compose's internal network. No source code was copied; the documented configuration patterns are reimplemented for this repository.

## Task 4 backup and isolated restore drill addendum

| Source | Link | Useful pattern | Adopted? |
| --- | --- | --- | --- |
| PostgreSQL 16 `pg_dump` | https://www.postgresql.org/docs/16/app-pgdump.html | The custom (`-Fc`) archive format is compressed by default and is designed as input to `pg_restore`; standard `PG*` environment variables supply connection settings. | Yes: write timestamped custom-format archives from the one-off tools container and fail if the archive is empty. |
| PostgreSQL 16 `pg_restore` | https://www.postgresql.org/docs/16/app-pgrestore.html | Restore custom archives to a separately selected target database, stopping on restore errors with `--exit-on-error`. | Yes: restore only into a unique temporary PostgreSQL container, never through the production Compose database. |
| Docker Compose profiles and `run` | https://docs.docker.com/compose/how-tos/profiles/ | Profiled services are opt-in, and explicitly targeting a profiled service is appropriate for one-off administrative tools. | Yes: the backup service is confined to the `tools` profile and is invoked with `docker compose ... run --rm backup`. |
| Linux `crontab(5)` | https://man7.org/linux/man-pages/man5/crontab.5.html | `/etc/cron.d` entries are system jobs and include an explicit user field after the schedule. | Yes: install a root-owned `03:15` job with an absolute working directory, an explicit `root` field, an append-only backup log, and mode `0644`. |

The drill deliberately uses a separate Docker network and a unique temporary container name. It validates restored Prisma tables with `psql`; cleanup is bound to `EXIT` so no restore target survives either success or failure. No external source code is copied; these documented patterns are reimplemented in this repository.

## Task 5 deployment, upgrade, and rollback addendum

| Source | Link | Useful pattern | Adopted? |
| --- | --- | --- | --- |
| Docker Compose `up` command | https://docs.docker.com/reference/cli/docker/compose/up/ | `--wait` waits for running or healthy services and `--build` builds images before startup; existing containers are recreated while mounted volumes are preserved. | Yes: validate the rendered Compose model, then run `up -d --build --wait` and independently poll the gateway health endpoint. |
| Docker Engine on Ubuntu | https://docs.docker.com/engine/install/ubuntu/ | Install Docker Engine and the Compose plugin from Docker's official Ubuntu instructions, rather than an unverified curl installer. | Yes: the operator guide links to this official installation entry point and checks both Docker and Compose before deployment. |
| Tencent Cloud Lighthouse firewall | https://cloud.tencent.com/document/product/1207/44577/ | Lighthouse firewall rules control inbound traffic; default public sources are broad, so rules should use least privilege and allow a single address or CIDR where possible. | Yes: expose only TCP 80 publicly and limit TCP 22 to the administrator IP/CIDR; do not expose database or application ports. |
| Git `switch` | https://git-scm.com/docs/git-switch | `git switch --detach <commit>` inspects an exact commit; switching can discard changes if forced, so a safe rollback must reject a dirty worktree and verify the target first. | Yes: rollback records the current commit, switches only after clean-tree and commit checks, and restores that recorded commit if rebuilding or health checks fail. |

The rollback workflow deliberately does not run a destructive volume command and does not attempt to reverse database migrations. A database backup precedes both deployment and rollback when the production database is healthy. No external source code is copied; command sequencing is reimplemented for this repository's Compose topology.

## Task 5 fix round 1 addendum

| Source | Link | Useful pattern | Adopted? |
| --- | --- | --- | --- |
| Docker Compose interpolation | https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/ | `${VAR:-default}` allows a checked-in Compose file to retain a safe HTTP-pilot default while allowing an explicit production environment value to override it. | Yes: `WEB_ORIGIN` and `ALLOW_INSECURE_HTTP_IP` are interpolated from `.env.production`, with the current pilot defaults kept only as defaults. |
| Docker volume list | https://docs.docker.com/reference/cli/docker/volume/ls/ | `docker volume ls --filter label=<key>=<value> -q` finds volumes by labels rather than guessing a generated project-prefix name. | Yes: deployment refuses the first-deployment path if a Compose-labeled `postgres_data` volume exists without a discoverable PostgreSQL container. |
| curl time limits | https://curl.se/docs/manpage.html | `--connect-timeout` limits connection establishment and `--max-time` bounds the complete transfer. | Yes: every health request is individually bounded and the retry loop also has a wall-clock deadline. |

These fixes are reimplemented in POSIX shell and this Compose file; no external source code is copied. The guide now distinguishes the current HTTP-only image from the future, separately implemented HTTPS topology instead of implying that an environment-variable change adds TLS.

## Task 5 fix round 2 addendum

| Source | Link | Useful pattern | Adopted? |
| --- | --- | --- | --- |
| Compose top-level `name` | https://docs.docker.com/reference/compose-file/version-and-name/ | A top-level `name` defines the project name instead of inheriting an unstable directory name. | Yes: production uses the stable `kaoyan408` project name. |
| Compose volume labels | https://docs.docker.com/reference/compose-file/volumes/ | Compose applies both `com.docker.compose.project` and `com.docker.compose.volume` labels to named volumes. | Yes: the pre-deployment data-volume guard requires both labels, so another Compose project's volume cannot block this production project. |

The health-loop refinement checks the wall-clock deadline before each request and constrains each curl transfer to the remaining budget. No external source code is copied.

## Task 5 fix round 3 addendum

| Source | Link | Useful pattern | Adopted? |
| --- | --- | --- | --- |
| Docker Compose `config` | https://docs.docker.com/reference/cli/docker/compose/config/ | `config --format json` renders the resolved Compose data model in JSON, including its effective project identity. | Yes: deployment validates the normal Compose configuration and reads the resolved JSON `name` before applying a project-scoped volume label filter. |

The fixed top-level `name` is removed to preserve the project identity derived by existing deployment directories. The script parses the first JSON `name`, rejects an empty or unsafe value without printing Compose output, and uses that exact resolved name only in Docker's project-label filter. No external source code is copied.

## Task 6 production Compose smoke addendum

| Source | Link | Useful pattern | Adopted? |
| --- | --- | --- | --- |
| Docker Compose project name | https://docs.docker.com/compose/how-tos/project-name/ | `-p` gives each Compose run an explicit, isolated project identity, with the command-line value taking highest precedence. | Yes: every smoke Compose command carries one generated project name so it cannot select the default deployment project. |
| Docker Compose `restart` | https://docs.docker.com/reference/cli/docker/compose/restart/ | Restart selected project services without recreating or removing their named volumes. | Yes: the persistence gate restarts the isolated smoke project and verifies the registered account afterward. |
| Docker Compose `run` and `exec` | https://docs.docker.com/reference/cli/docker/compose/run/ | One-off commands can run against a selected Compose project; service ports are not published by default for `run`. | Yes: backup remains a one-off profiled service, while administrator provisioning executes inside the already isolated app container. |
| Node.js `child_process.spawn` | https://nodejs.org/api/child_process.html#child_processspawncommand-args-options | Argument arrays avoid shell interpolation, streams can be captured, and a child environment can be explicitly scoped. | Yes: Docker commands use `spawn` without a shell, capture child output, and pass random credentials through environment variables rather than loggable command text. |

The smoke runner adopts unique resource identity, bounded child-process execution, captured output, restart-in-place, and cleanup limited to its generated project. It does not copy reference source code and deliberately avoids selecting or removing any default production project.
