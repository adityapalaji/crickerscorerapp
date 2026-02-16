#!/bin/bash
# Simplified Vercel Deployment Checklist

echo "🚀 Cricket Score Live - Vercel Deployment Checklist"
echo "===================================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_pass() {
  echo -e "${GREEN}✓${NC} $1"
}

check_fail() {
  echo -e "${RED}✗${NC} $1"
}

check_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

echo "STEP 1: Pre-deployment Verification"
echo "-----------------------------------"

# Check no vite config
if [ ! -f "vite.config.ts" ]; then
  check_pass "No Vite config conflict"
else
  check_fail "vite.config.ts exists - should be deleted"
  exit 1
fi

# Check build works
echo "Building..."
if npm run build > /dev/null 2>&1; then
  check_pass "Next.js build succeeds"
else
  check_fail "Build failed - fix errors before deploying"
  exit 1
fi

# Check environment
if grep -q "NODE_ENV" .env.production.example 2>/dev/null; then
  check_pass ".env.production.example documented"
else
  check_warn "Missing .env.production.example"
fi

echo ""
echo "STEP 2: Vercel Configuration"
echo "-----------------------------"
echo ""
echo "Set these in Vercel Project Settings → Environment Variables:"
echo "  • KV_REST_API_URL=<from Vercel Storage → KV>"
echo "  • KV_REST_API_TOKEN=<from Vercel Storage → KV>"
echo "  • NODE_ENV=production"
echo "  • NEXT_PUBLIC_APP_ORIGIN=https://your-domain.com (optional)"
echo ""

echo "STEP 3: Build & Deployment Settings"
echo "------------------------------------"
echo "  • Framework: Next.js"
echo "  • Root Directory: client/"
echo "  • Build Command: npm run build"
echo "  • Output Directory: .next"
echo "  • Install Command: npm install"
echo ""

echo "STEP 4: Post-Deployment Verification"
echo "-------------------------------------"
echo ""
echo "Run these commands after deploying:"
echo "  1. curl https://your-domain.com/api/health"
echo "     Expected: { \"ok\": true, \"kv\": { \"ok\": true } }"
echo ""
echo "  2. Test in browser:"
echo "     - Create new match"
echo "     - Record some matches"
echo "     - Refresh page - verify data persists"
echo "     - Open viewer link in different browser"
echo "     - Verify viewer updates in real-time"
echo ""

echo "STEP 5: Monitoring"
echo "------------------"
echo "  • Monitor KV usage in Vercel Dashboard"
echo "  • Health check: GET /api/health (every 60s during match)"
echo "  • Check build logs for warnings"
echo ""

echo -e "${GREEN}✅ Ready to Deploy!${NC}"
echo ""
echo "Next: git push to main and watch Vercel deployment"
