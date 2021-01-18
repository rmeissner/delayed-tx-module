import { expect } from "chai";
import { Contract, BigNumber } from "ethers";
import hre, { deployments, ethers, waffle } from "hardhat";
import "@nomiclabs/hardhat-ethers";
import { Deployment } from "hardhat-deploy/types";

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
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 1, false]);
            await executor.call(module.address, 0, updateConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(1), false]);
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
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 1, false]);
            await executor.call(module.address, 0, updateConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(1), false]);
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
            ).to.be.deep.equal([announcer.address, BigNumber.from(block.timestamp + 1), false, false])
        })

        it("triggers event for required announcer", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 1, true]);
            await executor.call(module.address, 0, updateConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(1), true]);
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
            ).to.be.deep.equal([announcer.address, BigNumber.from(block.timestamp + 1), true, false])
        })

        it("throws if same announcement is made again", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 1, true]);
            await executor.call(module.address, 0, updateConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(1), true]);
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
            await module.announcements(txHash)

            await expect(
                module.announceTransaction(executor.address, to, value, data, operation, nonce)
            ).to.revertedWith("Could not announce transaction")
        })
    })
})