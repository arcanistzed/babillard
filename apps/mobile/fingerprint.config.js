// Decides what counts as native code for over-the-air updates. An update only reaches installs with the
// same fingerprint, so anything listed here can change without cutting existing installs off from updates.
/** @type {import("expo/fingerprint").Config} */
module.exports = {
  // Version numbers and npm scripts don't change the native code.
  sourceSkips: ["ExpoConfigVersions", "ExpoConfigRuntimeVersionIfString", "PackageJsonAndroidAndIosScriptsIfNotContainRun", "PackageJsonScriptsAll"],
};
