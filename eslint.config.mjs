import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  // Carried over from .eslintrc.json's ignorePatterns. worker/ is the
  // Cloudflare Durable Object, deployed separately via `versus:deploy` and
  // outside the Next build; scripts/ are standalone .mjs utilities.
  {
    ignores: ["worker/**", "scripts/**", ".next/**", "out/**", "next-env.d.ts"],
  },
  // eslint-config-next 16 ships flat config natively and exports an array, so
  // it is spread directly rather than wrapped in FlatCompat.
  ...nextCoreWebVitals,
];

export default config;
