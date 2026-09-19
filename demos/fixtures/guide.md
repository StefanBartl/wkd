# Deploy guide

## Prerequisites

Install the CLI once and log in with your team account.

## Environments

| name | region | replicas | notes |
|---|---|---|---|
| staging | eu-central | 2 | reset nightly |
| production | eu-central | 6 | needs approval |
| canary | us-east | 1 | 5% of traffic |

### Secrets

Rotate them every 90 days; the CLI warns two weeks ahead.

## Rollback

Redeploy the previous tag. Data migrations are never rolled back.
