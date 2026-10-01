# Deployment: AWS, CloudFormation, GitHub Actions

Status: **dev server built, not yet provisioned**. The templates, server scripts
and CI job are in the repo. The AWS account steps under
[Setting up the dev server](#setting-up-the-dev-server) have not been run.
Production is deferred: it reuses the same template with `EnvName=production`.
When it lands, update this page and the Hosting and CI/CD rows of
[`tech-stack.md`](tech-stack.md).

## Shape

| Decision     | Choice                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hosting      | One EC2 instance per environment running [`docker/compose.yml`](../../docker/compose.yml): Caddy, api, worker, Postgres, Redis. This keeps the low-cost principle in `tech-stack.md`.                                                                        |
| Environments | **dev** at `dev.socialglider.online` now. Every push to `main` deploys there. **production** comes later from the same template.                                                                                                                             |
| Infra        | CloudFormation: [`bootstrap.yml`](../../infra/cloudformation/bootstrap.yml) once per account, [`environment.yml`](../../infra/cloudformation/environment.yml) once per environment.                                                                          |
| DNS          | Namecheap. The stack outputs an Elastic IP and you add one A record by hand. Caddy gets the TLS certificate itself.                                                                                                                                          |
| CI → AWS     | GitHub OIDC. No AWS keys are stored in GitHub. The deploy role trusts only this repository's `dev` GitHub environment.                                                                                                                                       |
| Deploy       | Images are built once in CI and pushed to ECR, tagged with the commit SHA. The server never builds and never clones; it pulls images and a small bundle (`docker/`, `static/`, `infra/server/`). The deploy runs over SSM Run Command, so port 22 is closed. |
| Secrets      | SSM Parameter Store `SecureString` under `/app/dev/`. On each deploy the server renders `apps/api/.env` (mode 600) from them, so it stays the only env file.                                                                                                 |
| Unchanged    | Cloudflare R2, the SMTP provider and the LLM provider are reached through env vars as today.                                                                                                                                                                 |

```
GitHub Actions ──OIDC──▶ app-dev deploy role
  │ build, push                │ ssm:SendCommand (this instance only)
  ▼                            ▼
ECR app-api, app-web ◀─pull── EC2 app-dev (Elastic IP; 80/443 open, no SSH)
S3 artifacts/bundles ◀─fetch─   compose: caddy · api · worker · postgres · redis
                                Docker data on its own EBS volume (daily snapshots)
                                nightly pg_dump ──▶ S3 backups bucket
                                container logs  ──▶ CloudWatch /app/dev
```

## What each piece does

**`infra/cloudformation/bootstrap.yml`** creates the account-wide pieces:

- the GitHub OIDC provider;
- ECR repositories `app-api` and `app-web` (immutable tags, scan on push, keep 30 images);
- the artifacts bucket for deploy bundles, which expire after 30 days.

**`infra/cloudformation/environment.yml`** creates one environment:

- **Network:** its own VPC with one public subnet, and a security group open only on 80 and 443.
- **Instance:** EC2 (default `t3.small`, x86 to match the amd64 images CI builds) with an Elastic IP.
  - It uses IMDSv2 with a hop limit of 1, so containers can't read the instance's AWS credentials.
  - The AMI is a **pinned parameter**. A changed AMI makes CloudFormation replace the instance.
- **Data volume:** a separate encrypted EBS volume holds Docker's data-root, so Postgres, Redis and Caddy's certificates outlive any instance replacement.
  - It carries `DeletionPolicy: Snapshot`.
  - DLM takes daily snapshots and keeps 7.
- **Backups:** an S3 bucket for the nightly `pg_dump`, kept 14 days.
- **Monitoring:**
  - The CloudWatch log group `/app/dev`. Docker's `awslogs` driver sends every container's output there.
  - An alarm that auto-recovers the instance, and optional alarm emails.
- **Parameters:** the String parameters `DOMAIN`, `POSTGRES_USER` and `POSTGRES_DB`.
- **Deploy role:** the GitHub deploy role, scoped to these two repositories, the bundle prefix, and `ssm:SendCommand` on this one instance.

UserData runs only at first boot. It mounts the volume, installs Docker and
the compose plugin, and writes `/opt/app/bin/deploy`. Everything that changes
later ships in the bundle, so it is reviewed with the code.

**`infra/server/deploy.sh`** runs on the server for each commit:

1. Render `apps/api/.env` from `/app/dev/*`. Fail if a required value is missing, or if a database password is not URL-safe.
2. Log in to ECR and `docker compose pull`.
3. Run migrations as the owner (`scripts/migrate.mjs`) while the old release is still serving.
4. `up -d --no-build`, then wait up to 3 minutes for the api healthcheck and for the worker to be running.
5. On failure, print the logs, start the previous release's images again and exit non-zero, which turns the CI job red. On success, point `/opt/app/current` at the release, install the backup timer, and keep the last three releases.

**Rollback restores images, never the database.** A migration must therefore
work with the previous release still running: add first, remove in a later
release. Recreating the api container costs a few seconds of 502s per deploy.
Meta retries webhook deliveries, so that is fine for dev and for the pilot.

**CI** (`deploy-dev` in [`ci.yml`](../../.github/workflows/ci.yml)) runs after
`test` on pushes to `main`, once the repository variable `DEV_DEPLOY_ENABLED`
is `true`:

1. Assume the role and build and push both images, skipping any already in ECR because tags are immutable.
2. Upload the bundle.
3. Run [`infra/ci/ssm-deploy.sh`](../../infra/ci/ssm-deploy.sh), which sends the SSM command, waits and prints its output.
4. `curl` `https://dev.socialglider.online/health`.

The workflow no longer cancels `main` runs on a newer push, because that could
cut a deploy off halfway.

## Setting up the dev server

You need AWS CLI **v2** (v1 would fetch the contents of a `--value https://…`
instead of storing the URL), signed in to the account as an administrator, and a
**region** chosen. Pick one close to your sellers and use it for every command
below. Set it once:

```sh
export AWS_REGION=ap-southeast-1   # example; pick yours
```

### 1. Bootstrap stack (once per account)

```sh
aws cloudformation deploy --stack-name app-bootstrap \
  --template-file infra/cloudformation/bootstrap.yml \
  --capabilities CAPABILITY_IAM
```

Pass `--parameter-overrides CreateOidcProvider=false` if the account already
has the GitHub OIDC provider.

### 2. Dev environment stack

```sh
AMI=$(aws ssm get-parameter \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query Parameter.Value --output text)

aws cloudformation deploy --stack-name app-dev \
  --template-file infra/cloudformation/environment.yml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides EnvName=dev Domain=dev.socialglider.online \
    ImageId="$AMI" AlarmEmail=you@example.com

aws cloudformation describe-stacks --stack-name app-dev \
  --query 'Stacks[0].Outputs' --output table
```

Write down `PublicIp`, `InstanceId` and `DeployRoleArn`, and `ArtifactsBucketName`
from the `app-bootstrap` stack.

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
put STORAGE_BUCKET        '…'      # a dev bucket, never production's
put STORAGE_ACCESS_KEY_ID '…'
put STORAGE_SECRET_ACCESS_KEY '…'
put STORAGE_PUBLIC_BASE_URL '…'
put LLM_API_KEY           '…'
# Optional: META_APP_ID, GOOGLE_CLIENT_ID/SECRET, FACEBOOK_CLIENT_ID/SECRET,
# LOG_LEVEL, SENTRY_DSN
```

Rules:

- Values may not contain a single quote or a newline. The deploy refuses them.
- `POSTGRES_PASSWORD` and `APP_RUNTIME_PASSWORD` are set **before the first deploy and never changed afterwards**. Postgres reads them only when its data volume is empty; changing one later needs `ALTER ROLE` by hand.
- A secret change takes effect on the next deploy.

### 5. GitHub

1. **Settings → Environments → New environment `dev`.** Optionally limit deployment branches to `main`.
2. In that environment, add these **variables** (not secrets; none of them is sensitive):

   | Variable              | Value                                   |
   | --------------------- | --------------------------------------- |
   | `AWS_REGION`          | your region                             |
   | `AWS_DEPLOY_ROLE_ARN` | `DeployRoleArn` output                  |
   | `INSTANCE_ID`         | `InstanceId` output                     |
   | `ARTIFACTS_BUCKET`    | `ArtifactsBucketName` output, bootstrap |

3. **Settings → Secrets and variables → Actions → Variables (repository):** `DEV_DEPLOY_ENABLED` = `true`.

The next push to `main`, or a re-run of the latest `main` CI run, deploys.

### 6. Outside AWS

- **Meta:** use a separate test app, or the dev app, for dev. Its webhook URL is `https://dev.socialglider.online/api/v1/…` with `/app/dev/META_VERIFY_TOKEN`. Dev must never receive real Page traffic.
- **Google / Facebook login:** add `https://dev.socialglider.online` to the OAuth redirect and origin lists.

## Operating the dev server

| Task                       | How                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell on the server        | `aws ssm start-session --target <InstanceId>` (needs the Session Manager plugin), then `sudo -i`.                                                                       |
| Logs                       | CloudWatch Logs → `/app/dev`, one stream per container. `aws logs tail /app/dev --follow`.                                                                              |
| Redeploy a commit          | Re-run its `main` CI run, or on the server: `/opt/app/bin/deploy <full sha>`.                                                                                           |
| Compose on the server      | `cd /opt/app/current && docker compose --env-file apps/api/.env -f docker/compose.yml ps`                                                                               |
| Backup now                 | `systemctl start app-backup.service`, then check `journalctl -u app-backup`.                                                                                            |
| Restore drill              | Copy a dump from the backups bucket, `pg_restore` it into a scratch `postgres:17-alpine` container, and run `db:verify-rls` against it. Do this once before production. |
| Change instance size, etc. | Edit parameters and re-run step 2. Changing `ImageId` **replaces** the instance; the data volume survives and is reattached.                                            |

## Rough monthly cost (dev, us-east-1 on-demand; Asian regions run about 10–20% higher)

| Item                              | Cost        |
| --------------------------------- | ----------- |
| EC2 `t3.small`                    | ~$15.20     |
| EBS: 20 GB root + 20 GB data, gp3 | ~$3.20      |
| Public IPv4 (Elastic IP)          | ~$3.65      |
| Snapshots, S3, ECR, CloudWatch    | ~$1–3       |
| **Total**                         | **~$23–25** |

Stopping the instance outside working hours cuts the EC2 line. The data volume
and IP stay, and the IP is still billed while the instance is stopped.

## Later: production

1. Deploy `environment.yml` again as stack `app-production` with `EnvName=production`. That turns on termination protection and 30-day log retention.
2. Add a `production` GitHub environment with required reviewers.
3. Add a `deploy-production` job that `needs: deploy-dev` and reuses the same image tags, never rebuilding.
4. Use a size of `t3.medium` or larger.
5. Run the restore drill first.
