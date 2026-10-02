# Deployment: AWS, CloudFormation, GitHub Actions

Status: **dev server built, not yet provisioned**. The templates, server scripts
and workflows are in the repo; the account steps under
[Setting up the dev server](#setting-up-the-dev-server) have not been run.
**stage** and **prod** have their parameter files, compose overlays and
workflows, but no stack yet, so their workflows only test. When they land, update this page and the Hosting and CI/CD rows
of [`tech-stack.md`](tech-stack.md).

## Environments

| Environment | Compose                                                    | Stack (params)                                      | Domain                      | Deployed by                                                   |
| ----------- | ---------------------------------------------------------- | --------------------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| local       | `docker/compose.local.yml`: dependencies, apps on the host | none                                                | `localhost`                 | `pnpm dev:up`                                                 |
| dev         | `docker/compose.yml` + `docker/compose.dev.yml`            | `social-glider-dev` (`environments/dev.params`)     | `dev.socialglider.online`   | `deploy-dev.yml`: every merge to **`develop`**                |
| stage       | `docker/compose.yml` + `docker/compose.stage.yml`          | `social-glider-stage` (`environments/stage.params`) | `stage.socialglider.online` | `deploy-stage.yml`: every push to **`stage`**                 |
| prod        | `docker/compose.yml` + `docker/compose.prod.yml`           | `social-glider-prod` (`environments/prod.params`)   | `socialglider.online`       | `deploy-prod.yml`: manual, approved, a SHA already on `stage` |

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
the one Parameter Store entry `/social-glider/<env>/env`. `docker/compose.local.yml`, which was
`compose.dev.yml`, stays local-only.

## Shape

| Decision  | Choice                                                                                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hosting   | One EC2 instance per environment running the compose stack: Caddy, api, worker, Postgres, Redis. This keeps the low-cost principle in `tech-stack.md`.                                                                                                                                                                                     |
| Infra     | CloudFormation: [`bootstrap.yml`](../../infra/cloudformation/bootstrap.yml) shared by dev and stage, [`bootstrap-prod.yml`](../../infra/cloudformation/bootstrap-prod.yml) for prod alone, `environment.yml` once per environment.                                                                                                         |
| DNS       | Namecheap. Each stack outputs an Elastic IP and you add one A record by hand. Caddy gets the TLS certificate itself.                                                                                                                                                                                                                       |
| CI → AWS  | GitHub OIDC. No AWS keys are stored in GitHub. Each environment's deploy role trusts only the GitHub environment of the same name in this repository.                                                                                                                                                                                      |
| Deploy    | Images are built once, by dev or stage, and pushed to ECR tagged with the commit SHA; prod copies them into its own repositories rather than rebuilding. The server never builds and never clones; it pulls images and a small bundle (`docker/`, `static/`, `infra/server/`). The deploy runs over SSM Run Command, so port 22 is closed. |
| Secrets   | One SSM Parameter Store `SecureString` per environment, `/social-glider/<env>/env`, holding the whole env file. On each deploy the server writes it to `apps/api/.env` (mode 600), so that stays the only env file.                                                                                                                        |
| Unchanged | Cloudflare R2, the SMTP provider and the LLM provider are reached through env vars as today. Each environment gets its own R2 bucket and its own Meta app.                                                                                                                                                                                 |

```
GitHub Actions ──OIDC──▶ app-<env> deploy role
  │ build (dev, stage)         │ ssm:SendCommand (that instance only)
  │ or copy (prod)             │
  ▼                            ▼
ECR social-glider-api, social-glider-web ─────── copy ──▶ ECR social-glider-prod-api, social-glider-prod-web
  (social-glider-bootstrap)                       (social-glider-bootstrap-prod)
  ▲ pull: dev, stage                    ▲ pull: prod
EC2 app-<env> (Elastic IP; 80/443 open, no SSH)
  fetches its bundle from its bootstrap's S3 bucket
  runs compose.yml + compose.<env>.yml
                                Docker data on its own EBS volume
                                stage, prod only: daily snapshots,
                                  nightly pg_dump ──▶ S3 backups bucket,
                                  container logs  ──▶ CloudWatch /social-glider/<env>
```

## What each piece does

**`bootstrap.yml`** (stack `social-glider-bootstrap`) creates what dev and stage share:

- the GitHub OIDC provider;
- ECR repositories `social-glider-api` and `social-glider-web` (immutable tags, scan on push, keep 30 images);
- the artifacts bucket for deploy bundles, which expire after 30 days.

**`bootstrap-prod.yml`** (stack `social-glider-bootstrap-prod`) is prod's own copy, with
repositories `social-glider-prod-api` and `social-glider-prod-web` and its own bundle bucket. For
now it is a deliberate duplicate of `bootstrap.yml`, so prod can diverge later
without touching dev and stage. That could mean its own AWS account, or
stricter retention or scanning. Its `CreateOidcProvider` defaults to `false`
because, while prod shares the account, `social-glider-bootstrap` already created the
provider; set it to `true` if prod moves to an account of its own. In that
case the non-prod repositories also need a repository policy that lets prod's
account pull from them.

`prod.params` points prod at `social-glider-bootstrap-prod` (`BootstrapStackName`) and
names `social-glider-bootstrap` as `SourceBootstrapStackName`. That grants prod's deploy
role read access to the non-prod repositories so it can copy images out of
them.

**`environment.yml`** creates one environment:

- **Network:** its own VPC with one public subnet, and a security group open only on 80 and 443.
- **Instance:** EC2 with an Elastic IP. It is x86, to match the amd64 images CI builds.
  - It uses IMDSv2 with a hop limit of 1, so containers can't read the instance's AWS credentials.
  - Termination protection is on for `prod`.
- **Data volume:** a separate encrypted EBS volume holds Docker's data-root, so Postgres, Redis and Caddy's certificates outlive the instance. It carries `DeletionPolicy: Snapshot`, so deleting the stack leaves one final snapshot, in dev too.
- **Stage and prod only** (dev is disposable, so it gets none of these):
  - **Backups:** DLM takes daily snapshots of the data volume and keeps 7, and an S3 bucket receives the nightly `pg_dump`.
  - **Logs:** the log group `/social-glider/<env>`, kept 30 days in prod and 14 in stage. Docker's `awslogs` driver sends every container's output there. On dev, logs stay on the instance (Docker's `local` driver, rotated), readable with `app_compose logs`.
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

1. Write `apps/api/.env` from the one SecureString `/social-glider/<env>/env`, adding the commit's image tags.
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

| Workflow                                                       | Trigger                                                               | Does                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ci.yml`](../../.github/workflows/ci.yml)                     | every pull request; called by `deploy-dev.yml` and `deploy-stage.yml` | Checks only: lint, format, typecheck, migrate, test, RLS check, migration-drift check.                                                                                                                                                                                                   |
| [`deploy-dev.yml`](../../.github/workflows/deploy-dev.yml)     | push to `develop`, i.e. every merge                                   | `ci.yml`, then deploys the commit to dev, building its images.                                                                                                                                                                                                                           |
| [`deploy-stage.yml`](../../.github/workflows/deploy-stage.yml) | push to `stage`                                                       | `ci.yml`, then deploys the commit to stage. Fast-forward `stage` to `develop` and dev's images are reused; a merge commit is a new SHA and builds its own.                                                                                                                               |
| [`deploy-prod.yml`](../../.github/workflows/deploy-prod.yml)   | manual (**Run workflow** with a full SHA)                             | Checks the SHA is on `stage`, waits for a `prod` environment reviewer, then **copies** that SHA's images from `social-glider-api`/`social-glider-web` into `social-glider-prod-api`/`social-glider-prod-web` and deploys them. It never builds; if stage never had the images, it fails. |
| [`deploy.yml`](../../.github/workflows/deploy.yml) (reusable)  | called by the three above                                             | The procedure, listed below.                                                                                                                                                                                                                                                             |

Dev deploys on every push to `develop`. The stage and prod deploy jobs are
gated by a repository variable (`STAGE_DEPLOY_ENABLED`, `PROD_DEPLOY_ENABLED`)
that you set to `true` once that environment's stack exists. Until then its
workflow still tests the branch.
Deploys to one environment queue and are never cancelled, because a cancelled
deploy could stop halfway.

`deploy.yml` runs in the GitHub environment it was given, so it assumes that
environment's role with that environment's variables:

1. Get the images into this environment's repositories, which are `ECR_API_REPOSITORY`/`ECR_WEB_REPOSITORY` and default to `social-glider-api`/`social-glider-web`. Tags are immutable, so images that already exist are skipped.
   - With `images: build` (dev, stage), it builds what is missing.
   - With `images: promote` (prod), it copies the manifest from the non-prod repositories. The copy happens inside the registry, so the digest is the one stage ran.
2. Upload the bundle.
3. Run [`infra/ci/ssm-deploy.sh`](../../infra/ci/ssm-deploy.sh), which sends the SSM command, waits and prints its output.
4. `curl` the environment's `/health`.

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
GitHub OIDC provider. Prod's bootstrap, `deploy.sh bootstrap-prod`, waits until
prod is set up.

### 2. Dev environment stack

```sh
infra/cloudformation/deploy.sh dev
```

The first run stops and prints the current Amazon Linux 2023 AMI for your
region. Put it in `infra/cloudformation/environments/dev.params` as `ImageId=…`,
commit, and run it again. It
prints the stack's outputs. Write down `PublicIp`, `InstanceId` and
`DeployRoleArn`, plus `ArtifactsBucketName` from the bootstrap output.

### Steps 1–2 by hand, in the console

`deploy.sh` is only a wrapper around `aws cloudformation deploy`; you can skip
it and create both stacks in the AWS Console. Do this in the same region you
would have put in `AWS_REGION`: check the region selector at the top right
before each stack.

**Stack 1: bootstrap**

1. Open **CloudFormation → Stacks → Create stack → With new resources (standard)**.
2. **Specify template:** _Upload a template file_ → choose `infra/cloudformation/bootstrap.yml` → **Next**.
3. **Stack name:** exactly `social-glider-bootstrap`. The environment stacks look it up by this name (`BootstrapStackName`).
4. **Parameters:** leave `CreateOidcProvider` at `true`. Set it to `false` if the account already has the GitHub OIDC provider (**IAM → Identity providers**, `token.actions.githubusercontent.com`); a second one fails the stack.
5. **Next** through _Configure stack options_ with the defaults.
6. On the review page, tick **I acknowledge that AWS CloudFormation might create IAM resources**, then **Submit**.
7. Wait for `CREATE_COMPLETE` (a minute or two). Open the **Outputs** tab and note `ArtifactsBucketName`.

**Stack 2: dev environment**

1. Find the current Amazon Linux 2023 AMI for your region: **Systems Manager → Parameter Store**, open `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64` and copy its value (`ami-…`). Then open `infra/cloudformation/environments/dev.params`, set `ImageId=` to it, and commit. Skipping the commit leaves the file out of step with the stack.
2. **CloudFormation → Create stack → With new resources**, upload `infra/cloudformation/environment.yml`, **Next**.
3. **Stack name:** `social-glider-dev`.
4. **Parameters:** enter the values from `dev.params`:

   | Parameter           | Value                     |
   | ------------------- | ------------------------- |
   | `EnvName`           | `dev`                     |
   | `Domain`            | `dev.socialglider.online` |
   | `ImageId`           | the AMI from step 1       |
   | `InstanceType`      | `t3.small`                |
   | `DataVolumeSizeGiB` | `20`                      |

   Leave every other parameter at its default. In particular, keep
   `BootstrapStackName` as `social-glider-bootstrap`, leave
   `SourceBootstrapStackName` empty and don't touch `GitHubRepo`; it is the
   immutable-subject form `owner@id/name@id` and a plain `owner/name` makes
   every deploy fail with "Not authorized to perform sts:AssumeRoleWithWebIdentity".

5. **Next.** Under **Tags**, add key `social-glider:env`, value `dev`. Everything else stays at the defaults.
6. Tick the IAM acknowledgement and **Submit**.
7. Wait for `CREATE_COMPLETE` (about 5 minutes). If it ends in `ROLLBACK_COMPLETE`, read the **Events** tab for the first `CREATE_FAILED` row, delete the stack and create it again; a rolled-back stack can't be updated.
8. From the **Outputs** tab, note `PublicIp`, `InstanceId` and `DeployRoleArn`.

To change the stack later (for example a resize), open it, choose **Update →
Make a direct update → Replace existing template**, upload the current
`environment.yml`, adjust the parameters and submit. Keep `dev.params` in step
with what you entered.

For stage and prod, repeat the same steps with that environment's params file;
prod needs its own bootstrap first (`bootstrap-prod.yml`, stack name
`social-glider-bootstrap-prod`) and sets the two bootstrap parameters listed in
[Later: stage and prod](#later-stage-and-prod).

### 3. DNS at Namecheap

In **Domain List → socialglider.online → Manage → Advanced DNS**, add:

| Type     | Host  | Value        | TTL       |
| -------- | ----- | ------------ | --------- |
| A Record | `dev` | `<PublicIp>` | Automatic |

Check it with `dig +short dev.socialglider.online`. Caddy can't get a
certificate until this resolves, but the deploy itself doesn't wait for it.

### 4. The env file

All of an environment's settings live in **one** `SecureString`,
`/social-glider/<env>/env`. It holds a normal `.env` file in the same format as
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

aws ssm put-parameter --name /social-glider/dev/env --type SecureString \
  --value file://$HOME/dev.env --overwrite
```

Optional keys are the same as in `apps/api/.env.example`: `META_APP_ID`,
`GOOGLE_*`, `FACEBOOK_*`, `LOG_LEVEL`, `WORKER_CONCURRENCY` and `SENTRY_DSN`.
You don't need `DATABASE_URL`, `REDIS_URL` or `APP_URL`; `docker/compose.yml`
derives them.

Rules:

- **Database passwords:** use `openssl rand -hex`. They go into connection URLs unencoded.
- **Never change the database passwords.** `POSTGRES_PASSWORD` and `APP_RUNTIME_PASSWORD` are set before the first deploy and stay that way. Postgres reads them only when its data volume is empty; changing one later needs `ALTER ROLE` by hand.
- **Changes take effect on the next deploy.** To edit, fetch the file with `aws ssm get-parameter --name /social-glider/dev/env --with-decryption --query Parameter.Value --output text`, change it, and upload it again.
- **Size limit:** a standard parameter holds 4 KB, far more than this file needs.
- **Delete the local copy** once it's uploaded.

### 5. GitHub

1. **Settings → Environments → New environment `dev`.** Under deployment branches, allow only `develop`.
2. In that environment, add these **variables** (not secrets; none of them is sensitive):

   | Variable              | Value                                   |
   | --------------------- | --------------------------------------- |
   | `AWS_REGION`          | your region                             |
   | `AWS_DEPLOY_ROLE_ARN` | `DeployRoleArn` output                  |
   | `INSTANCE_ID`         | `InstanceId` output                     |
   | `ARTIFACTS_BUCKET`    | `ArtifactsBucketName` output, bootstrap |

The next merge to `develop`, or a re-run of its latest CI run, deploys.

### 6. Outside AWS

- **Meta:** use a separate test app for dev. Its webhook URL is `https://dev.socialglider.online/api/v1/…` and the `META_VERIFY_TOKEN` from dev's env file. Dev must never receive real Page traffic.
- **Google / Facebook login:** add `https://dev.socialglider.online` to the OAuth redirect and origin lists.

## Operating a server

| Task                  | How                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell on the server   | `aws ssm start-session --target <InstanceId>` (needs the Session Manager plugin), then `sudo -i`.                                                                                                                                                                                     |
| Logs                  | Stage and prod: CloudWatch Logs → `/social-glider/<env>`, one stream per container, e.g. `aws logs tail /social-glider/stage --follow`. Dev: on the server, `. /opt/app/infra/server/lib.sh && app_compose logs -f api`.                                                              |
| Redeploy a commit     | Re-run its deploy workflow run (or **Run workflow** on `deploy-dev.yml`), or on the server: `/opt/app/bin/deploy <full sha>`.                                                                                                                                                         |
| Compose on the server | `. /opt/app/infra/server/lib.sh && app_compose ps`                                                                                                                                                                                                                                    |
| Backup now            | Stage and prod: `systemctl start app-backup.service`, then check `journalctl -u app-backup`. Dev has no backups.                                                                                                                                                                      |
| Restore drill         | Copy a dump from the backups bucket, `pg_restore` it into a scratch `postgres:17-alpine` container, and run `db:verify-rls` against it. Do this once before prod.                                                                                                                     |
| Resize                | Change `InstanceType` in `<env>.params` **and** the limits in `docker/compose.<env>.yml`, then `deploy.sh <env>`. The instance stops and starts; data and IP stay.                                                                                                                    |
| OS updates            | Patch in place: `dnf upgrade --releasever=latest`, then reboot. Do **not** bump `ImageId` to patch. A new AMI replaces the instance, and CloudFormation would try to attach the data volume to the new instance while the old one still holds it, so the update fails and rolls back. |

## Rough monthly cost (us-east-1 on-demand; Asian regions run about 10–20% higher)

| Item                           | dev / stage (`t3.small`)       | prod (`t3.medium`, 40 GB) |
| ------------------------------ | ------------------------------ | ------------------------- |
| EC2                            | ~$15.20                        | ~$30.40                   |
| EBS root 20 GB + data, gp3     | ~$3.20                         | ~$4.80                    |
| Public IPv4 (Elastic IP)       | ~$3.65                         | ~$3.65                    |
| Snapshots, S3, ECR, CloudWatch | dev ~$0.50, stage ~$1–3        | ~$3–5                     |
| **Total**                      | **dev ~$22.50, stage ~$23–25** | **~$42–44**               |

Dev and stage can be stopped outside working hours. Their Elastic IP is still
billed while the instance is stopped.

## Later: stage and prod

The workflows already exist. What remains is the AWS and GitHub setup, the same
steps as dev with `stage` or `prod` in place of `dev`. Stage serves
`stage.socialglider.online` and prod serves the apex `socialglider.online`. The
domains are set in `stage.params` / `prod.params` and in the `url` of
`deploy-stage.yml` / `deploy-prod.yml`; change both together.

1. **Stage:** pin `ImageId` in `stage.params` and run `deploy.sh stage`. It uses the same `social-glider-bootstrap` as dev.
2. **Prod:** run `deploy.sh bootstrap-prod` first, then pin `ImageId` in `prod.params` and run `deploy.sh prod`.
3. **Namecheap:** add the A records under Advanced DNS, each pointing at its stack's `PublicIp`:

   | Type     | Host    | Value                            | Serves                      |
   | -------- | ------- | -------------------------------- | --------------------------- |
   | A Record | `stage` | `social-glider-stage` `PublicIp` | `stage.socialglider.online` |
   | A Record | `@`     | `social-glider-prod` `PublicIp`  | `socialglider.online`       |

   Namecheap's default records for a new domain include a parking-page record on `@`, and often a `www` CNAME. Remove them, or `@` will not resolve to the server. `www.socialglider.online` is not served; Caddy only answers for the domain in `DOMAIN`.

4. Upload `/social-glider/stage/env` and `/social-glider/prod/env`, as in step 4 of the dev setup.
5. Create the GitHub environments, each with the four variables from its own stacks' outputs. For prod, `ARTIFACTS_BUCKET` comes from `social-glider-bootstrap-prod`.
   - `stage`: deployment branch `stage`.
   - `prod`: **required reviewers**, and two more variables, `ECR_API_REPOSITORY=social-glider-prod-api` and `ECR_WEB_REPOSITORY=social-glider-prod-web`. Run `deploy-prod.yml` from the default branch.
6. Set `STAGE_DEPLOY_ENABLED` / `PROD_DEPLOY_ENABLED` to `true`.
7. Run the restore drill before prod takes real traffic.
