#!/usr/bin/env bash
set -euo pipefail
# Assumes the dedicated runtime SA, private Storage access, Auth role and secret
# have been provisioned as documented in docs/cloud-run.md.
PROJECT_ID="${PROJECT_ID:-vibecodingjapan}"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-ai-director}"
REPOSITORY="${REPOSITORY:-ai-director}"
SERVICE_ACCOUNT="ai-director-run@${PROJECT_ID}.iam.gserviceaccount.com"
: "${DEPLOY_ENV_FILE:?Set DEPLOY_ENV_FILE to the YAML runtime configuration file}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE}:$(date -u +%Y%m%d%H%M%S)"
CACHE_IMAGE="${CACHE_IMAGE:-$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(spec.template.spec.containers[0].image)' 2>/dev/null || true)}"
CACHE_IMAGE="${CACHE_IMAGE:-$IMAGE}"
gcloud builds submit --project "$PROJECT_ID" --region "$REGION" --config cloudbuild.yaml --substitutions "_IMAGE=$IMAGE,_CACHE_IMAGE=$CACHE_IMAGE" --quiet
gcloud run deploy "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --image "$IMAGE" \
  --service-account "$SERVICE_ACCOUNT" --env-vars-file "$DEPLOY_ENV_FILE" \
  --set-secrets AIAND_API_KEY=ai-director-aiand-key:latest \
  --port 8080 --memory 2Gi --cpu 2 --concurrency 8 --min-instances 0 --max-instances 1 \
  --cpu-throttling --timeout 1800 --execution-environment gen2 --allow-unauthenticated --quiet
