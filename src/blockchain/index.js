const failedTxMonitor = require('./failedTxMonitor');
const pledgeNormalizer = require('./normalizer');
const eventWatcher = require('./watcher');
const eventHandler = require('./lib/eventHandler');
const { getWeb3 } = require('./lib/web3Helpers');

module.exports = function init() {
  const app = this;

  // const web3 = getWeb3(app);
  app.getWeb3 = getWeb3.bind(null, app);

  // initialize the event listeners
  const handler = eventHandler(app);

  const normalizer = pledgeNormalizer(app);
  normalizer.start();

  const watcher = eventWatcher(app, handler);
  watcher.start();

  const txMonitor = failedTxMonitor(app, watcher);
  txMonitor.start();
};
