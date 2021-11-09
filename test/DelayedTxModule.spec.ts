import { expect } from "chai";
import { Contract, BigNumber } from "ethers";
import hre, { deployments, ethers, waffle } from "hardhat";
import "@nomiclabs/hardhat-ethers";
import { Deployment } from "hardhat-deploy/types";

interface DelayedTx { 
    to: string, 
    value: number, 
    data: string, 
    operation: number, 
    nonce: number, 
    gasLimit: number 
}

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

    const buildDelayedTx = (partialTx: { to: string, value?: number, data?: string, operation?: number, nonce?: number, gasLimit?: number }): DelayedTx => {
        return {
            to: partialTx.to,
            value: partialTx.value || 0,
            data: partialTx.data || "0x",
            operation: partialTx.operation || 0,
            nonce: partialTx.nonce || 0,
            gasLimit:  partialTx.gasLimit || 0
        }
    }

    const announceTx = (module: Contract, executor: Contract, tx: DelayedTx): Promise<any> => {
        return module.announceTransaction(executor.address, tx.to, tx.value, tx.data, tx.operation, tx.nonce, tx.gasLimit)
    }

    const executeTx = (module: Contract, executor: Contract, tx: DelayedTx): Promise<any> => {
        return module.executeTransaction(executor.address, tx.to, tx.value, tx.data, tx.operation, tx.nonce, tx.gasLimit)
    }

    const delayTxHash = (module: Contract, executor: Contract, tx: DelayedTx): Promise<any> => {
        return module.getTransactionHash(executor.address, tx.to, tx.value, tx.data, tx.operation, tx.nonce, tx.gasLimit)
    }

    describe("announce tx", async () => {
        it("throws if module not configured", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const tx = buildDelayedTx({ to: user1.address });
            await expect(
                announceTx(module, executor, tx)
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
            const tx = buildDelayedTx({ to: user1.address });
            await expect(
                announceTx(module, executor, tx)
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
            const tx = buildDelayedTx({ to: user1.address });
            const txHash = await delayTxHash(module, executor, tx)
            let trackedTx: any;
            await expect(
                announceTx(module, executor, tx).then((tx: any) => trackedTx = tx)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)
            const block = await ethers.provider.getBlock(trackedTx!!.blockHash)
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
            const tx = buildDelayedTx({ to: user1.address });
            const txHash = await delayTxHash(module, executor, tx)
            let trackedTx: any;
            await expect(
                announceTx(module, executor, tx).then((tx: any) => trackedTx = tx)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)
            const block = await ethers.provider.getBlock(trackedTx!!.blockHash)
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
            const tx = buildDelayedTx({ to: user1.address });
            const txHash = await delayTxHash(module, executor, tx)
            await expect(
                announceTx(module, executor, tx)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)
            await module.announcements(txHash)

            await expect(
                announceTx(module, executor, tx)
            ).to.revertedWith("Could not announce transaction")
        })
    })

    describe("execute tx", async () => {
        it("throws if not announced", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            await executor.setModule(module.address);
            const tx = buildDelayedTx({ to: user1.address });
            await expect(
                executeTx(module, executor, tx)
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
            const tx = buildDelayedTx({ to: user1.address });
            const txHash = await delayTxHash(module, executor, tx)
            await expect(
                announceTx(module, executor, tx)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)
            await executeTx(module, executor, tx)

            await expect(
                executeTx(module, executor, tx)
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
            const tx = buildDelayedTx({ to: user1.address });
            const txHash = await delayTxHash(module, executor, tx)
            await expect(
                announceTx(module, executor, tx)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)
            await expect(
                executeTx(module, executor, tx)
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
            const tx = buildDelayedTx({ to: user1.address });
            const txHash = await delayTxHash(module, executor, tx)
            await expect(
                announceTx(module, executor, tx)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)
            
            const resetConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 0, 1, false, true]);
            await executor.exec(module.address, 0, resetConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(0), 1, false, true]);

            await expect(
                executeTx(module, executor, tx)
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
            const tx = buildDelayedTx({ to: user1.address });
            const txHash = await delayTxHash(module, executor, tx)
            await expect(
                announceTx(module, executor, tx)
            ).to.emit(module, 'NewAnnouncement').withArgs(executor.address, announcer.address, txHash)
            
            const resetConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 0, 1, false, true]);
            await executor.exec(module.address, 0, resetConfigData);
            await expect(
                await module.configs(executor.address, announcer.address)
            ).to.be.deep.equal([BigNumber.from(0), 1, false, true]);
            await executeTx(module, executor, tx)
        })
        
        it.skip("enforces gas limit before execution", async () => {
        })
        
        it.skip("does not revert if execution reverts with gas limit", async () => {
        })
        
        it.skip("revert if execution reverts without gas limit", async () => {
        })
    })

    describe("revoke announcement", async () => {
        it("throws if not announced", async () => {
            await setupTest();
            const module = await getModule();
            const tx = buildDelayedTx({ to: user1.address });
            await expect(
                module.revokeTransactionAnnouncement(tx.to, tx.value, tx.data, tx.operation, tx.nonce, tx.gasLimit)
            ).to.be.revertedWith("Could not find announcement");
        })

        it("throws if already executed", async () => {
            const { executor } = await setupTest();
            const module = await getModule();
            const updateConfigData = module.interface.encodeFunctionData("updateConfig", [announcer.address, 1, 1, true, true]);
            await executor.exec(module.address, 0, updateConfigData);
            await executor.setModule(module.address);
            const tx = buildDelayedTx({ to: user1.address });
            await announceTx(module, executor, tx)
            await executeTx(module, executor, tx)

            const revokeAnnouncement = module.interface.encodeFunctionData("revokeTransactionAnnouncement", [tx.to, tx.value, tx.data, tx.operation, tx.nonce, tx.gasLimit]);
            await expect(
                executor.exec(module.address, 0, revokeAnnouncement)
            ).to.be.revertedWith("Cannot revoke executed transaction");
        })
    })
})