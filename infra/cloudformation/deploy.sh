#!/bin/bash
# Creates or updates one CloudFormation stack from the repository:
#   infra/cloudformation/deploy.sh bootstrap       # once per account, first
#   infra/cloudformation/deploy.sh dev|stage|prod  # environment.yml + environments/<env>.params
#
# Needs AWS CLI v2 signed in to the account, and AWS_REGION set.
set -euo pipefail

target="${1:-}"
dir="$(cd "$(dirname "$0")" && pwd)"
: "${AWS_REGION:?set AWS_REGION to the region the stacks live in}"

outputs() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
}

case "$target" in
  bootstrap)
    aws cloudformation deploy --stack-name app-bootstrap \
      --template-file "$dir/bootstrap.yml" \
      --capabilities CAPABILITY_IAM \
      --no-fail-on-empty-changeset \
      ${CREATE_OIDC_PROVIDER:+--parameter-overrides CreateOidcProvider="$CREATE_OIDC_PROVIDER"}
    outputs app-bootstrap
    ;;
  dev | stage | prod)
    params="$dir/environments/$target.params"
    mapfile -t overrides < <(grep -Ev '^[[:space:]]*(#|$)' "$params")

    if ! printf '%s\n' "${overrides[@]}" | grep -qx "EnvName=$target"; then
      echo "$params must set EnvName=$target" >&2
      exit 1
    fi
    if ! printf '%s\n' "${overrides[@]}" | grep -q '^ImageId=ami-'; then
      latest="$(aws ssm get-parameter \
        --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
        --query Parameter.Value --output text)"
      echo "ImageId is not pinned in $params. The current Amazon Linux 2023 AMI in" >&2
      echo "$AWS_REGION is $latest - set ImageId=$latest there, commit it, and re-run." >&2
      exit 1
    fi
    # CloudFormation rejects an empty value for a String parameter on the
    # command line; leaving it out keeps the template default instead.
    mapfile -t overrides < <(printf '%s\n' "${overrides[@]}" | grep -v '=$')

    aws cloudformation deploy --stack-name "app-$target" \
      --template-file "$dir/environment.yml" \
      --capabilities CAPABILITY_IAM \
      --no-fail-on-empty-changeset \
      --tags "app:env=$target" \
      --parameter-overrides "${overrides[@]}"
    outputs "app-$target"
    ;;
  *)
    echo "usage: $0 bootstrap|dev|stage|prod" >&2
    exit 2
    ;;
esac
