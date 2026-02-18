/**
 * Validates that required environment variables are set for production.
 * Runs at server startup to fail fast rather than silently.
 */

export function validateProductionEnv() {
  const isProd = process.env.NODE_ENV === "production";

  if (!isProd) {
    // Development: skip validation
    return;
  }

  // Production: validate all required variables
  const errors: string[] = [];

  if (!process.env.DATABASE_URL) {
    errors.push("Missing DATABASE_URL in production");
  }

  if (!process.env.NODE_ENV) {
    errors.push("Missing NODE_ENV in production");
  }

  if (errors.length > 0) {
    console.error("❌ PRODUCTION ENVIRONMENT VALIDATION FAILED:");
    errors.forEach((err) => console.error(`   - ${err}`));
    throw new Error(
      `Production environment misconfigured. Missing: ${errors.join(", ")}`,
    );
  }

  console.log("✅ Production environment validated successfully (DATABASE_URL configured)");
}
