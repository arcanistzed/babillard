const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// ts-mls and @hpke reach these through import() only for cipher suites the MLS
// prototype doesn't use, or as a Node fallback. Metro resolves every import()
// at build time, so without this the bundle fails on packages that aren't installed.
const unreachable = new Set(["crypto", "@hpke/ml-kem", "@hpke/dhkem-x448", "@hpke/hybridkem-x-wing", "@noble/post-quantum/ml-dsa.js"]);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (unreachable.has(moduleName)) return { type: "empty" };
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
