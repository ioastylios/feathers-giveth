const Confirm = require('prompt-confirm');
const fs = require('fs');

const clearDatabases = require('./utils/clearDatabases');
const fundAccounts = require('./utils/fundAccounts');
const getNodeConfig = require('./config/getNodeConfig');
const getWeb3 = require('./network/getNetwork');
const deployContracts = require('./deploy/deployContracts');
const deployToken = require('./deploy/deployToken');

async function deployProcess() {
  const config = getNodeConfig(process.env.NODE_ENV);

  // No configuration was found
  if (!config) process.exit();

  // Accounts to be funded
  let ganacheAccounts = [
    '0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1',
    '0xffcf8fdee72ac11b5c542428b35eef5769c409f0',
    '0x22d491bde2303f2f43325b2108d26f1eaba1e32b',
    '0xe11ba2b4d45eaed5996cd0823791e0c93114882d',
    '0xd03ea8624c8c5987235048901fb614fdca89b117',
  ];

  const configuration = {
    mongodb: config.mongoUrl,
    blockchain: {
      nodeUrl: config.provider,
      requiredConfirmations: config.requiredConfirmations,
    },
    fiatWhitelist: [...config.fiatWhitelist],
    tokenWhitelist: [],
  };

  console.log('\n');
  const queryDropDatabase = await new Confirm(
    'Do you want to drop the local mongo database and remove local blockchain database?',
  ).run();
  if (queryDropDatabase) await clearDatabases(config.blockchainDatabase, config.mongoUrl);

  // Get web3 provider and default accounts
  const { web3, accounts, child } = await getWeb3(config);
  if (config.private_keys) ganacheAccounts = accounts;

  console.log('Using accounts:\n', accounts, '\n');

  // Deploy all the contracts
  const queryDeployContracts = await new Confirm('Do you want to deploy the LP contracts?').run();
  if (queryDeployContracts) {
    const contracts = await deployContracts(web3, accounts[0]);
    configuration.blockchain.vaultAddress = contracts.vault;
    configuration.blockchain.liquidPledgingAddress = contracts.liquidPledging;
    configuration.blockchain.lppCampaignFactory = contracts.lppCampaignFactory;
    configuration.blockchain.lppCappedMilestoneFactory = contracts.lppCappedMilestoneFactory;
  }

  let tokenInfo;
  console.log('\n');
  const queryDeployToken = await new Confirm('Do you want to deploy ERC20 token?').run();
  if (queryDeployToken) {
    tokenInfo = await deployToken(web3, ganacheAccounts, accounts[0]);

    configuration.fiatWhitelist.push(tokenInfo.token.symbol);
    configuration.tokenWhitelist.push({
      name: tokenInfo.token.name,
      address: tokenInfo.token.address,
      symbol: tokenInfo.token.symbol,
      decimals: tokenInfo.token.decimals,
    });
  }

  // Ask if user wants to fund the default ganache addresses
  console.log('\n');
  const queryFundAccouts = await new Confirm('Fund the ganache default addresses?').run();
  if (queryFundAccouts)
    await fundAccounts(web3, ganacheAccounts, accounts[8], { symbol: config.symbol });

  console.log('\n');
  const queryWriteConfiguration = await new Confirm('Write the configuration files?').run();
  if (queryWriteConfiguration)
    await fs.writeFileSync(config.configFilename, JSON.stringify(configuration, null, 4));

  console.log('\nNew configuration details:\n', JSON.stringify(configuration, null, 4));

  if (child) {
    console.log(`Stopping the child node process`);
    child.kill('SIGINT');
  }

  const appConfig = {
    liquidPledgingAddress: configuration.blockchain.liquidPledgingAddress,
    lppCampaignFactoryAddress: configuration.blockchain.lppCampaignFactory,
    lppCappedMilestoneFactoryAddress: configuration.blockchain.lppCappedMilestoneFactory,
    nodeConnection: config.provider,
    networkName: config.network,
    nodeId: config.nodeId,
  };
  console.log('\n\nPlease modify the UI configuration:\n', JSON.stringify(appConfig, null, 4));
  console.log('\n\nor run the DApp as:');
  console.log(`
    REACT_APP_ETH_NODE_CONNECTION_URL=${appConfig.nodeConnection} \\
    REACT_APP_LIQUIDPLEDGING_ADDRESS=${appConfig.liquidPledgingAddress} \\
    REACT_APP_CAMPAIGN_FACTORY_ADDRESS=${appConfig.lppCampaignFactoryAddress} \\
    REACT_APP_CAPPED_MILESTONE_FACTORY_ADDRESS=${appConfig.lppCappedMilestoneFactoryAddress} \\
    REACT_APP_NETWORK_NAME=${appConfig.networkName} \\
    REACT_APP_NATIVE_TOKEN_NAME=${config.symbol} \\
    npm run start`);

  process.exit();
}

deployProcess();
