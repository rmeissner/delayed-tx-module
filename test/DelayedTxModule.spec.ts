import { expect } from "chai";
import { Contract, BigNumber } from "ethers";
import hre, { deployments, ethers, waffle } from "hardhat";
import "@nomiclabs/hardhat-ethers";

describe("DelayedTxModule", async () => {
    const [user_1, user_2, user_3] = waffle.provider.getWallets();

    beforeEach(async () => {
        await deployments.fixture();
    });

    describe("announce tx", async () => {
        it("throws if already announced", async () => {
            const Module = await deployments.get('DelayedTxModule');
            console.log(Module.address);
        })
    })
})