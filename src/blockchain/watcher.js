const { LiquidPledging, LPVault, Kernel } = require('giveth-liquidpledging');
const { LPPCappedMilestone } = require('lpp-capped-milestone');
const { keccak256, padLeft, toHex } = require('web3-utils');
const logger = require('winston');

const processingQueue = require('../utils/processingQueue');
const to = require('../utils/to');
const { removeHexPrefix } = require('./lib/web3Helpers');
const { EventStatus } = require('../models/events.model');
const { DonationStatus } = require('../models/donations.model');

/**
 * get the last block that we have gotten logs from
 *
 * @param {object} app feathers app instance
 */
const getLastBlock = async app => {
  const opts = {
    paginate: false,
    query: {
      $limit: 1,
      $sort: {
        blockNumber: -1,
      },
    },
  };

  const [err, events] = await to(app.service('events').find(opts));

  if (err) logger.error('Error fetching events');

  if (events && events.length > 0) return events[0].blockNumber;

  // default to blockchain.startingBlock in config
  const { startingBlock } = app.get('blockchain');
  return startingBlock || 0;
};

/**
 * fetch any events that have a status `Waiting` of `Processing
 * @param {object} eventsService feathersjs `events` service
 * @returns {array} events sorted by transactionHash & logIndex
 */
async function getUnProcessedEvents(eventsService) {
  // all unprocessed events sorted by txHash & logIndex
  const query = {
    status: { $in: [EventStatus.WAITING, EventStatus.PROCESSING] },
    $sort: { blockNumber: 1, transactionIndex: 1, transactionHash: 1, logIndex: 1 },
  };
  return eventsService.find({ paginate: false, query });
}

/**
 * factory function for generating an event watcher
 *
 * @param {object} app feathersjs app instance
 * @param {object} eventHandler eventHandler instance
 */
const watcher = (app, eventHandler) => {
  const web3 = app.getWeb3();
  const requiredConfirmations = app.get('blockchain').requiredConfirmations || 0;
  const queue = processingQueue('NewEventQueue');
  const eventService = app.service('events');

  const { vaultAddress } = app.get('blockchain');
  const lpVault = new LPVault(web3, vaultAddress);
  let kernel;

  let lastBlock = 0;

  function setLastBlock(blockNumber) {
    if (blockNumber > lastBlock) lastBlock = blockNumber;
  }

  /**
   * Here we save the event so that they can be processed
   * later after waiting for x number of confirmations (defined in config).
   *
   * @param {object} event the web3 log to process
   * @param {boolean} isReprocess are we reprocessing the event?
   */
  async function processNewEvent(event, isReprocess = false) {
    const { logIndex, transactionHash } = event;

    logger.info('processNewEvent called', event.id);
    const data = await eventService.find({ paginate: false, query: { logIndex, transactionHash } });

    if (!isReprocess && data.some(e => e.status !== EventStatus.WAITING)) {
      logger.error(
        'RE-ORG ERROR: attempting to process newEvent, however the matching event has already started processing. Consider increasing the requiredConfirmations.',
        event,
        data,
      );
    } else if (!isReprocess && data.length > 0) {
      logger.error(
        'attempting to process new event but found existing event with matching logIndex and transactionHash.',
        event,
        data,
      );
    }

    if (isReprocess && data.length > 0) {
      const e = data[0];
      if ([EventStatus.WAITING, EventStatus.PROCESSING].includes(e.status)) {
        // ignore this reprocess b/c we still need to process an existing event
        logger.info(
          `Ignoring reprocess event for event._id: ${
            e._id
          }. Existing event has not finished processing`,
        );
      } else {
        await eventService.patch(
          e._id,
          Object.assign({}, e, event, { confirmations: 0, status: EventStatus.WAITING }),
        );
      }
    } else {
      await eventService.create(Object.assign({}, event, { confirmations: 0 }));
    }
    logger.info('processNewEvent finished', event.id);
    queue.purge();
  }

  /**
   * Handle new events as they are emitted, and add them to a queue for sequential
   * processing of events with the same id.
   */
  function newEvent(event, isReprocess = false) {
    if (!isReprocess) setLastBlock(event.blockNumber);

    logger.info('newEvent called', event);
    // during a reorg, the same event can occur in quick succession, so we add everything to a
    // queue so they are processed synchronously
    queue.add(() => processNewEvent(event, isReprocess));

    // start processing the queued events if we haven't already
    if (!queue.isProcessing()) queue.purge();
  }

  /**
   * submit events to the eventsHandler for processing.
   *
   * Updates the status of the event depending on the processing result
   *
   * @param {array} events
   */
  async function processEvents(events) {
    await eventService.patch(
      null,
      { status: EventStatus.PROCESSING, confirmations: requiredConfirmations },
      { query: { _id: { $in: events.map(e => e._id) } } },
    );

    // now that the event is confirmed, handle the event
    events.forEach(event => {
      eventHandler
        .handle(event)
        .then(() => eventService.patch(event._id, { status: EventStatus.PROCESSED }))
        .catch(error =>
          eventService.patch(event._id, {
            status: EventStatus.FAILED,
            processingError: error.toString(),
          }),
        );
    });
  }

  const { liquidPledgingAddress } = app.get('blockchain');
  const liquidPledging = new LiquidPledging(web3, liquidPledgingAddress);
  const lppCappedMilestone = new LPPCappedMilestone(web3).$contract;
  const lppCappedMilestoneEventDecoder = lppCappedMilestone._decodeEventABI.bind({
    name: 'ALLEVENTS',
    jsonInterface: lppCappedMilestone._jsonInterface,
  });

  function getLppCappedMilestoneTopics() {
    return [
      [
        keccak256('MilestoneCompleteRequested(address,uint64)'),
        keccak256('MilestoneCompleteRequestRejected(address,uint64)'),
        keccak256('MilestoneCompleteRequestApproved(address,uint64)'),
        keccak256('MilestoneChangeReviewerRequested(address,uint64,address)'),
        keccak256('MilestoneReviewerChanged(address,uint64,address)'),
        keccak256('MilestoneChangeRecipientRequested(address,uint64,address)'),
        keccak256('MilestoneRecipientChanged(address,uint64,address)'),
        keccak256('PaymentCollected(address,uint64)'),
      ],
      padLeft(`0x${removeHexPrefix(liquidPledging.$address).toLowerCase()}`, 64),
    ];
  }

  /**
   * Ensures that no donations occur after the last event.
   *
   * If we reprocess events w/o clearing the donations, this will cause
   * issues with how we calculate which donation to transfer, etc.
   */
  async function checkDonations() {
    const lastEvent = await eventService.find({
      paginate: false,
      query: { $limit: 1, $sort: { blockNumber: -1 } },
    });

    const lastDonation = await app.service('donations').find({
      paginate: false,
      query: {
        $limit: 1,
        mined: true,
        status: { $nin: [DonationStatus.PENDING, DonationStatus.FAILED] },
        $sort: { createdAt: -1 },
      },
    });

    if (lastDonation.length > 0) {
      const receipt = await web3.eth.getTransactionReceipt(lastDonation[0].txHash);
      if (receipt.blockNumber > lastEvent.blockNumber) {
        logger.error(
          `It appears that you are attempting to reprocess events, or the events table has
          been altered and there are donations. In order to correctly sync/re-sync, the
          'donations' and 'events' tables must both be cleared, otherwise the donations
          will not be an accurate representation of the blockchain txs`,
        );
        process.exit(1);
      }
    }
  }

  /**
   * Fetch all past events we are interested in
   */
  async function fetchPastEvents() {
    const fromBlock = toHex(lastBlock + 1) || toHex(1); // convert to hex due to web3 bug https://github.com/ethereum/web3.js/issues/1097

    await liquidPledging.$contract
      .getPastEvents({ fromBlock })
      .then(events => events.forEach(newEvent));

    await kernel.$contract
      .getPastEvents({
        fromBlock,
        filter: {
          namespace: keccak256('base'),
          name: [keccak256('lpp-capped-milestone'), keccak256('lpp-campaign')],
        },
      })
      .then(events => events.forEach(newEvent));

    await web3.eth
      .getPastLogs({
        fromBlock,
        topics: getLppCappedMilestoneTopics(),
      })
      .then(events => events.forEach(e => newEvent(lppCappedMilestoneEventDecoder(e))));

    await lpVault.$contract.getPastEvents({ fromBlock }).then(events => events.forEach(newEvent));
  }

  const processPastEvents = async () => {
    const latestBlockNum = await web3.eth.getBlockNumber();
    if (lastBlock === latestBlockNum) return;

    logger.info(`Checking new events between blocks ${lastBlock}-${latestBlockNum}`);

    await checkDonations();
    fetchPastEvents();
    // start processing any events that have not been processed
    processEvents(await getUnProcessedEvents(eventService));

    //
    // if (!block.number || !fetchedPastEvents) return;
    // updateEventConfirmations(block.number);
  };

  // exposed api

  return {
    /**
     * subscribe to all events that we are interested in
     */
    async start() {
      setLastBlock(await getLastBlock(app));

      const kernelAddress = await liquidPledging.kernel();
      kernel = new Kernel(web3, kernelAddress);

      processPastEvents();

      // Start polling
      setInterval(processPastEvents, 5000);
    },

    /**
     * Add event for processing if it hasn't already been processed
     *
     * @param {object} event web3 event object
     */
    addEvent(event) {
      newEvent(event, true);
    },
  };
};

module.exports = watcher;
