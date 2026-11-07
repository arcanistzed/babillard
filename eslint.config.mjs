// Covers the API and shared rules. The app has its own config, built on Expo's.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["apps/mobile/**", "**/node_modules/**", "**/.wrangler/**", "apps/api/worker-configuration.d.ts", "apps/api/drizzle/**"] },
  ...tseslint.configs.recommended,
  { rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-non-null-assertion": "off" } },
);
