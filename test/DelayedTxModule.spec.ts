import { expect } from "chai";
import { Contract, BigNumber } from "ethers";
import hre, { deployments, ethers, waffle } from "hardhat";
import "@nomiclabs/hardhat-ethers";

describe("DelayedTxModule", async () => {

    const getModule = async () => {
        const ModuleDeployment = await deployments.get("DelayedTxModule");
        const Module = await hre.ethers.getContractFactory("DelayedTxModule");
        return Module.attach(ModuleDeployment.address);
    }

    const setupTest = deployments.createFixture(async () => {
        await deployments.fixture();
        const Executor = await hre.ethers.getContractFactory("TestExecutor");
        const executor = await Executor.deploy();
        return { executor };
    })
    const [announcer, user1] = waffle.provider.getWallets();

    describe("announce tx", async () => {
        it("throws if module not configured", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const to = user1.address;
            const value = 0;
            const data = "0x";
            const operation = 0;
            const nonce = 0;
            await expect(
                module.announceTransaction(executor.address, to, value, data, operation, nonce)
            ).to.be.revertedWith("Could not find valid config for executor and announcer");
        })

        it("throws if module not enabled", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 1, 1, false, true]);
            await executor.exec(module.address, 0, updateConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(1), 1, false, true]);
            const to = user1.address;
            const value = 0;
            const data = "0x";
            const operation = 0;
            const nonce = 0;
            await expect(
                module.announceTransaction(executor.address, to, value, data, operation, nonce)
            ).to.be.revertedWith("Not authorized");
        })

        it("triggers event for not required announcer", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 1, 1, false, true]);
            await executor.exec(module.address, 0, updateConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(1), 1, false, true]);
            await executor.setModule(module.address);
            const to = user1.address;
            const value = 0;
            const data = "0x";
            const operation = 0;
            const nonce = 0;
            const txHash = await module.getTransactionHash(executor.address, to, value, data, operation, nonce)
            let announceTx: any;
            await expect(
                module.announceTransaction(executor.address, to, value, data, operation, nonce).then((tx: any) => announceTx = tx)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)
            const block = await ethers.provider.getBlock(announceTx!!.blockHash)
            await expect(
                await module.announcements(txHash)
            ).to.be.deep.equal([announcer.address, BigNumber.from(block.timestamp + 1), 1, false, false])
        })

        it("triggers event for required announcer", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 1, 1, true, true]);
            await executor.exec(module.address, 0, updateConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(1), 1, true, true]);
            await executor.setModule(module.address);
            const to = user1.address;
            const value = 0;
            const data = "0x";
            const operation = 0;
            const nonce = 0;
            const txHash = await module.getTransactionHash(executor.address, to, value, data, operation, nonce)
            let announceTx: any;
            await expect(
                module.announceTransaction(executor.address, to, value, data, operation, nonce).then((tx: any) => announceTx = tx)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)
            const block = await ethers.provider.getBlock(announceTx!!.blockHash)
            await expect(
                await module.announcements(txHash)
            ).to.be.deep.equal([announcer.address, BigNumber.from(block.timestamp + 1), 1, true, false])
        })

        it("throws if same announcement is made again", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 1, 1, true, true]);
            await executor.exec(module.address, 0, updateConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(1), 1, true, true]);
            await executor.setModule(module.address);
            const to = user1.address;
            const value = 0;
            const data = "0x";
            const operation = 0;
            const nonce = 0;
            const txHash = await module.getTransactionHash(executor.address, to, value, data, operation, nonce)
            await expect(
                module.announceTransaction(executor.address, to, value, data, operation, nonce)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)

            await expect(
                module.announceTransaction(executor.address, to, value, data, operation, nonce)
            ).to.revertedWith("Could not announce transaction")
        })
    })

    describe("execute tx", async () => {
        it("throws if not announced", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            await executor.setModule(module.address);
            const to = user1.address;
            const value = 0;
            const data = "0x";
            const operation = 0;
            const nonce = 0;
            await expect(
                module.executeTransaction(executor.address, to, value, data, operation, nonce)
            ).to.be.revertedWith("Could not find announcement");
        })
        

        it("throws if executed twice", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 1, 1, true, true]);
            await executor.exec(module.address, 0, updateConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(1), 1, true, true]);
            await executor.setModule(module.address);
            const to = user1.address;
            const value = 0;
            const data = "0x";
            const operation = 0;
            const nonce = 0;
            const txHash = await module.getTransactionHash(executor.address, to, value, data, operation, nonce)
            await expect(
                module.announceTransaction(executor.address, to, value, data, operation, nonce)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)
            await module.executeTransaction(executor.address, to, value, data, operation, nonce)

            await expect(
                module.executeTransaction(executor.address, to, value, data, operation, nonce)
            ).to.revertedWith("Cannot execute transaction again")
        })
        
        it("throws if not possible to execute yet", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 4242424242, 1, true, true]);
            await executor.exec(module.address, 0, updateConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(4242424242), 1, true, true]);
            await executor.setModule(module.address);
            const to = user1.address;
            const value = 0;
            const data = "0x";
            const operation = 0;
            const nonce = 0;
            const txHash = await module.getTransactionHash(executor.address, to, value, data, operation, nonce)
            await expect(
                module.announceTransaction(executor.address, to, value, data, operation, nonce)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)
            await expect(
                module.executeTransaction(executor.address, to, value, data, operation, nonce)
            ).to.revertedWith("Cannot execute transaction yet")
        })
        
        it("throws if required announcer not available anymore", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 1, 1, true, true]);
            await executor.exec(module.address, 0, updateConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(1), 1, true, true]);
            await executor.setModule(module.address);
            const to = user1.address;
            const value = 0;
            const data = "0x";
            const operation = 0;
            const nonce = 0;
            const txHash = await module.getTransactionHash(executor.address, to, value, data, operation, nonce)
            await expect(
                module.announceTransaction(executor.address, to, value, data, operation, nonce)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)
            
            const resetConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 0, 1, false, true]);
            await executor.exec(module.address, 0, resetConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(0), 1, false, true]);

            await expect(
                module.executeTransaction(executor.address, to, value, data, operation, nonce)
            ).to.revertedWith("Could not find valid config for executor and announcer")
        })
        
        it("does not throws if announcer not available anymore, but not required", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 1, 1, false, true]);
            await executor.exec(module.address, 0, updateConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(1), 1, false, true]);
            await executor.setModule(module.address);
            const to = user1.address;
            const value = 0;
            const data = "0x";
            const operation = 0;
            const nonce = 0;
            const txHash = await module.getTransactionHash(executor.address, to, value, data, operation, nonce)
            await expect(
                module.announceTransaction(executor.address, to, value, data, operation, nonce)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)
            
            const resetConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 0, 1, false, true]);
            await executor.exec(module.address, 0, resetConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(0), 1, false, true]);

            await module.executeTransaction(executor.address, to, value, data, operation, nonce)
        })
    })

    describe("revoke announcement", async () => {
        it("throws if not announced", async () => {
            await setupTest();
            const module = await getModule();
            const to = user1.address;
            const value = 0;
            const data = "0x";
            const operation = 0;
            const nonce = 0;

            await expect(
                module.revokeTransactionAnnouncement(to, value, data, operation, nonce)
            ).to.be.revertedWith("Could not find announcement");
        })

        it("throws if already executed", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 1, 1, true, true]);
            await executor.exec(module.address, 0, updateConfigData);
            await executor.setModule(module.address);
            const to = user1.address;
            const value = 0;
            const data = "0x";
            const operation = 0;
            const nonce = 0;
            await module.announceTransaction(executor.address, to, value, data, operation, nonce)
            await module.executeTransaction(executor.address, to, value, data, operation, nonce)

            const revokeAnnouncement = module.interface.encodeFunctionData("revokeTransactionAnnouncement", [to, value, data, operation, nonce]);
            await expect(
                executor.exec(module.address, 0, revokeAnnouncement)
            ).to.be.revertedWith("Cannot revoke executed transaction");
        })
    })
})