// Manual mock for expo-image (auto-applied for all tests). The native image module
// isn't available under jest; render Image as an inert host element so components
// that show thumbnails mount and their testID is queryable, without loading images.
const React = require("react");

exports.Image = function ExpoImageMock(props) {
  return React.createElement("ExpoImageMock", props);
};
