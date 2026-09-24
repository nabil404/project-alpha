# Deployment

Production is one VPS running Docker Compose (AGENTS.md §10). The stack is split
into four role files so that any role can later move to its own server without
rewriting the stack:

| File                        | Role   | Services             | Publishes               |
| --------------------------- | ------ | -------------------- | ----------------------- |
| `docker/compose.web.yml`    | web    | caddy (SPA baked in) | 80, 443                 |
| `docker/compose.api.yml`    | api    | api                  | 3000 on `BIND_IP`       |
| `docker/compose.worker.yml` | worker | worker               | nothing                 |
| `docker/compose.data.yml`   | data   | postgres, redis      | 5432, 6379 on `BIND_IP` |

`docker/compose.app.yml` is the shared base the api and worker `extend`: one
image, the env file, and the overrides that keep stack secrets out of the app.
`docker/compose.yml` includes all four role files and adds the startup ordering
that only holds when they share a host, by overriding the included services.
Both `include` and that override need a recent Docker Compose; the layout was
checked with v5.1, so match or exceed it on the server.

## One VPS (today)

```bash
docker compose --env-file apps/api/.env -f docker/compose.yml up -d --build
```

Staging is the same file with its own env file and project name:
`docker compose -p app-staging --env-file apps/api/.env.staging -f docker/compose.yml up -d`.

`BIND_IP` defaults to `127.0.0.1`, so Postgres, Redis and the api are reachable
from the host itself (handy for `pg_dump` and `psql`) and from nothing else.

## Scale on one server first

The api and worker keep no state of their own: sessions live in Postgres, rate
limits and the queue in Redis. Before adding servers, add worker replicas:

```bash
docker compose --env-file apps/api/.env -f docker/compose.yml up -d --scale worker=3
```

Each replica holds a pool of `DATABASE_POOL_MAX` connections and runs
`WORKER_CONCURRENCY` jobs, so keep the total within Postgres `max_connections`.
The api publishes a fixed host port and therefore cannot be scaled this way
until that port mapping is removed.

## Moving a role to its own server

1. **Private network.** Put every server on the provider's private network
   (VPC), or WireGuard if there is none. Postgres and Redis are never reachable
   from the public internet; without a private network, turn on Postgres TLS and
   add `sslmode=require` to both database URLs.
2. **Publish on the private address.** On the data and api servers, set
   `BIND_IP` to that server's private IP.
3. **Firewall per port.** Allow 5432/6379 on the data server only from the api
   and worker servers, and 3000 on the api server only from the web server. Use
   the provider's cloud firewall: Docker writes its own iptables rules, so a
   `ufw` deny does not cover a published port.
4. **Point the consumers at it.** On the api and worker servers set `DB_HOST`
   and `REDIS_HOST` to the data server's private IP; on the web server set
   `API_UPSTREAM` to `<api private IP>:3000`.
5. **Cut each server's env file down to its role.** Every server keeps its file
   at `apps/api/.env`, but only with what that role reads:
   - web: `DOMAIN`, `API_UPSTREAM`, `IMAGE_TAG`. Never `TOKEN_ENCRYPTION_KEY`,
     the Meta or auth secrets.
   - data: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
     `APP_RUNTIME_PASSWORD`, `REDIS_PASSWORD`, `BIND_IP`.
   - api and worker: the app variables, plus `DB_HOST`, `REDIS_HOST`,
     `POSTGRES_DB`, `APP_RUNTIME_PASSWORD`, `REDIS_PASSWORD`, `DOMAIN`
     (and `BIND_IP` on the api).
6. **Run the role file alone** on each server:
   `docker compose --env-file apps/api/.env -f docker/compose.<role>.yml up -d`.
   Deploy in the order data → api (migrations run here) → worker → web.
7. **Build once.** Push the images to a registry (GHCR) from CI and pull them by
   `IMAGE_TAG` on each server, instead of building from source four times.
8. **Backups.** Move the nightly `pg_dump` to the data server.

Keep every server in the same region: each api and worker query now crosses
the network, including the short transactions that lock a conversation row.

## Upgrading from the single-file stack

The project name (`app`) and volume names are unchanged, so Postgres and Redis
data carry over. Before the first `up` with this layout:

- add `REDIS_PASSWORD` to `apps/api/.env`;
- run `up` with `--remove-orphans` to drop the old one-shot `web` container, then
  `docker volume rm app_web_dist`, which nothing uses any more.
