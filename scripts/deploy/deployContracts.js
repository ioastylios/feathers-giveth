// eslint
const {
  DAOFactory,
  Kernel,
  ACL,
  LPVault,
  LiquidPledging,
  LPFactory,
  test,
} = require('giveth-liquidpledging');
const { LPPCampaign, LPPCampaignFactory } = require('lpp-campaign');
const { LPPCappedMilestone, LPPCappedMilestoneFactory } = require('lpp-capped-native-milestone');

const { RecoveryVault } = test;

module.exports = (web3, from) =>
  new Promise(async (resolve, reject) => {
    try {
      console.log('Deploying and setting up Liquid Pledging');
      const baseVault = await LPVault.new(web3, { from });
      console.log(` - BaseVault deployed`);
      const baseLP = await LiquidPledging.new(web3, { from });
      console.log(` - Base Liquid Pledging deployed`);
      const baseACL = await ACL.new(web3, { from });
      const baseKernel = await Kernel.new(web3, false, { from });
      const daoFactory = await DAOFactory.new(
        web3,
        baseKernel.$address,
        baseACL.$address,
        '0x0000000000000000000000000000000000000000',
        { from },
      );
      const lpFactory = await LPFactory.new(
        web3,
        daoFactory.$address,
        baseVault.$address,
        baseLP.$address,
        {
          gas: 6700000,
          from,
        },
      );
      const recoveryVault = (await RecoveryVault.new(web3, { from })).$address;
      const r = await lpFactory.newLP(from, recoveryVault, { $extraGas: 100000, from });
      console.log(` - Recovery Vault deployed`);

      const vaultAddress = r.events.DeployVault.returnValues.vault;
      const vault = new LPVault(web3, vaultAddress, { from });
      console.log(` - Vault deployed`);

      const lpAddress = r.events.DeployLiquidPledging.returnValues.liquidPledging;
      const liquidPledging = new LiquidPledging(web3, lpAddress, { from });
      console.log(` - Liquid Pledging deployed`);

      // set permissions
      const kernel = new Kernel(web3, await liquidPledging.kernel(), { from });
      const acl = new ACL(web3, await kernel.acl(), { from });
      await acl.createPermission(from, vault.$address, await vault.CANCEL_PAYMENT_ROLE(), from, {
        $extraGas: 200000,
        from,
      });
      await acl.createPermission(from, vault.$address, await vault.CONFIRM_PAYMENT_ROLE(), from, {
        $extraGas: 200000,
        from,
      });
      await acl.createPermission(from, vault.$address, await vault.SET_AUTOPAY_ROLE(), from, {
        $extraGas: 200000,
        from,
      });
      await vault.setAutopay(true, { from, $extraGas: 100000 });
      console.log(` - Permissions set`);

      // deploy campaign plugin
      console.log('Deploying and setting up Campaign factory');

      const lppCampaignFactory = await LPPCampaignFactory.new(web3, kernel.$address, {
        $extraGas: 100000,
        from,
      });
      console.log(` - LP Campaign Factory deployed`);
      await acl.grantPermission(
        lppCampaignFactory.$address,
        acl.$address,
        await acl.CREATE_PERMISSIONS_ROLE(),
        {
          $extraGas: 100000,
          from,
        },
      );
      await acl.grantPermission(
        lppCampaignFactory.$address,
        kernel.$address,
        await kernel.APP_MANAGER_ROLE(),
        { $extraGas: 100000, from },
      );
      await acl.grantPermission(
        lppCampaignFactory.$address,
        liquidPledging.$address,
        await liquidPledging.PLUGIN_MANAGER_ROLE(),
        { $extraGas: 100000, from },
      );
      console.log(` - Permissions set`);

      const campaignApp = await LPPCampaign.new(web3, { from });
      await kernel.setApp(
        await kernel.APP_BASES_NAMESPACE(),
        await lppCampaignFactory.CAMPAIGN_APP_ID(),
        campaignApp.$address,
        { $extraGas: 100000, from },
      );
      console.log(` - LP Campaign app deployed`);

      // deploy milestone plugin
      console.log('Deploying and setting up Milestone factory');
      const lppCappedMilestoneFactory = await LPPCappedMilestoneFactory.new(web3, kernel.$address, {
        $extraGas: 100000,
        from,
      });
      console.log(` - LP Milestone Factory deployed`);
      await acl.grantPermission(
        lppCappedMilestoneFactory.$address,
        acl.$address,
        await acl.CREATE_PERMISSIONS_ROLE(),
        {
          $extraGas: 100000,
          from,
        },
      );
      await acl.grantPermission(
        lppCappedMilestoneFactory.$address,
        liquidPledging.$address,
        await liquidPledging.PLUGIN_MANAGER_ROLE(),
        { $extraGas: 100000, from },
      );
      await acl.grantPermission(
        lppCappedMilestoneFactory.$address,
        kernel.$address,
        await kernel.APP_MANAGER_ROLE(),
        { $extraGas: 100000, from },
      );
      console.log(` - Permissions set`);

      const milestoneApp = await LPPCappedMilestone.new(web3, { from });
      await kernel.setApp(
        await kernel.APP_BASES_NAMESPACE(),
        await lppCappedMilestoneFactory.MILESTONE_APP_ID(),
        milestoneApp.$address,
        { $extraGas: 100000, from },
      );
      console.log(` - LP Milestone app deployed`);

      resolve({
        vault: vault.$address,
        liquidPledging: liquidPledging.$address,
        lppCampaignFactory: lppCampaignFactory.$address,
        lppCappedMilestoneFactory: lppCappedMilestoneFactory.$address,
      });
    } catch (e) {
      reject(e);
    }
  });
