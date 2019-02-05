const { LiquidPledging, LPVault, Kernel } = require('giveth-liquidpledging');
const { LPPCappedMilestone } = require('lpp-capped-native-milestone');
const { keccak256, padLeft, toHex } = require('web3-utils');
const semaphore = require('semaphore');
const logger = require('winston');

const { removeHexPrefix } = require('./lib/web3Helpers');
const { EventStatus } = require('../models/events.model');
const { DonationStatus } = require('../models/donations.model');

/**
 * Get the last block that we have gotten logs from the events service
 *
 * @param {Object} app Feathers app instance
 *
 * @return {Promise} Resolves to the last block which logs are stored in the event service
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

  try {
    const events = await app.service('events').find(opts);

    if (events && events.length > 0) return events[0].blockNumber;
  } catch (err) {
    logger.error('Error fetching the latest event blocknumber');
  }

  // default to blockchain.startingBlock in config
  const { startingBlock } = app.get('blockchain');
  return startingBlock || 0;
};

/**
 * Get the topics of events which are interested to watch
 *
 * @param {Object} liquidPledging  LiquidPledging contract
 *
 * @return {String} Encoded topics to be watched
 */
function getLppCappedMilestoneTopics(liquidPledging) {
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
 * Factory function for generating an event watcher
 *
 * @param {object} app          Feathersjs app instance
 * @param {object} eventHandler EventHandler instance
 */
const watcher = (app, eventHandler) => {
  const web3 = app.getWeb3();
  const requiredConfirmations = app.get('blockchain').requiredConfirmations || 0;
  const eventService = app.service('events');
  const sem = semaphore();

  const { vaultAddress } = app.get('blockchain');
  const lpVault = new LPVault(web3, vaultAddress);
  const { liquidPledgingAddress } = app.get('blockchain');
  const liquidPledging = new LiquidPledging(web3, liquidPledgingAddress);
  let kernel;

  let isFetchingPastEvents = false; // To indicate if the fetching process of past events is in progress or not.
  let lastBlock = 0;
  let latestBlockNum = 0;

  const lppCappedMilestone = new LPPCappedMilestone(web3).$contract;
  const lppCappedMilestoneEventDecoder = lppCappedMilestone._decodeEventABI.bind({
    name: 'ALLEVENTS',
    jsonInterface: lppCappedMilestone._jsonInterface,
  });

  function setLastBlock(blockNumber) {
    if (blockNumber > lastBlock) lastBlock = blockNumber;
  }

  /**
   * Fetch any events that have a status `Waiting` or `Processing`
   *
   * @param {Object} eventsService feathersjs `events` service
   *
   * @returns {Promise} Resolves to events sorted by blockNumber, transactionIndex, transactionHash & logIndex
   */
  function getUnProcessedEvent() {
    const query = {
      status: { $in: [EventStatus.WAITING, EventStatus.PROCESSING] },
      confirmations: { $gte: requiredConfirmations },
      $sort: { blockNumber: 1, transactionIndex: 1, transactionHash: 1, logIndex: 1 },
      $limit: 1,
    };
    return eventService.find({ paginate: false, query });
  }

  /**
   * Add newEvent to the database if they don't already exist
   *
   * @param {Object} event Event to be added to the database for processing
   */
  async function newEvent(event) {
    setLastBlock(event.blockNumber);

    logger.debug('newEvent called', event);

    if (!event || !event.event || !event.signature || !event.returnValues || !event.raw) {
      logger.error('Attempted to add undefined event or event with undefined values: ', event);
      return;
    }

    logger.info(
      `Adding new event. Block: ${event.blockNumber} log: ${event.logIndex} transactionHash: ${
        event.transactionHash
      }`,
    );

    try {
      // Check for existing event
      const query = {
        blockNumber: event.blockNumber,
        logIndex: event.logIndex,
        transactionHash: event.transactionHash,
        $limit: 1,
      };
      const duplicate = await eventService.find({ paginate: false, query });

      if (duplicate && duplicate.length > 0) {
        logger.error(
          `Attempt to add an event that already exists. Blocknumber: ${
            event.blockNumber
          }, logIndex: ${event.logIndex}, transactionHash: ${event.transactionHash}`,
        );
        return;
      }

      // Create the event in the DB
      await eventService.create(
        Object.assign({}, event, {
          confirmations: Math.max(
            0,
            Math.min(latestBlockNum - event.blockNumber, requiredConfirmations),
          ),
        }),
      );
    } catch (err) {
      logger.debug('Error adding event to the DB', err);
    }
  }

  let lock = false;
  /**
   * Retrieve and process a single event from the database that has not yet been processed and is next in line
   *
   * @return {Promise} Resolves to the event that was processed of false if there was no event to be processed
   */
  function processNextEvent() {
    return new Promise(async (resolve, reject) => {
      let event;
      try {
        if (lock) return;
        lock = true;
        [event] = await getUnProcessedEvent(eventService);

        // There is no event to be processed, return false
        if (!event || !event._id) {
          lock = false;
          resolve(false);
        }

        // Process the event
        await eventService.patch(event._id, { status: EventStatus.PROCESSING });
        await eventHandler.handle(event);
        await eventService.patch(event._id, { status: EventStatus.PROCESSED });

        event.status = EventStatus.PROCESSED;
        lock = false;
        resolve(event);
      } catch (error) {
        if (event)
          eventService.patch(event._id, {
            status: EventStatus.FAILED,
            processingError: error.toString(),
          });
        lock = false;
        reject(error);
      }
    });
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
   * Fetch all events between now and the latest block
   *
   * @param  {Number} [fromBlockNum=lastBlock] The block from which onwards should the events be checked
   * @param  {Number} [toBlockNum=lastBlock+1] No events after this block should be returned
   *
   * @return {Promise} Resolves to an array of events between speciefied block and latest known block.
   */
  async function fetchPastEvents(fromBlockNum = lastBlock, toBlockNum = lastBlock + 1) {
    const fromBlock = toHex(fromBlockNum + 1) || toHex(1); // convert to hex due to web3 bug https://github.com/ethereum/web3.js/issues/1097
    const toBlock = toHex(toBlockNum + 1) || toHex(1); // convert to hex due to web3 bug https://github.com/ethereum/web3.js/issues/1097

    // Get the events from contracts
    const events = [].concat(
      await liquidPledging.$contract.getPastEvents({ fromBlock, toBlock }),
      await kernel.$contract.getPastEvents({
        fromBlock,
        toBlock,
        filter: {
          namespace: keccak256('base'),
          name: [keccak256('lpp-capped-milestone'), keccak256('lpp-campaign')],
        },
      }),
      await web3.eth
        .getPastLogs({
          fromBlock,
          toBlock,
          topics: getLppCappedMilestoneTopics(liquidPledging),
        })
        .then(evnts => evnts.map(e => lppCappedMilestoneEventDecoder(e))),
      await lpVault.$contract.getPastEvents({ fromBlock, toBlock }),
    );

    return events;
  }

  /**
   * Fetch any events that are not confirmed yet
   *
   * @returns {Promise} Resolves to an array of events that do not have enough confirmations yet
   */
  async function getUnconfirmedEvents() {
    const query = {
      status: EventStatus.WAITING,
      confirmations: { $lt: requiredConfirmations },
    };
    return eventService.find({ paginate: false, query });
  }

  /**
   * Finds all un-confirmed events, update the number of confirmations
   *
   * @param {Number} currentBlock Latest know blocknumber
   *
   * @return {Promise} Returning promise as this function should be synchronous
   */
  function updateEventConfirmations(currentBlock) {
    return new Promise(resolve => {
      sem.take(async () => {
        try {
          const unconfirmedEvents = await getUnconfirmedEvents(eventService);

          await Promise.all(
            unconfirmedEvents.map(event =>
              eventService.patch(event._id, {
                confirmations: Math.max(
                  0,
                  Math.min(currentBlock - event.blockNumber, requiredConfirmations),
                ),
              }),
            ),
          );
        } catch (err) {
          logger.error('error calling updateConfirmations', err);
        }
        sem.leave();
      });

      resolve();
    });
  }

  /**
   * Retrieve and process events from the blockchain between last known block and the latest block
   *
   * @return {Promise}
   */
  const retrieveAndProcessPastEvents = async () => {
    try {
      latestBlockNum = await web3.eth.getBlockNumber();

      if (lastBlock < latestBlockNum && !isFetchingPastEvents) {
        // FIXME: This should likely use semaphore when setting the veriable or maybe even better extracted into different loop
        isFetchingPastEvents = true;

        try {
          logger.info(`Checking new events between blocks ${lastBlock}-${latestBlockNum}`);

          const events = await fetchPastEvents(lastBlock, latestBlockNum);

          await Promise.all(events.map(newEvent));

          setLastBlock(latestBlockNum);
        } catch (err) {
          logger.error('Fetching past events failed: ', err);
        }
        isFetchingPastEvents = false;
      }

      await updateEventConfirmations(latestBlockNum);

      // Process next event. This is purposely sunchronous with awaits to ensure events are processed in order
      // eslint-disable-next-line no-await-in-loop
      while (await processNextEvent()) {
        /* empty */
      }
    } catch (e) {
      logger.error('error in the processing looop', e);
    }
  };

  return {
    /**
     * Start watching (polling) the blockchain for new transactions
     * This runs interval that checks every x miliseconds for new block and if there are new events processes them
     *
     * @param  {Number}  POLL_FREQUENCY=5000  How often should new events be checked
     */
    async start(POLL_FREQUENCY = 5000) {
      setLastBlock(await getLastBlock(app));

      const kernelAddress = await liquidPledging.kernel();
      kernel = new Kernel(web3, kernelAddress);

      await checkDonations();
      retrieveAndProcessPastEvents();

      // Start polling
      setInterval(retrieveAndProcessPastEvents, POLL_FREQUENCY);
    },

    /**
     * Add event into the event queue
     *
     * @param {Object} event Web3 event object
     */
    addEvent(event) {
      newEvent(event);
    },
  };
};

module.exports = watcher;
