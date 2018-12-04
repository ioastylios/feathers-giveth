const mongoose = require('mongoose');
const config = require('../../config/rsk.json')
const Confirm = require('prompt-confirm');
const rimraf = require('rimraf');

const mongoUrl = config.mongodb;

new Confirm('Drop RSK database?').run().then(reset => {
  if (reset) {
    // remove blockchain db
    rimraf.sync('./data/ganache-cli/rsk');

    mongoose.connect(mongoUrl);
    const db = mongoose.connection;

    db.on('error', err => {
      console.error('Could not connect to Mongo', err);
      process.exit();
    });

    // once mongo connected, start migration
    db.once('open', () => {
      console.log('Connected to Mongo');

      db.dropDatabase().then(res => {
        console.log('database dropped');
        process.exit();
      });
    });
  }
});
