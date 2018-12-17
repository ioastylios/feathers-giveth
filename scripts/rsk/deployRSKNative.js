/* eslint-disable import/no-extraneous-dependencies */
const Web3 = require('web3');
const { Kernel, ACL, LPVault, LiquidPledging, LPFactory, test } = require('giveth-liquidpledging');
const { LPPCampaign, LPPCampaignFactory } = require('lpp-campaign');
const { LPPCappedMilestone, LPPCappedMilestoneFactory } = require('lpp-capped-milestone');
const startRSKNetwork = require('./startRSKNetwork');
const etc = require('eth-token-creator');

const { RecoveryVault } = test;

// NOTE: do not use the bridge account (account[10]) for any txs outside of the bridge
// if you do, the nonce will become off and the bridge will fail
let processStartNetwork = process.env.START_NETWORK;
if (processStartNetwork) {
  processStartNetwork = !['f', 'false'].includes(processStartNetwork.toLowerCase());
}
const START_NETWORK = processStartNetwork === undefined ? true : processStartNetwork;
const PROVIDER = process.env.PROVIDER || 'http://localhost:8548';

// TODO: this was a quick hack to deploy rsk locally. Could definetly use some cleanup
// especially regarding the accounts, etc. Probably best to include a custom genesis.json
// file for rsk so we can use the same accounts as ganache
async function deploy() {
  try {
    if (START_NETWORK) {
      console.log('------------------- Starting RSK -------------------------\n');
      const rsk = await startRSKNetwork();

      await rsk.waitForStart();
    }
    console.log('\n\n------------------- Deploying -------------------------\n\n');

    const web3 = new Web3(PROVIDER);

    const accounts = await web3.eth.getAccounts();

    if (!START_NETWORK) {
      // most likely rsk, so fund the ganache accounts so we can use those
      await web3.eth.sendTransaction({
        to: '0x90f8bf6a479f320ead074411a4b0e7944ea8c9c1',
        from: accounts[8],
        gas: 30000,
        value: web3.utils.toWei('10'),
      });
      await web3.eth.sendTransaction({
        to: '0xffcf8fdee72ac11b5c542428b35eef5769c409f0',
        from: accounts[8],
        gas: 30000,
        value: web3.utils.toWei('10'),
      });
      await web3.eth.sendTransaction({
        to: '0x22d491bde2303f2f43325b2108d26f1eaba1e32b',
        from: accounts[8],
        gas: 30000,
        value: web3.utils.toWei('10'),
      });
      await web3.eth.sendTransaction({
        to: '0xe11ba2b4d45eaed5996cd0823791e0c93114882d',
        from: accounts[8],
        gas: 30000,
        value: web3.utils.toWei('10'),
      });
      await web3.eth.sendTransaction({
        to: '0xd03ea8624c8c5987235048901fb614fdca89b117',
        from: accounts[8],
        gas: 30000,
        value: web3.utils.toWei('10'),
      });
    }

    const from = accounts[0];

    const baseVault = await LPVault.new(web3);
    const baseLP = await LiquidPledging.new(web3);
    const lpFactory = await LPFactory.new(web3, baseVault.$address, baseLP.$address, {
      gas: 6700000,
    });
    const recoveryVault = (await RecoveryVault.new(web3)).$address;
    const r = await lpFactory.newLP(from, recoveryVault, { $extraGas: 100000 });

    const vaultAddress = r.events.DeployVault.returnValues.vault;
    const vault = new LPVault(web3, vaultAddress);

    const lpAddress = r.events.DeployLiquidPledging.returnValues.liquidPledging;
    const liquidPledging = new LiquidPledging(web3, lpAddress);

    // set permissions
    const kernel = new Kernel(web3, await liquidPledging.kernel());
    const acl = new ACL(web3, await kernel.acl());
    await acl.createPermission(
      accounts[0],
      vault.$address,
      await vault.CANCEL_PAYMENT_ROLE(),
      accounts[0],
      { $extraGas: 200000 },
    );
    await acl.createPermission(
      accounts[0],
      vault.$address,
      await vault.CONFIRM_PAYMENT_ROLE(),
      accounts[0],
      { $extraGas: 200000 },
    );
    await acl.createPermission(
      accounts[0],
      vault.$address,
      await vault.SET_AUTOPAY_ROLE(),
      accounts[0],
      { $extraGas: 200000 },
    );
    await vault.setAutopay(true, { from: accounts[0], $extraGas: 100000 });

    // deploy campaign plugin
    console.log('\n\n------------------- Deploy campaign factory -------------------------\n\n');

    const lppCampaignFactory = await LPPCampaignFactory.new(web3, kernel.$address, {
      $extraGas: 100000,
    });
    await acl.grantPermission(
      lppCampaignFactory.$address,
      acl.$address,
      await acl.CREATE_PERMISSIONS_ROLE(),
      {
        $extraGas: 100000,
      },
    );
    await acl.grantPermission(
      lppCampaignFactory.$address,
      liquidPledging.$address,
      await liquidPledging.PLUGIN_MANAGER_ROLE(),
      { $extraGas: 100000 },
    );

    const campaignApp = await LPPCampaign.new(web3);
    await kernel.setApp(
      await kernel.APP_BASES_NAMESPACE(),
      await lppCampaignFactory.CAMPAIGN_APP_ID(),
      campaignApp.$address,
      { $extraGas: 100000 },
    );

    // deploy milestone plugin
    console.log('\n\n------------------- Deploy milestone factory -------------------------\n\n');
    const lppCappedMilestoneFactory = await LPPCappedMilestoneFactory.new(web3, kernel.$address, {
      $extraGas: 100000,
    });
    await acl.grantPermission(
      lppCappedMilestoneFactory.$address,
      acl.$address,
      await acl.CREATE_PERMISSIONS_ROLE(),
      {
        $extraGas: 100000,
      },
    );
    await acl.grantPermission(
      lppCappedMilestoneFactory.$address,
      liquidPledging.$address,
      await liquidPledging.PLUGIN_MANAGER_ROLE(),
      { $extraGas: 100000 },
    );

    const milestoneApp = await LPPCappedMilestone.new(web3);
    await kernel.setApp(
      await kernel.APP_BASES_NAMESPACE(),
      await lppCappedMilestoneFactory.MILESTONE_APP_ID(),
      milestoneApp.$address,
      { $extraGas: 100000 },
    );

    console.log('\n\n------------------- Deploy ERC20 test token -------------------------\n\n');
    // deploy ERC20 test token
    await etc.compile();
 
    // 2. set provider for web3 module
    etc.setProvider(PROVIDER);
 
    // 3. deploy contract and return address
    const token = await etc.deploy({ name: 'Test Token', symbol: 'MMT', initialSupply: 100000, gas: 1000000 });
    console.log('token address', token._address, await token.methods.totalSupply().call());

    // transfer tokens to all other home accounts, so that Meta mask will detect these tokens
    res = await Promise.all(accounts.map(async a => {
      console.log("AAAA > ", a)
      await token.methods.transfer(a, 10000).send({ from: accounts[0], $extraGas: 100000 })
    }));

    res = await Promise.all(accounts.map(async a => {
      const balance = await token.methods.balanceOf(a).call()
      console.log(a, " balance: ", balance, 'MMT')
    }));

    console.log('------------------- Result -------------------------\n\n', {
      vault: vault.$address,
      liquidPledging: liquidPledging.$address,
      lppCampaignFactory: lppCampaignFactory.$address,
      lppCappedMilestoneFactory: lppCappedMilestoneFactory.$address,
      miniMeToken: {
        name: 'MiniMe Token',
        address: token._address,
        symbol: 'MMT',
        decimals: 18,
      },
    });
    process.exit(); // some reason, this script won't exit. I think it has to do with web3 subscribing to tx confirmations?
  } catch (e) {
    console.log(e);
    process.exit();
  }
}

deploy();
