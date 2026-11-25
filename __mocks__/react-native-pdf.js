const React = require("react");
let lastProps = null;
function Pdf(props) { lastProps = props; return null; }
Pdf.getLastProps = () => lastProps;
module.exports = Pdf;
module.exports.default = Pdf;
