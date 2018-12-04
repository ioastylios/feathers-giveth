/* eslint-disable import/no-extraneous-dependencies, prefer-destructuring */
const startRSKNetwork = require('./startRSKNetwork');
const logger = require('winston');

const BLOCK_TIME = 5;

let rsk;

const start = async () => {
  rsk = await startRSKNetwork(BLOCK_TIME);
  await rsk.waitForStart();
  logger.level = 'debug';
};

process.on('SIGINT', () => {
  if (rsk) {
    console.log('RSK: shutting down...')
    rsk.close();
  }
  process.exit();
});

start();
