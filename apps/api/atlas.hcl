// Atlas is the only tool that changes the schema. db/schema.sql is the desired
// state; migrations are generated from it, linted, reviewed, then applied.
//
//   pnpm --filter api db:diff  -- <name>
//   pnpm --filter api db:lint
//   pnpm --filter api db:apply

variable "database_url" {
  type    = string
  default = getenv("DATABASE_URL")
}

env "local" {
  src = "file://db/schema.sql"
  url = var.database_url
  // Atlas needs a throwaway database to realize the desired state. Docker is
  // therefore required locally and in CI.
  dev = "docker://postgres/17/dev?search_path=public"

  migration {
    dir = "file://db/migrations"
  }

  format {
    migrate {
      diff = "{{ sql . \"  \" }}"
    }
  }
}

env "ci" {
  src = "file://db/schema.sql"
  url = getenv("DATABASE_URL")
  dev = "docker://postgres/17/dev?search_path=public"

  migration {
    dir = "file://db/migrations"
  }
}
