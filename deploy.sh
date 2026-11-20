#!/usr/bin/env bash
# 在任意目录运行本文件，即可重新部署当前项目。无需本地 Docker 或临时配置文件。
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PROJECT_ID="${PROJECT_ID:-vibecodingjapan}"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-ai-director}"
REPOSITORY="${REPOSITORY:-ai-director}"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  printf '运行：./deploy.sh\n默认部署：%s / %s / %s\n复用线上配置，空闲缩容到 0。首次使用新电脑需先安装 gcloud 并执行 gcloud auth login。\n' "$PROJECT_ID" "$REGION" "$SERVICE"
  exit 0
fi
if [[ $# -ne 0 ]]; then
  printf '不需要传参数，直接运行 ./deploy.sh 即可。\n' >&2
  exit 1
fi

trap 'code=$?; printf "部署未完成（第 %s 行，退出码 %s），请查看上方错误。\n" "$LINENO" "$code" >&2; exit "$code"' ERR

if ! command -v gcloud >/dev/null 2>&1; then
  printf '请先安装 Google Cloud CLI：https://cloud.google.com/sdk/docs/install\n' >&2
  exit 1
fi
if [[ -z "$(gcloud auth list --filter=status:ACTIVE --format='value(account)')" ]]; then
  printf '请先执行 gcloud auth login，登录后再次运行 ./deploy.sh。\n' >&2
  exit 1
fi

printf '\n[1/3] 读取 %s 的线上配置…\n' "$SERVICE"
# 先验证现有服务可访问；只更新镜像和缩容设置，保留环境变量、密钥、IAM 和服务账号。
# 不把读取失败当成首次部署，避免意外创建缺少鉴权配置的服务。
CACHE_IMAGE="$(gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].image)')"
if [[ -z "$CACHE_IMAGE" ]]; then
  printf '没有找到已配置的服务镜像，请检查项目、区域和服务名。\n' >&2
  exit 1
fi
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE}:release-$(date -u +%Y%m%d%H%M%S)"

printf '\n[2/3] 在 Cloud Build 构建并上传当前代码…\n'
gcloud builds submit "$ROOT" --project "$PROJECT_ID" --region "$REGION" \
  --config "$ROOT/cloudbuild.yaml" \
  --substitutions "_IMAGE=$IMAGE,_CACHE_IMAGE=$CACHE_IMAGE" --quiet

printf '\n[3/3] 发布到 Cloud Run（最小实例数 0，按请求计费）…\n'
gcloud run services update "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --image "$IMAGE" --min 0 --min-instances 0 --cpu-throttling --quiet

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
if [[ -z "$URL" ]]; then
  printf '服务已更新，但未能读取访问地址，请检查 Cloud Run 控制台。\n' >&2
  exit 1
fi
if command -v curl >/dev/null 2>&1; then
  printf '\n检查健康状态…\n'
  curl --fail --silent --show-error --max-time 60 --retry 3 --retry-delay 2 "$URL/api/health"
  printf '\n'
fi
printf '\n部署完成：%s\n' "$URL"
