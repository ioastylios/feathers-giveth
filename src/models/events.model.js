// events-model.js - A mongoose model
const EventStatus = {
  WAITING: 'Waiting',
  PROCESSING: 'Processing',
  PROCESSED: 'Processed',
  FAILED: 'Failed',
};
//
// See http://mongoosejs.com/docs/models.html
// for more of what you can do here.
function createModel(app) {
  const mongooseClient = app.get('mongooseClient');
  const { Schema } = mongooseClient;
  const event = new Schema(
    {
      logIndex: { type: Number, required: true },
      transactionIndex: { type: Number, required: true },
      transactionHash: { type: String, required: true },
      blockHash: { type: String, required: true },
      blockNumber: { type: Number, required: true },
      address: { type: String, required: true },
      type: { type: String },
      id: { type: String, required: true },
      returnValues: { type: Object },
      event: { type: String },
      signature: { type: String },
      raw: { type: Object },
      topics: [String],
      status: {
        type: String,
        require: true,
        enum: Object.values(EventStatus),
        default: EventStatus.WAITING,
      },
      processingError: { type: String },
      confirmations: { type: Number, require: true, min: 0 },
    },
    {
      timestamps: true,
    },
  );

  // Ensuring there aren't any duplicate events, probably test on blockNumber and logIndex would suffice
  event.index({ blockNumber: 1, logIndex: 1, transactionHash: 1 }, { unique: true });

  return mongooseClient.model('event', event);
}

module.exports = {
  createModel,
  EventStatus,
};
