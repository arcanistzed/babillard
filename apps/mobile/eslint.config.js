const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  { ignores: ["android/**", "ios/**", "dist/**", ".expo/**"] },
  {
    rules: {
      // Apostrophes are ordinary text in React Native. There's no HTML to escape.
      "react/no-unescaped-entities": "off",
      // Reanimated's shared values are written to by design, which this rule can't tell apart from mutating props.
      "react-hooks/immutability": "off",
      // TypeScript already checks these, and this rule misreads expo-notifications' exports.
      "import/namespace": "off",
    },
  },
]);
