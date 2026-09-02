import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  // Carried over from .eslintrc.json's ignorePatterns. worker/ is the
  // Cloudflare Durable Object, deployed separately via `versus:deploy` and
  // outside the Next build; scripts/ are standalone .mjs utilities.
  {
    ignores: ["worker/**", "scripts/**", ".next/**", "out/**", "next-env.d.ts"],
  },
  // eslint-config-next 16 ships flat config natively and exports an array, so
  // it is spread directly rather than wrapped in FlatCompat.
  ...nextCoreWebVitals,
  {
    rules: {
      // Both rules are new in eslint-plugin-react-hooks 7, which arrived with
      // eslint-config-next 16. They flag patterns that predate this upgrade
      // and are unchanged by it -- 9 set-state-in-effect sites and one ref
      // write during render in TraceStrip.tsx:60.
      //
      // They are warnings rather than errors because fixing them properly
      // means restructuring effect and ref flow inside the canvas game
      // components, which have no test coverage at all. That is a behaviour
      // change and belongs in its own pass, not in a framework upgrade.
      // Kept visible rather than disabled so the work is not forgotten.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
];
