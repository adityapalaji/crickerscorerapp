#!/bin/bash
# Pre-deployment verification script for Vercel KV

set -e

echo "🔍 Production Readiness Audit"
echo "=============================="
echo ""

# Check environment variables
echo "✓ Checking required environment variables..."
if [ -z "$KV_REST_API_URL" ]; then
  echo "❌ FAIL: KV_REST_API_URL not set"
  exit 1
fi
if [ -z "$KV_REST_API_TOKEN" ]; then
  echo "❌ FAIL: KV_REST_API_TOKEN not set"
  exit 1
fi
echo "✓ KV environment variables configured"
echo ""

# Check for dev-only code
echo "✓ Checking for development-only code..."
if grep -r "console\\.log\\|console\\.error\\|console\\.warn" src --include="*.tsx" --include="*.ts" | grep -v "node_modules" | grep -v ".next"; then
  echo "❌ FAIL: Found console statements in source code"
  exit 1
fi
echo "✓ No console statements in source code"
echo ""

if grep -r "localStorage\\|sessionStorage\\|window.__" src --include="*.tsx" --include="*.ts" | grep -v "node_modules"; then
  echo "❌ FAIL: Found localStorage/sessionStorage references"
  exit 1
fi
echo "✓ No localStorage/sessionStorage usage"
echo ""

# Check for vite.config
if [ -f "vite.config.ts" ]; then
  echo "❌ FAIL: vite.config.ts found - should not exist in Next.js project"
  exit 1
fi
echo "✓ No Vite configuration conflicts"
echo ""

# Check package.json for vite dependencies
if grep -q "@vitejs/plugin-react\\|vite-tsconfig-paths" package.json; then
  echo "❌ FAIL: Found Vite dependencies in package.json"
  exit 1
fi
echo "✓ No Vite dependencies in package.json"
echo ""

echo "✅ All pre-deployment checks passed!"
echo ""
echo "Next steps:"
echo "1. Set KV_REST_API_URL and KV_REST_API_TOKEN in Vercel project settings"
echo "2. Run: npm install (to remove Vite packages)"
echo "3. Run: npm run build"
echo "4. Deploy to Vercel"
