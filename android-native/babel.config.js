module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // VisionCamera V5 usa react-native-worklets (não worklets-core).
    plugins: ['react-native-worklets/plugin'],
  };
};
