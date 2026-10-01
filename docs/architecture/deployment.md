# Deployment: AWS, CloudFormation, GitHub Actions

Status: **dev server built, not yet provisioned**. The templates, server scripts
and CI job are in the repo; the account steps under
[Setting up the dev server](#setting-up-the-dev-server) have not been run.
**stage** and **prod** have their parameter and compose files, but no stack and
no CI job yet. When they land, update this page and the Hosting and CI/CD rows
of [`tech-stack.md`](tech-stack.md).

## Environments

| Environment | Compose                                                    | Stack (params)                            | Domain                      | Deployed by                      |
| ----------- | ---------------------------------------------------------- | ----------------------------------------- | --------------------------- | -------------------------------- |
| local       | `docker/compose.local.yml`: dependencies, apps on the host | none                                      | `localhost`                 | `pnpm dev:up`                    |
| dev         | `docker/compose.yml` + `docker/compose.dev.yml`            | `app-dev` (`environments/dev.params`)     | `dev.socialglider.online`   | CI, every merge to **`develop`** |
| stage       | `docker/compose.yml` + `docker/compose.stage.yml`          | `app-stage` (`environments/stage.params`) | `stage.socialglider.online` | not wired yet                    |
| prod        | `docker/compose.yml` + `docker/compose.prod.yml`           | `app-prod` (`environments/prod.params`)   | `socialglider.online`       | not wired yet                    |

**One template, one parameter file per environment.**
[`environment.yml`](../../infra/cloudformation/environment.yml) is the only
environment template. Each environment's differences (domain, instance size,
disk, backup retention, pinned AMI) live in
`infra/cloudformation/environments/<env>.params`, deployed with
`infra/cloudformation/deploy.sh <env>`. Three copies of the template would
drift: a fix applied to dev and forgotten in prod is exactly what stage is
meant to catch.

**One server stack, one overlay per environment.**
[`docker/compose.yml`](../../docker/compose.yml) is the server stack all three
share and is never run alone. `docker/compose.<env>.yml` holds only container
sizing (memory limits, Postgres buffers) matched to that environment's
instance type. Application settings are not in compose: they come from
Parameter Store under `/app/<env>/`. `docker/compose.local.yml`, which was
`compose.dev.yml`, stays local-only.

## Shape

| Decision  | Choice                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hosting   | One EC2 instance per environment running the compose stack: Caddy, api, worker, Postgres, Redis. This keeps the low-cost principle in `tech-stack.md`.                                                                                                       |
| Infra     | CloudFormation: [`bootstrap.yml`](../../infra/cloudformation/bootstrap.yml) once per account, `environment.yml` once per environment.                                                                                                                        |
| DNS       | Namecheap. Each stack outputs an Elastic IP and you add one A record by hand. Caddy gets the TLS certificate itself.                                                                                                                                         |
| CI → AWS  | GitHub OIDC. No AWS keys are stored in GitHub. Each environment's deploy role trusts only the GitHub environment of the same name in this repository.                                                                                                        |
| Deploy    | Images are built once in CI and pushed to ECR, tagged with the commit SHA. The server never builds and never clones; it pulls images and a small bundle (`docker/`, `static/`, `infra/server/`). The deploy runs over SSM Run Command, so port 22 is closed. |
| Secrets   | SSM Parameter Store `SecureString` under `/app/<env>/`. On each deploy the server renders `apps/api/.env` (mode 600) from them, so it stays the only env file.                                                                                               |
| Unchanged | Cloudflare R2, the SMTP provider and the LLM provider are reached through env vars as today. Each environment gets its own R2 bucket and its own Meta app.                                                                                                   |

```
GitHub Actions ──OIDC──▶ app-<env> deploy role
  │ build, push                │ ssm:SendCommand (that instance only)
  ▼                            ▼
ECR app-api, app-web ◀─pull── EC2 app-<env> (Elastic IP; 80/443 open, no SSH)
S3 artifacts/bundles ◀─fetch─   compose.yml + compose.<env>.yml
                                Docker data on its own EBS volume (daily snapshots)
                                nightly pg_dump ──▶ S3 backups bucket
                                container logs  ──▶ CloudWatch /app/<env>
```

## What each piece does

**`bootstrap.yml`** creates the account-wide pieces:

- the GitHub OIDC provider;
- ECR repositories `app-api` and `app-web` (immutable tags, scan on push, keep 30 images);
- the artifacts bucket for deploy bundles, which expire after 30 days.

**`environment.yml`** creates one environment:

- **Network:** its own VPC with one public subnet, and a security group open only on 80 and 443.
- **Instance:** EC2 with an Elastic IP. It is x86, to match the amd64 images CI builds.
  - It uses IMDSv2 with a hop limit of 1, so containers can't read the instance's AWS credentials.
  - Termination protection is on for `prod`.
- **Data volume:** a separate encrypted EBS volume holds Docker's data-root, so Postgres, Redis and Caddy's certificates outlive the instance.
  - It carries `DeletionPolicy: Snapshot`.
  - DLM takes daily snapshots and keeps 7.
- **Backups:** an S3 bucket for the nightly `pg_dump`.
- **Monitoring:**
  - The log group `/app/<env>`, kept 30 days in prod and 14 elsewhere. Docker's `awslogs` driver sends every container's output there.
  - An alarm that auto-recovers the instance, and optional alarm emails.
- **Parameters:** the String parameters `DOMAIN`, `POSTGRES_USER` and `POSTGRES_DB`.
- **Deploy role:** the GitHub deploy role, scoped to the two ECR repositories, the bundle prefix, and `ssm:SendCommand` on this one instance.

UserData runs only at first boot. It mounts the volume, installs Docker and
the compose plugin, and writes `/opt/app/bin/deploy`. Everything that changes
later ships in the bundle, so it is reviewed with the code.

**`infra/server/deploy.sh`** runs on the server for each commit. Every compose
call goes through `compose_in` in `lib.sh`, which adds the overlay for the
server's environment.

1. Render `apps/api/.env` from `/app/<env>/*`. Fail if a required value is missing, or if a database password is not URL-safe.
2. Log in to ECR and `docker compose pull`.
3. Run migrations as the owner (`scripts/migrate.mjs`) while the old release is still serving.
4. `up -d --no-build`, then wait up to 3 minutes for the api healthcheck and for the worker to be running.
5. On failure, print the logs, start the previous release's images again and exit non-zero, which turns the CI job red. On success, point `/opt/app/current` at the release, install the backup timer, and keep the last three releases.

**Rollback restores images, never the database.** A migration must therefore
work with the previous release still running: add first, remove in a later
release. Recreating the api container costs a few seconds of 502s per deploy.
Meta retries webhook deliveries, so that is fine for dev and for the pilot.

**CI** (`deploy-dev` in [`ci.yml`](../../.github/workflows/ci.yml)) runs after
`test` on every push to `develop`, which is every merge, once the repository
variable `DEV_DEPLOY_ENABLED` is `true`:

1. Assume the role and build and push both images, skipping any already in ECR because tags are immutable.
2. Upload the bundle.
3. Run [`infra/ci/ssm-deploy.sh`](../../infra/ci/ssm-deploy.sh), which sends the SSM command, waits and prints its output.
4. `curl` `https://dev.socialglider.online/health`.

CI runs on pushes to `main` and `develop`, and on every pull request. A newer
push cancels a pull request's run, but never a branch run, because that could
cut a deploy off halfway.

## Setting up the dev server

You need:

- AWS CLI **v2**, because v1 would fetch the contents of a `--value https://…` instead of storing the URL;
- to be signed in to the account as an administrator;
- a **region** close to your sellers.

Set the region once:

```sh
export AWS_REGION=ap-southeast-1   # example; pick yours
```

### 0. The `develop` branch

Create it from `main` and push it. Make it the default target for feature PRs,
and protect it in **Settings → Branches** so merges go through PRs with CI
green.

### 1. Bootstrap stack (once per account)

```sh
infra/cloudformation/deploy.sh bootstrap
```

Prefix it with `CREATE_OIDC_PROVIDER=false` if the account already has the
GitHub OIDC provider.

### 2. Dev environment stack

```sh
infra/cloudformation/deploy.sh dev
```

The first run stops and prints the current Amazon Linux 2023 AMI for your
region. Put it in `infra/cloudformation/environments/dev.params` as `ImageId=…`
(and `AlarmEmail=` if you want alarm emails), commit, and run it again. It
prints the stack's outputs. Write down `PublicIp`, `InstanceId` and
`DeployRoleArn`, plus `ArtifactsBucketName` from the bootstrap output.

### 3. DNS at Namecheap

In **Domain List → socialglider.online → Manage → Advanced DNS**, add:

| Type     | Host  | Value        | TTL       |
| -------- | ----- | ------------ | --------- |
| A Record | `dev` | `<PublicIp>` | Automatic |

Check it with `dig +short dev.socialglider.online`. Caddy can't get a
certificate until this resolves, but the deploy itself doesn't wait for it.

### 4. Secrets

Each one is a `SecureString` under `/app/dev/`. The names match
`apps/api/src/config/env.schema.ts`; `DOMAIN`, `POSTGRES_USER` and
`POSTGRES_DB` already exist from the stack.

```sh
put() { aws ssm put-parameter --name "/app/dev/$1" --type SecureString --value "$2" --overwrite; }

put POSTGRES_PASSWORD     "$(openssl rand -hex 32)"
put APP_RUNTIME_PASSWORD  "$(openssl rand -hex 32)"
put BETTER_AUTH_SECRET    "$(openssl rand -base64 32)"
put TOKEN_ENCRYPTION_KEY  "$(openssl rand -base64 32)"
put META_APP_SECRET       '…'
put META_VERIFY_TOKEN     "$(openssl rand -hex 24)"
put META_GRAPH_VERSION    'v21.0'
put SMTP_URL              'smtp://user:pass@smtp.provider.com:587'
put MAIL_FROM             'Social Glider <no-reply@socialglider.online>'
put STORAGE_ENDPOINT      'https://<account>.r2.cloudflarestorage.com'
put STORAGE_BUCKET        '…'      # this environment's bucket only
put STORAGE_ACCESS_KEY_ID '…'
put STORAGE_SECRET_ACCESS_KEY '…'
put STORAGE_PUBLIC_BASE_URL '…'
put LLM_API_KEY           '…'
# Optional: META_APP_ID, GOOGLE_CLIENT_ID/SECRET, FACEBOOK_CLIENT_ID/SECRET,
# LOG_LEVEL, WORKER_CONCURRENCY, SENTRY_DSN
```

Rules:

- Values may not contain a single quote or a newline. The deploy refuses them.
- `POSTGRES_PASSWORD` and `APP_RUNTIME_PASSWORD` are set **before the first deploy and never changed afterwards**. Postgres reads them only when its data volume is empty; changing one later needs `ALTER ROLE` by hand.
- A secret change takes effect on the next deploy.

### 5. GitHub

1. **Settings → Environments → New environment `dev`.** Under deployment branches, allow only `develop`.
2. In that environment, add these **variables** (not secrets; none of them is sensitive):

   | Variable              | Value                                   |
   | --------------------- | --------------------------------------- |
   | `AWS_REGION`          | your region                             |
   | `AWS_DEPLOY_ROLE_ARN` | `DeployRoleArn` output                  |
   | `INSTANCE_ID`         | `InstanceId` output                     |
   | `ARTIFACTS_BUCKET`    | `ArtifactsBucketName` output, bootstrap |

3. **Settings → Secrets and variables → Actions → Variables (repository):** `DEV_DEPLOY_ENABLED` = `true`.

The next merge to `develop`, or a re-run of its latest CI run, deploys.

### 6. Outside AWS

- **Meta:** use a separate test app for dev. Its webhook URL is `https://dev.socialglider.online/api/v1/…` with `/app/dev/META_VERIFY_TOKEN`. Dev must never receive real Page traffic.
- **Google / Facebook login:** add `https://dev.socialglider.online` to the OAuth redirect and origin lists.

## Operating a server

| Task                  | How                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell on the server   | `aws ssm start-session --target <InstanceId>` (needs the Session Manager plugin), then `sudo -i`.                                                                                                                                                                                     |
| Logs                  | CloudWatch Logs → `/app/<env>`, one stream per container. `aws logs tail /app/dev --follow`.                                                                                                                                                                                          |
| Redeploy a commit     | Re-run its `develop` CI run, or on the server: `/opt/app/bin/deploy <full sha>`.                                                                                                                                                                                                      |
| Compose on the server | `cd /opt/app/current && . infra/server/lib.sh && compose_in . ps`                                                                                                                                                                                                                     |
| Backup now            | `systemctl start app-backup.service`, then check `journalctl -u app-backup`.                                                                                                                                                                                                          |
| Restore drill         | Copy a dump from the backups bucket, `pg_restore` it into a scratch `postgres:17-alpine` container, and run `db:verify-rls` against it. Do this once before prod.                                                                                                                     |
| Resize                | Change `InstanceType` in `<env>.params` **and** the limits in `docker/compose.<env>.yml`, then `deploy.sh <env>`. The instance stops and starts; data and IP stay.                                                                                                                    |
| OS updates            | Patch in place: `dnf upgrade --releasever=latest`, then reboot. Do **not** bump `ImageId` to patch. A new AMI replaces the instance, and CloudFormation would try to attach the data volume to the new instance while the old one still holds it, so the update fails and rolls back. |

## Rough monthly cost (us-east-1 on-demand; Asian regions run about 10–20% higher)

| Item                           | dev / stage (`t3.small`) | prod (`t3.medium`, 40 GB) |
| ------------------------------ | ------------------------ | ------------------------- |
| EC2                            | ~$15.20                  | ~$30.40                   |
| EBS root 20 GB + data, gp3     | ~$3.20                   | ~$4.80                    |
| Public IPv4 (Elastic IP)       | ~$3.65                   | ~$3.65                    |
| Snapshots, S3, ECR, CloudWatch | ~$1–3                    | ~$3–5                     |
| **Total**                      | **~$23–25 each**         | **~$42–44**               |

Dev and stage can be stopped outside working hours. Their Elastic IP is still
billed while the instance is stopped.

## Later: stage and prod

1. Pin `ImageId` in `stage.params` / `prod.params`, then run `deploy.sh stage` / `deploy.sh prod`. Confirm `Domain` in `prod.params` first; it currently says the apex `socialglider.online`.
2. Add GitHub environments `stage` and `prod`; prod gets required reviewers.
3. Add deploy jobs that reuse the image tags already built for `develop`, never rebuilding. Suggested flow: fast-forward `main` to `develop` to deploy to stage, then an approval on that run promotes the same SHA to prod. A merge commit would get a new SHA, and with it a rebuild.
4. Run the restore drill before prod takes real traffic.
