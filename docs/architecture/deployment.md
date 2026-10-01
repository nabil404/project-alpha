# Deployment plan: AWS, CloudFormation, GitHub Actions

Status: **proposed**. Nothing below exists yet. When a phase lands, update this
page and the Hosting and CI/CD rows of [`tech-stack.md`](tech-stack.md) in the
same change.

## Decisions

| Decision       | Choice                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting shape  | One EC2 instance per environment running the existing [`docker/compose.yml`](../../docker/compose.yml) unchanged in shape: Caddy, api, worker, Postgres, Redis. This keeps the low-cost principle in `tech-stack.md` and today's deploy design. Managed Postgres (Neon or RDS) can come later for production without changing the pipeline. |
| Environments   | **staging** and **production**, each on its own instance and stack. A push to `main` deploys to staging automatically. Production gets the **same image digests**, never a rebuild, after a manual approval in the GitHub `production` environment.                                                                                         |
| Infrastructure | **CloudFormation** templates in `infra/cloudformation/`. Nothing is created by hand in the console except the one-time steps listed under Prerequisites.                                                                                                                                                                                    |
| CI → AWS auth  | GitHub OIDC. No long-lived AWS keys are stored in GitHub.                                                                                                                                                                                                                                                                                   |
| Deploy channel | SSM Run Command. Port 22 is closed. The commented-out `appleboy/ssh-action` deploy in `ci.yml` is replaced.                                                                                                                                                                                                                                 |
| Images         | Built once in CI, pushed to ECR, tagged with the commit SHA. The server only pulls and never builds.                                                                                                                                                                                                                                        |
| Secrets        | SSM Parameter Store `SecureString` under `/app/<env>/`. The deploy script renders `apps/api/.env` on the server from those parameters; it stays the only env file, as AGENTS.md requires.                                                                                                                                                   |
| Unchanged      | Cloudflare R2 for images, SMTP provider for email, the LLM provider. They are already reached over the network through env vars.                                                                                                                                                                                                            |

## Architecture

```
GitHub Actions ──OIDC──▶ IAM deploy role
   │  build + push               │ ssm:SendCommand (tag app:env=<env> only)
   ▼                             ▼
  ECR (api, web)  ◀── pull ── EC2 (per env, Elastic IP, SG: 80/443 only)
  S3 artifacts    ◀── fetch ──   docker compose: caddy · api · worker · postgres · redis
                                 data on a separate EBS volume (Retain + DLM snapshots)
                                 nightly pg_dump ──▶ S3 backups bucket
                                 container logs ──▶ CloudWatch Logs
```

## CloudFormation stacks

### `infra/cloudformation/bootstrap.yml`: once per account

- `AWS::IAM::OIDCProvider` for `token.actions.githubusercontent.com`.
- ECR repositories `app-api` and `app-web`. Scan on push, immutable tags, and a
  lifecycle rule keeping the last 30 images.
- S3 bucket `…-artifacts` for deploy bundles, versioned, expiring after 30 days.
- IAM role `github-deploy`, trusted only for
  `repo:nabil404/project-alpha:environment:staging` and `…:environment:production`.
  It may push to ECR, write `artifacts/*`, and call `ssm:SendCommand` only on
  the `AWS-RunShellScript` document and only for instances tagged
  `app:env=<env>`. Use one role per environment if the policy gets awkward.
- IAM role `github-infra`, trusted only from `main` and the production
  environment, with CloudFormation change-set permissions on the stacks below.

### `infra/cloudformation/environment.yml`: once per environment (`EnvName` parameter)

- **EC2**: `t4g.medium` for production, `t4g.small` for staging (Graviton,
  arm64). Amazon Linux 2023. Instance-profile role with `AmazonSSMManagedInstanceCore`,
  ECR pull, `ssm:GetParametersByPath` on `/app/<env>/*` plus `kms:Decrypt`, read
  on `artifacts/*`, and write on its own backups prefix.
- **AMI is a pinned parameter**, not the `/aws/service/ami-amazon-linux-latest/…`
  resolver. The resolver changes over time, and a changed `ImageId` makes
  CloudFormation _replace_ the instance. OS patching goes through
  `dnf upgrade` with the SSM Patch Manager baseline.
- **Data volume**: a separate `AWS::EC2::Volume` (gp3, encrypted,
  `DeletionPolicy: Snapshot`, `UpdateReplacePolicy: Snapshot`) mounted at
  `/srv/data`. Docker's `data-root` points there, so Postgres, Redis AOF and
  Caddy certificates outlive any instance replacement. Its Availability Zone is
  a stack parameter that both the volume and the instance use.
- **`AWS::DLM::LifecyclePolicy`**: daily snapshots of the data volume, keeping 7.
- **Elastic IP** and a **security group** with only 80 and 443 inbound. No 22.
- **S3 backups bucket** (or a prefix in one shared bucket): versioned, blocks
  public access, lifecycle 30 days to Infrequent Access, expires at 90 days.
- **CloudWatch**: log group `/app/<env>` with 30-day retention (containers use
  the `awslogs` driver). An alarm on `StatusCheckFailed` that auto-recovers
  the instance, plus an SNS email topic.
- **Route 53 record** (optional, only if the domain's zone is in Route 53).
  Otherwise output the Elastic IP and set an A record at your DNS host. Caddy
  can only get a certificate once DNS points at the instance.
- **UserData** runs only at first boot. It installs Docker and the compose
  plugin, mounts the volume, writes `/opt/app/bin/deploy` and
  `/opt/app/bin/backup`, and enables the backup systemd timer. Anything that
  changes later is delivered by the deploy, not by UserData.

Secrets are **not** CloudFormation parameters: they would show up in stack
events and the console. Create them once per environment with
`aws ssm put-parameter --type SecureString`: `POSTGRES_PASSWORD`,
`APP_RUNTIME_PASSWORD`, `BETTER_AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, the
`META_*`, `STORAGE_*`, `SMTP_URL`, `LLM_API_KEY` and OAuth values. Non-secret
values (`DOMAIN`, `META_GRAPH_VERSION`, `LOG_LEVEL`) go in as `String`
parameters.

## Repo changes outside `infra/`

1. **`docker/compose.yml`**: give `api`, `worker` and `web` an
   `image: ${API_IMAGE:-app-api}` / `${WEB_IMAGE:-app-web}` alongside `build:`.
   That way local builds still work and the server runs
   `docker compose pull && up -d --no-build`.
2. **Worker `stop_grace_period: 60s`**: Docker's default 10 s would kill an
   in-flight LLM extraction on every deploy. `enableShutdownHooks()` is
   already in place in `worker.ts`; it needs time to finish the job.
3. **`logging` driver `awslogs`** on the app services, through an
   `x-logging` anchor, driven by env vars so local development keeps the
   default.
4. **Deploy bundle**: CI tars `docker/` and `static/` into
   `s3://…-artifacts/<sha>.tgz`. The server never clones the repository and
   holds no GitHub credentials.
5. **arm64 images**: build on a GitHub `ubuntu-24.04-arm` runner, or use
   `docker/build-push-action` with `platforms: linux/arm64` under QEMU (slower).
   If arm runners are not available on your plan, switch the instances to
   `t3.small`/`t3.medium` and build amd64 instead.

## Pipeline (`.github/workflows/ci.yml`)

| Job                 | Runs on                                                               | Does                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test`              | every PR and push                                                     | Unchanged: lint, format, typecheck, migrate, test, RLS check, migration-drift check.                                                                                           |
| `build`             | push to `main`, needs `test`                                          | OIDC → ECR login → build and push `app-api:<sha>` and `app-web:<sha>` with GHA cache → upload the deploy bundle. Outputs the image digests.                                    |
| `deploy-staging`    | needs `build`, environment `staging`                                  | `ssm send-command` → `/opt/app/bin/deploy <sha>` on `app:env=staging`, then wait for the command and fail the job if it fails. Smoke test: `curl -f https://<staging>/health`. |
| `deploy-production` | needs `deploy-staging`, environment `production` (required reviewers) | Same command and same SHA against `app:env=production`. Approval happens in the GitHub UI on the same run.                                                                     |
| `infra` (own file)  | PRs touching `infra/**`                                               | `cfn-lint` + `aws cloudformation validate-template`, then create a **change set** and post its summary. Applying it is `workflow_dispatch` only, staging first.                |

`concurrency: deploy-<env>` with `cancel-in-progress: false`, so two deploys to
one environment never overlap.

### `/opt/app/bin/deploy <sha>` on the server

1. Download and unpack `<sha>.tgz` to `/opt/app/releases/<sha>`.
2. Render `apps/api/.env` (mode 600) from `/app/<env>/*` parameters.
3. `aws ecr get-login-password | docker login …`, then `docker compose pull`.
4. Run migrations as the owner, exactly as the commented-out deploy job does:
   `compose run --rm -e DATABASE_ADMIN_URL=… api node scripts/migrate.mjs`.
5. `compose up -d --no-build --remove-orphans`, then wait for the api
   healthcheck to report healthy (up to about 90 s).
6. On success, repoint `/opt/app/current` and write the SHA to
   `/opt/app/deployed`. On failure, `up -d` the previous SHA's images and exit
   non-zero so the job turns red.
7. `docker image prune -f`, keeping the previous release for rollback.

**Rollback restores images, never the database.** Every migration therefore
has to be safe for the _previous_ release to run against (expand, then
contract in a later release). Migrations run while the old containers are still
serving, so the same rule covers the deploy window too.

**Downtime**: recreating the api container means a few seconds of 502s per
deploy. Meta retries failed webhook deliveries, and the queue absorbs the
rest. That is acceptable for the pilot. Zero-downtime would need a second api
container behind Caddy, and it is not planned.

## Backups and restore

- `/opt/app/bin/backup` runs nightly from a systemd timer:
  `pg_dump -Fc` in the postgres container → `s3://…-backups/<env>/<date>.dump`.
- DLM EBS snapshots are the second, crash-consistent layer.
- **A backup counts only after a restore has worked.** Phase 6 includes
  restoring the latest dump into a scratch container and running
  `db:verify-rls` against it.

## Phases

| #   | Phase                                                                                                  | Done when                                                                      |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 0   | Prerequisites: AWS account with MFA on root, region chosen, budget alarm, domain, GitHub environments  | `staging` and `production` environments exist; production requires review.     |
| 1   | `bootstrap.yml` deployed by hand (it creates the role CI would use)                                    | CI can assume `github-deploy` and push a test image to ECR.                    |
| 2   | `environment.yml` for staging and SSM parameters                                                       | Instance reachable through SSM Session Manager; Docker running on `/srv/data`. |
| 3   | Compose changes and deploy/backup scripts                                                              | A manual `deploy <sha>` brings staging up on HTTPS and `/health` is green.     |
| 4   | `build` + `deploy-staging` jobs                                                                        | A merge to `main` reaches staging with no manual steps.                        |
| 5   | Production stack, parameters, `deploy-production` job                                                  | An approved run promotes the staging SHA to production.                        |
| 6   | Backups, restore drill, alarms, uptime checks; update `tech-stack.md` and the AGENTS.md commands table | A restore from S3 passes `db:verify-rls`; an alarm email has been received.    |

Staging needs its own Meta app (or test app) with its own webhook URL and
verify token, so staging never receives production Page traffic.

## Rough monthly cost (on-demand, us-east-1; Asian regions run about 10–20% higher)

| Item                                   | Production | Staging  |
| -------------------------------------- | ---------- | -------- |
| EC2 (`t4g.medium` / `t4g.small`)       | ~$24.50    | ~$12.30  |
| EBS root 20 GB + data 20 GB gp3        | ~$3.20     | ~$3.20   |
| Public IPv4 (Elastic IP)               | ~$3.65     | ~$3.65   |
| Snapshots, S3 backups, ECR, CloudWatch | ~$3–5      | ~$1–2    |
| **Total**                              | **~$35**   | **~$20** |

A one-year Compute Savings Plan cuts the EC2 lines by about 30%. Staging can
also be stopped outside working hours.

## Open questions

1. **Region.** Put it close to the sellers, because every Messenger message
   takes a lock on a conversation row and LLM latency already dominates.
2. **DNS.** Is the domain's zone in Route 53, or elsewhere (for example
   Cloudflare, next to R2)? This decides whether the stack creates the record.
3. **Instance architecture.** Graviton (arm64, cheaper, needs arm builds) or
   x86 (simpler builds)?
4. **Uptime monitoring.** Keep Uptime Kuma as `tech-stack.md` plans (it needs
   somewhere to run _outside_ the server it watches), or use a Route 53 health
   check with a CloudWatch alarm (~$0.50/month)?
