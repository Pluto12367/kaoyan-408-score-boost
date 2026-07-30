# Tencent Cloud public-IP pilot reference check

## Task

- Feature: production environment validation for a temporary public-IP HTTP pilot.
- Files: environment validator, API bootstrap validation, production example, and environment tests.

## References reviewed

| Source | Link | Useful pattern | Adopted? |
| --- | --- | --- | --- |
| Docker Compose startup order | https://docs.docker.com/compose/how-tos/startup-order/ | A dependent service can wait for a database health check using `depends_on` with `service_healthy`; a running container is not necessarily ready. | Yes: keep database readiness checks as the deployment health-gate pattern. |
| NGINX reverse proxy | https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy | Route a scoped location to an internal upstream and forward the request through the proxy, keeping the application service behind the proxy boundary. | Yes: retain the same-origin `/api` route as the only API path in the HTTP pilot. |
| Docker Official Image: postgres | https://hub.docker.com/_/postgres | Configure the official image through documented environment variables and preserve database data with the documented volume location; do not expose it publicly. | Yes: keep PostgreSQL on the internal Docker network with its existing environment-driven configuration. |
| OWASP Transport Layer Security Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html | Use TLS for all public pages and APIs; any HTTP exception needs a strictly limited, temporary boundary. | Yes: HTTPS remains required by default; the exception is opt-in and narrowly validated. |

## Adopted deployment and validation boundaries

- Health checks: deployment services should use health checks and wait for database readiness before dependent services start.
- Internal network: the API-to-PostgreSQL path remains internal; the public edge handles the browser-facing route.
- Environment variables: retain explicit production values, reject placeholders, and keep `ALLOW_DEMO_AUTH=false` outside development.
- Temporary HTTP exception: only `ALLOW_INSECURE_HTTP_IP=true` with a root `http://` IPv4 `WEB_ORIGIN` and same-origin `VITE_API_BASE_URL=/api` is valid. HTTP domains, paths, query strings, fragments, other API paths, and every configuration without the explicit flag remain rejected.

No external source code is copied; these patterns are reimplemented in this repository's validators.
