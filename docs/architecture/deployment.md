# Deployment: AWS, CloudFormation, GitHub Actions

Status: **dev server built, not yet provisioned**. The templates, server scripts
and workflows are in the repo; the account steps under
[Setting up the dev server](#setting-up-the-dev-server) have not been run.
**stage** and **prod** have their parameter files, compose overlays and
workflows, but no stack yet, so their workflows only test. When they land, update this page and the Hosting and CI/CD rows
of [`tech-stack.md`](tech-stack.md).

## Environments

| Environment | Compose                                                    | Stack (params)                            | Domain                      | Deployed by                                                   |
| ----------- | ---------------------------------------------------------- | ----------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| local       | `docker/compose.local.yml`: dependencies, apps on the host | none                                      | `localhost`                 | `pnpm dev:up`                                                 |
| dev         | `docker/compose.yml` + `docker/compose.dev.yml`            | `app-dev` (`environments/dev.params`)     | `dev.socialglider.online`   | `deploy-dev.yml`: every merge to **`develop`**                |
| stage       | `docker/compose.yml` + `docker/compose.stage.yml`          | `app-stage` (`environments/stage.params`) | `stage.socialglider.online` | `deploy-stage.yml`: every push to **`stage`**                 |
| prod        | `docker/compose.yml` + `docker/compose.prod.yml`           | `app-prod` (`environments/prod.params`)   | `socialglider.online`       | `deploy-prod.yml`: manual, approved, a SHA already on `stage` |

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
the one Parameter Store entry `/app/<env>/env`. `docker/compose.local.yml`, which was
`compose.dev.yml`, stays local-only.

## Shape

| Decision  | Choice                                                                                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hosting   | One EC2 instance per environment running the compose stack: Caddy, api, worker, Postgres, Redis. This keeps the low-cost principle in `tech-stack.md`.                                                                                                                                                                                     |
| Infra     | CloudFormation: [`bootstrap.yml`](../../infra/cloudformation/bootstrap.yml) shared by dev and stage, [`bootstrap-prod.yml`](../../infra/cloudformation/bootstrap-prod.yml) for prod alone, `environment.yml` once per environment.                                                                                                         |
| DNS       | Namecheap. Each stack outputs an Elastic IP and you add one A record by hand. Caddy gets the TLS certificate itself.                                                                                                                                                                                                                       |
| CI → AWS  | GitHub OIDC. No AWS keys are stored in GitHub. Each environment's deploy role trusts only the GitHub environment of the same name in this repository.                                                                                                                                                                                      |
| Deploy    | Images are built once, by dev or stage, and pushed to ECR tagged with the commit SHA; prod copies them into its own repositories rather than rebuilding. The server never builds and never clones; it pulls images and a small bundle (`docker/`, `static/`, `infra/server/`). The deploy runs over SSM Run Command, so port 22 is closed. |
| Secrets   | One SSM Parameter Store `SecureString` per environment, `/app/<env>/env`, holding the whole env file. On each deploy the server writes it to `apps/api/.env` (mode 600), so that stays the only env file.                                                                                                                                  |
| Unchanged | Cloudflare R2, the SMTP provider and the LLM provider are reached through env vars as today. Each environment gets its own R2 bucket and its own Meta app.                                                                                                                                                                                 |

```
GitHub Actions ──OIDC──▶ app-<env> deploy role
  │ build (dev, stage)         │ ssm:SendCommand (that instance only)
  │ or copy (prod)             │
  ▼                            ▼
ECR app-api, app-web ─────── copy ──▶ ECR app-prod-api, app-prod-web
  (app-bootstrap)                       (app-bootstrap-prod)
  ▲ pull: dev, stage                    ▲ pull: prod
EC2 app-<env> (Elastic IP; 80/443 open, no SSH)
  fetches its bundle from its bootstrap's S3 bucket
  runs compose.yml + compose.<env>.yml
                                Docker data on its own EBS volume (daily snapshots)
                                nightly pg_dump ──▶ S3 backups bucket
                                container logs  ──▶ CloudWatch /app/<env>
```

## What each piece does

**`bootstrap.yml`** (stack `app-bootstrap`) creates what dev and stage share:

- the GitHub OIDC provider;
- ECR repositories `app-api` and `app-web` (immutable tags, scan on push, keep 30 images);
- the artifacts bucket for deploy bundles, which expire after 30 days.

**`bootstrap-prod.yml`** (stack `app-bootstrap-prod`) is prod's own copy, with
repositories `app-prod-api` and `app-prod-web` and its own bundle bucket. For
now it is a deliberate duplicate of `bootstrap.yml`, so prod can diverge later
without touching dev and stage. That could mean its own AWS account, or
stricter retention or scanning. Its `CreateOidcProvider` defaults to `false`
because, while prod shares the account, `app-bootstrap` already created the
provider; set it to `true` if prod moves to an account of its own. In that
case the non-prod repositories also need a repository policy that lets prod's
account pull from them.

`prod.params` points prod at `app-bootstrap-prod` (`BootstrapStackName`) and
names `app-bootstrap` as `SourceBootstrapStackName`. That grants prod's deploy
role read access to the non-prod repositories so it can copy images out of
them.

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
- **Deploy role:** the GitHub deploy role, scoped to the two ECR repositories, the bundle prefix, and `ssm:SendCommand` on this one instance.

UserData runs only at first boot. It does four things:

- mounts the volume;
- installs Docker and the compose plugin;
- writes `/opt/app/bin/deploy`, which unpacks a commit's bundle into `/opt/app` and runs its `deploy.sh`;
- installs the nightly backup timer.

Everything that changes later ships in the bundle, so it is reviewed with the
code.

**`infra/server/deploy.sh`** runs on the server for each commit. Its compose
calls go through `app_compose` in `lib.sh`, which adds the overlay for the
server's environment.

1. Write `apps/api/.env` from the one SecureString `/app/<env>/env`, adding the commit's image tags.
2. Log in to ECR and `docker compose pull`.
3. `compose run --rm migrate` applies migrations as the owner while the old release is still serving. `migrate` is a compose service behind a profile, and it is the only one that gets the admin URL.
4. `compose up --wait` starts the release. Compose itself waits up to 3 minutes for every healthcheck to pass and every container to be running.
5. On failure, print the logs, start the previous commit's images again (recorded in `/opt/app/deployed`) and exit non-zero, which turns the CI job red.

**Rollback restores images, never the database.** A migration must therefore
work with the previous release still running: add first, remove in a later
release. Recreating the api container costs a few seconds of 502s per deploy.
Meta retries webhook deliveries, so that is fine for dev and for the pilot.

### Workflows

One workflow per environment, all running one shared deploy procedure:

| Workflow                                                       | Trigger                                                               | Does                                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`ci.yml`](../../.github/workflows/ci.yml)                     | every pull request; called by `deploy-dev.yml` and `deploy-stage.yml` | Checks only: lint, format, typecheck, migrate, test, RLS check, migration-drift check.                                                                                                                                                           |
| [`deploy-dev.yml`](../../.github/workflows/deploy-dev.yml)     | push to `develop`, i.e. every merge                                   | `ci.yml`, then deploys the commit to dev, building its images.                                                                                                                                                                                   |
| [`deploy-stage.yml`](../../.github/workflows/deploy-stage.yml) | push to `stage`                                                       | `ci.yml`, then deploys the commit to stage. Fast-forward `stage` to `develop` and dev's images are reused; a merge commit is a new SHA and builds its own.                                                                                       |
| [`deploy-prod.yml`](../../.github/workflows/deploy-prod.yml)   | manual (**Run workflow** with a full SHA)                             | Checks the SHA is on `stage`, waits for a `prod` environment reviewer, then **copies** that SHA's images from `app-api`/`app-web` into `app-prod-api`/`app-prod-web` and deploys them. It never builds; if stage never had the images, it fails. |
| [`deploy.yml`](../../.github/workflows/deploy.yml) (reusable)  | called by the three above                                             | The procedure, listed below.                                                                                                                                                                                                                     |

Each deploy job is gated by a repository variable (`DEV_DEPLOY_ENABLED`,
`STAGE_DEPLOY_ENABLED`, `PROD_DEPLOY_ENABLED`) that you set to `true` once that
environment's stack exists. Until then its workflow still tests the branch.
Deploys to one environment queue and are never cancelled, because a cancelled
deploy could stop halfway.

`deploy.yml` runs in the GitHub environment it was given, so it assumes that
environment's role with that environment's variables:

1. Get the images into this environment's repositories, which are `ECR_API_REPOSITORY`/`ECR_WEB_REPOSITORY` and default to `app-api`/`app-web`. Tags are immutable, so images that already exist are skipped.
   - With `images: build` (dev, stage), it builds what is missing.
   - With `images: promote` (prod), it copies the manifest from the non-prod repositories. The copy happens inside the registry, so the digest is the one stage ran.
2. Upload the bundle.
3. Run [`infra/ci/ssm-deploy.sh`](../../infra/ci/ssm-deploy.sh), which sends the SSM command, waits and prints its output.
4. `curl` the environment's `/health`.

### Infra workflows

The CloudFormation stacks change through pull requests too. The app workflows
never touch them, and these never touch the app.

| Workflow                                                     | Trigger                                                                              | Does                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [`infra-plan.yml`](../../.github/workflows/infra-plan.yml)   | a PR into `develop` or `stage` that touches `infra/cloudformation/**`                | Lints the templates. Previews the change to dev (PRs into `develop`) or stage (PRs into `stage`) in the job summary. |
| [`infra-dev.yml`](../../.github/workflows/infra-dev.yml)     | push to `develop` changing `environment.yml`, `dev.params` or `deploy.sh`; or manual | Applies the change to `app-dev`.                                                                                     |
| [`infra-stage.yml`](../../.github/workflows/infra-stage.yml) | the same for `stage` and `stage.params`                                              | Applies the change to `app-stage`.                                                                                   |
| [`infra-prod.yml`](../../.github/workflows/infra-prod.yml)   | manual, from `main`, for a branch or commit (default `stage`)                        | Previews the change to `app-prod`, waits for a `prod` reviewer who reads that preview, then applies it.              |

All of them run `infra/cloudformation/deploy.sh <env> plan|apply`, the same
command you can run locally:

- **The preview is a change set:** a list of each resource CloudFormation would add, modify or remove, and whether it would be **replaced**. `plan` discards it; `apply` executes it.
- **Dangerous replacements are refused.** `apply` won't replace the instance, the data volume or the Elastic IP, because that takes the server down or empties its disk. To allow it on purpose, run the workflow by hand with `allow_replacement`, or locally with `ALLOW_REPLACEMENT=true`.
- **GitHub never gets IAM-creating permission.** CloudFormation makes every change as the **execution role** in the bootstrap stack. That role may only manage IAM roles named after its own environment stacks. The roles GitHub assumes can only hand change sets to CloudFormation:
  - the **plan role** (pull requests, or `main` for prod) can create and discard change sets but never execute one;
  - one **apply role** per environment, trusted only from the GitHub environment of the same name.
- **Review infra PRs like an admin login.** Whatever a merged template asks for, the execution role builds. Keep `develop` and `stage` protected.
- **Bootstrap stacks are applied by hand.** They create these roles and the GitHub login itself, so `infra-plan.yml` only reminds you when a PR changes them.
- **Infra and app deploys run independently.** An infra change that restarts the instance, such as a resize, can fail an app deploy running at the same time; re-run it.

## Setting up the dev server

You need:

- AWS CLI **v2**, because v1 would fetch the contents of a `--value https://…` instead of storing the URL;
- to be signed in to the account as an administrator;
- a **region** close to your sellers.

Set the region once:

```sh
export AWS_REGION=ap-southeast-1   # example; pick yours
```

### 0. The `develop` and `stage` branches

Create both from `main` and push them. `develop` takes feature PRs and deploys
to dev. `stage` is fast-forwarded to `develop` when a build is ready for
stage. Protect both in **Settings → Branches** so changes go through PRs with
CI green.

### 1. Bootstrap stack (shared by dev and stage)

```sh
infra/cloudformation/deploy.sh bootstrap
```

Prefix it with `CREATE_OIDC_PROVIDER=false` if the account already has the
GitHub OIDC provider. Its outputs include the infra workflows' roles:
`InfraPlanRoleArn`, `InfraDevRoleArn` and `InfraStageRoleArn`. Prod's
bootstrap, `deploy.sh bootstrap-prod`, waits until prod is set up.

### 2. Dev environment stack

```sh
infra/cloudformation/deploy.sh dev
```

The first run stops and prints the current Amazon Linux 2023 AMI for your
region. Put it in `infra/cloudformation/environments/dev.params` as `ImageId=…`
(and `AlarmEmail=` if you want alarm emails), commit, and run it again. This
first creation is the only time you run it by hand; afterwards, changes to the
template or `dev.params` go through a PR and `infra-dev.yml`. It prints the
stack's outputs. Write down `PublicIp`, `InstanceId` and
`DeployRoleArn`, plus `ArtifactsBucketName` from the bootstrap output.

### 3. DNS at Namecheap

In **Domain List → socialglider.online → Manage → Advanced DNS**, add:

| Type     | Host  | Value        | TTL       |
| -------- | ----- | ------------ | --------- |
| A Record | `dev` | `<PublicIp>` | Automatic |

Check it with `dig +short dev.socialglider.online`. Caddy can't get a
certificate until this resolves, but the deploy itself doesn't wait for it.

### 4. The env file

All of an environment's settings live in **one** `SecureString`,
`/app/<env>/env`. It holds a normal `.env` file in the same format as
`apps/api/.env`, and the deploy writes it to the server as it is. Write it
locally, outside the repo, and upload it:

```sh
cat > ~/dev.env <<ENV
DOMAIN=dev.socialglider.online
POSTGRES_USER=app
POSTGRES_DB=app
POSTGRES_PASSWORD=$(openssl rand -hex 32)
APP_RUNTIME_PASSWORD=$(openssl rand -hex 32)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)
META_VERIFY_TOKEN=$(openssl rand -hex 24)
META_APP_SECRET=…
META_GRAPH_VERSION=v21.0
SMTP_URL=smtp://user:pass@smtp.provider.com:587
MAIL_FROM="Social Glider <no-reply@socialglider.online>"
STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
STORAGE_BUCKET=…
STORAGE_ACCESS_KEY_ID=…
STORAGE_SECRET_ACCESS_KEY=…
STORAGE_PUBLIC_BASE_URL=…
LLM_API_KEY=…
ENV

aws ssm put-parameter --name /app/dev/env --type SecureString \
  --value file://$HOME/dev.env --overwrite
```

Optional keys are the same as in `apps/api/.env.example`: `META_APP_ID`,
`GOOGLE_*`, `FACEBOOK_*`, `LOG_LEVEL`, `WORKER_CONCURRENCY` and `SENTRY_DSN`.
You don't need `DATABASE_URL`, `REDIS_URL` or `APP_URL`; `docker/compose.yml`
derives them.

Rules:

- **Database passwords:** use `openssl rand -hex`. They go into connection URLs unencoded.
- **Never change the database passwords.** `POSTGRES_PASSWORD` and `APP_RUNTIME_PASSWORD` are set before the first deploy and stay that way. Postgres reads them only when its data volume is empty; changing one later needs `ALTER ROLE` by hand.
- **Changes take effect on the next deploy.** To edit, fetch the file with `aws ssm get-parameter --name /app/dev/env --with-decryption --query Parameter.Value --output text`, change it, and upload it again.
- **Size limit:** a standard parameter holds 4 KB, far more than this file needs.
- **Delete the local copy** once it's uploaded.

### 5. GitHub

1. **Settings → Environments → New environment `dev`.** Under deployment branches, allow only `develop`.
2. In that environment, add these **variables** (not secrets; none of them is sensitive):

   | Variable              | Value                                   |
   | --------------------- | --------------------------------------- |
   | `AWS_DEPLOY_ROLE_ARN` | `DeployRoleArn` output                  |
   | `INSTANCE_ID`         | `InstanceId` output                     |
   | `ARTIFACTS_BUCKET`    | `ArtifactsBucketName` output, bootstrap |
   | `AWS_INFRA_ROLE_ARN`  | `InfraDevRoleArn` output, bootstrap     |

3. **Settings → Secrets and variables → Actions → Variables (repository):**

   | Variable                  | Value                                                                                 |
   | ------------------------- | ------------------------------------------------------------------------------------- |
   | `AWS_REGION`              | your region. Repository-level, because infra PR previews run outside any environment. |
   | `AWS_INFRA_PLAN_ROLE_ARN` | `InfraPlanRoleArn` output, bootstrap. Turns on the infra workflows for dev and stage. |
   | `DEV_DEPLOY_ENABLED`      | `true`. Turns on app deploys to dev.                                                  |

The next merge to `develop`, or a re-run of its latest CI run, deploys.

### 6. Outside AWS

- **Meta:** use a separate test app for dev. Its webhook URL is `https://dev.socialglider.online/api/v1/…` with `/app/dev/META_VERIFY_TOKEN`. Dev must never receive real Page traffic.
- **Google / Facebook login:** add `https://dev.socialglider.online` to the OAuth redirect and origin lists.

## Operating a server

| Task                  | How                                                                                                                                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell on the server   | `aws ssm start-session --target <InstanceId>` (needs the Session Manager plugin), then `sudo -i`.                                                                                                                                                                                                                           |
| Logs                  | CloudWatch Logs → `/app/<env>`, one stream per container. `aws logs tail /app/dev --follow`.                                                                                                                                                                                                                                |
| Redeploy a commit     | Re-run its deploy workflow run (or **Run workflow** on `deploy-dev.yml`), or on the server: `/opt/app/bin/deploy <full sha>`.                                                                                                                                                                                               |
| Compose on the server | `. /opt/app/infra/server/lib.sh && app_compose ps`                                                                                                                                                                                                                                                                          |
| Backup now            | `systemctl start app-backup.service`, then check `journalctl -u app-backup`.                                                                                                                                                                                                                                                |
| Restore drill         | Copy a dump from the backups bucket, `pg_restore` it into a scratch `postgres:17-alpine` container, and run `db:verify-rls` against it. Do this once before prod.                                                                                                                                                           |
| Resize                | In a PR to `develop`, change `InstanceType` in `dev.params` **and** the limits in `docker/compose.dev.yml`. The PR shows the preview, and merging applies both: the instance stops and starts, and data and IP stay.                                                                                                        |
| OS updates            | Patch in place: `dnf upgrade --releasever=latest`, then reboot. Do **not** bump `ImageId` to patch. A new AMI replaces the instance, which `deploy.sh` refuses by default, and CloudFormation would try to attach the data volume to the new instance while the old one still holds it, so the update fails and rolls back. |

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

The workflows already exist. What remains is the AWS and GitHub setup, the same
steps as dev with `stage` or `prod` in place of `dev`. Stage serves
`stage.socialglider.online` and prod serves the apex `socialglider.online`. The
domains are set in `stage.params` / `prod.params` and in the `url` of
`deploy-stage.yml` / `deploy-prod.yml`; change both together.

1. **Stage:** pin `ImageId` in `stage.params` and run `deploy.sh stage`. It uses the same `app-bootstrap` as dev.
2. **Prod:** run `deploy.sh bootstrap-prod` first, then pin `ImageId` in `prod.params` and run `deploy.sh prod`.
3. **Namecheap:** add the A records under Advanced DNS, each pointing at its stack's `PublicIp`:

   | Type     | Host    | Value                  | Serves                      |
   | -------- | ------- | ---------------------- | --------------------------- |
   | A Record | `stage` | `app-stage` `PublicIp` | `stage.socialglider.online` |
   | A Record | `@`     | `app-prod` `PublicIp`  | `socialglider.online`       |

   Namecheap's default records for a new domain include a parking-page record on `@`, and often a `www` CNAME. Remove them, or `@` will not resolve to the server. `www.socialglider.online` is not served; Caddy only answers for the domain in `DOMAIN`.

4. Upload `/app/stage/env` and `/app/prod/env`, as in step 4 of the dev setup.
5. Create the GitHub environments, each with the same four variables as dev, from its own stacks' outputs. `AWS_INFRA_ROLE_ARN` is `InfraStageRoleArn` from `app-bootstrap` for stage, and `InfraProdRoleArn` from `app-bootstrap-prod` for prod. For prod, `ARTIFACTS_BUCKET` also comes from `app-bootstrap-prod`.
   - `stage`: deployment branch `stage`.
   - `prod`: **required reviewers**, and two more variables, `ECR_API_REPOSITORY=app-prod-api` and `ECR_WEB_REPOSITORY=app-prod-web`. Run `deploy-prod.yml` from the default branch.
6. Set the repository variables `STAGE_DEPLOY_ENABLED` / `PROD_DEPLOY_ENABLED` to `true`, and `AWS_PROD_INFRA_PLAN_ROLE_ARN` to `InfraPlanRoleArn` from `app-bootstrap-prod`, which turns on `infra-prod.yml`.
7. Run the restore drill before prod takes real traffic.
