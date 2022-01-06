const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");
const { provider, loadFixture, deployContract } = waffle;
const { parseUnits } = require("@ethersproject/units");
const SuperFluidSDK = require("@superfluid-finance/sdk-core");
const {
    getBigNumber,
    getTimeStamp,
    getTimeStampNow,
    getDate,
    getSeconds,
    increaseTime,
    setNextBlockTimestamp,
    convertTo,
    convertFrom,
    impersonateAccounts
} = require("../misc/helpers");
const { defaultAbiCoder, keccak256 } = require("ethers/lib/utils");
const SuperfluidGovernanceBase = require("@superfluid-finance/ethereum-contracts/build/contracts/SuperfluidGovernanceII.json");
const { constants } = require("ethers");

describe("FlowShares Testing", () => {
    const DAI = {
        token: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
        superToken: "0x1305f6b6df9dc47159d12eb7ac2804d4a33173c2",
        decimals: 18
    }
    const USDC = {
        token: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
        superToken: "0xcaa7349cea390f89641fe306d93591f87595dc1f",
        decimals: 6
    }
    const SFConfig = {
        hostAddress: "0x3E14dC1b13c488a8d5D310918780c983bD5982E7",
        CFAv1: "0x6EeE6060f715257b970700bc2656De21dEdF074C",
        IDAv1: "0xB0aABBA4B2783A72C52956CDEF62d438ecA2d7a1"
    }

    const USDCWhaleAddr = "0x947d711c25220d8301c087b25ba111fe8cbf6672";
    const DAIWhaleAddr = "0x85fcd7dd0a1e1a9fcd5fd886ed522de8221c3ee5";
    const DAIWhaleAddr2 = "0x4A35582a710E1F4b2030A3F826DA20BfB6703C09";


    const [admin] = provider.getWallets();
    const ethersProvider = provider;

    let sf;
    let app;
    let USDCWhale, DAIWhale, DAIWhale2;
    let DAIContract, USDCContract;
    let USDCx, DAIx;

    before(async () => {
        [USDCWhale, DAIWhale, DAIWhale2] = await impersonateAccounts([USDCWhaleAddr, DAIWhaleAddr, DAIWhaleAddr2]);
        DAIContract = await ethers.getContractAt("IERC20", DAI.token);
        USDCContract = await ethers.getContractAt("IERC20", USDC.token);

        sf = await SuperFluidSDK.Framework.create({
            networkName: "hardhat",
            dataMode: "WEB3_ONLY",
            resolverAddress: "0xE0cc76334405EE8b39213E620587d815967af39C", // Polygon mainnet resolver
            protocolReleaseVersion: "v1",
            provider: ethersProvider
        });

        USDCx = await sf.loadSuperToken(USDC.superToken);
        DAIx = await sf.loadSuperToken(DAI.superToken);

    });

    async function setupEnv() {
        regKey = await createSFRegistrationKey(admin.address);
        factory = await ethers.getContractFactory("FlowShares", admin);
        app = await factory.deploy(
            SFConfig.hostAddress,
            SFConfig.CFAv1,
            SFConfig.IDAv1,
            DAI.superToken,
            USDC.superToken,
            regKey
        );

        await app.deployed();

        await USDCContract.connect(USDCWhale).approve(USDC.superToken, parseUnits("1000000", 6));
        await DAIContract.connect(DAIWhale).approve(DAI.superToken, parseUnits("1000000", 18));
        await DAIContract.connect(DAIWhale2).approve(DAI.superToken, parseUnits("1000000", 18));


        await USDCx.upgrade({ amount: parseUnits("1000", 18) }).exec(USDCWhale);
        await DAIx.upgrade({ amount: parseUnits("1000", 18) }).exec(DAIWhale);
        await DAIx.upgrade({ amount: parseUnits("1000", 18) }).exec(DAIWhale2);

    }

    async function createSFRegistrationKey(deployerAddr) {
        registrationKey = `testKey-${Date.now()}`;
        encodedKey = keccak256(
            defaultAbiCoder.encode(
                ["string", "address", "string"],
                [
                    "org.superfluid-finance.superfluid.appWhiteListing.registrationKey",
                    deployerAddr,
                    registrationKey,
                ]
            )
        );

        hostABI = [
            "function getGovernance() external view returns (address)"
        ];

        host = await ethers.getContractAt(hostABI, SFConfig.hostAddress);
        governance = await host.getGovernance();

        sfGovernanceRO = await ethers.getContractAt(SuperfluidGovernanceBase.abi, governance);

        govOwner = await sfGovernanceRO.owner();
        [govOwnerSigner] = await impersonateAccounts([govOwner]);

        sfGovernance = await ethers.getContractAt(SuperfluidGovernanceBase.abi, governance, govOwnerSigner);

        await sfGovernance.whiteListNewApp(SFConfig.hostAddress, encodedKey);

        return registrationKey;
    }

    async function getIndexDetails(superToken, indexId) {
        response = await sf.idaV1.getIndex({
            superToken: USDC.superToken,
            publisher: app.address,
            indexId: "0",
            providerOrSigner: ethersProvider
        });

        console.log("Index exists: ", response.exist);
        console.log("Total units approved: ", response.totalUnitsApproved);
        console.log("Total units pending: ", response.totalUnitsPending);

        return response;
    }

    async function getUserUnits(superToken, indexId, userAddr) {
        response = await sf.idaV1.getSubscription({
            superToken: superToken,
            publisher: app.address,
            indexId: indexId,
            subscriber: userAddr,
            providerOrSigner: ethersProvider
        });

        console.log("Subscription approved: ", response.approved);
        console.log("Units: ", response.units);
        console.log("Pending distribution: ", response.pendingDistribution);

        return response;
    }

    it("should create an index after deployment", async () => {
        await loadFixture(setupEnv);

        response = await getIndexDetails(USDC.superToken, "0");

        expect(response.exist).to.equal(true);
    });

    it("should be able to start/update/terminate streams", async () => {
        await loadFixture(setupEnv);

        await sf.cfaV1.createFlow({
            superToken: DAI.superToken,
            receiver: app.address,
            flowRate: parseUnits("100", 18).div(getBigNumber(3600 * 24 * 30))
        }).exec(DAIWhale);

        await getIndexDetails(USDC.superToken, "0");

        await getUserUnits(USDC.superToken, "0", DAIWhale.address);

        await sf.cfaV1.updateFlow({
            superToken: DAI.superToken,
            receiver: app.address,
            flowRate: parseUnits("50", 18).div(getBigNumber(3600 * 24 * 30))
        }).exec(DAIWhale);

        await getUserUnits(USDC.superToken, "0", DAIWhale.address);

        await sf.cfaV1.deleteFlow({
            superToken: DAI.superToken,
            sender: DAIWhale.address,
            receiver: app.address
        }).exec(DAIWhale);

        await getUserUnits(USDC.superToken, "0", DAIWhale.address);
    });

    it("should calculate uninvested amount correctly - 1", async () => {
        await loadFixture(setupEnv);

        await sf.cfaV1.createFlow({
            superToken: DAI.superToken,
            receiver: app.address,
            flowRate: parseUnits("100", 18).div(getBigNumber(3600 * 24 * 30))
        }).exec(DAIWhale);

        await increaseTime(getSeconds(30));

        expect(await app.calcUserUninvested(DAIWhale.address)).to.be.closeTo(parseUnits("100", 18), parseUnits("1", 18));

        await sf.cfaV1.updateFlow({
            superToken: DAI.superToken,
            receiver: app.address,
            flowRate: parseUnits("50", 18).div(getBigNumber(3600 * 24 * 30))
        }).exec(DAIWhale);

        expect(await app.calcUserUninvested(DAIWhale.address)).to.be.closeTo(constants.Zero, parseUnits("1", 18));

        await increaseTime(getSeconds(30));

        expect(await app.calcUserUninvested(DAIWhale.address)).to.be.closeTo(parseUnits("50", 18), parseUnits("1", 18));

        await sf.cfaV1.deleteFlow({
            superToken: DAI.superToken,
            sender: DAIWhale.address,
            receiver: app.address
        }).exec(DAIWhale);

        expect(await app.calcUserUninvested(DAIWhale.address)).to.be.closeTo(constants.Zero, parseUnits("1", 18));

        await increaseTime(getSeconds(30));

        expect(await app.calcUserUninvested(DAIWhale.address)).to.be.closeTo(constants.Zero, parseUnits("1", 18));

    });

    it("should calculate units correctly", async () => {
        await loadFixture(setupEnv);

        await sf.idaV1.approveSubscription({
            indexId: "0",
            superToken: USDC.superToken,
            publisher: app.address
        }).exec(DAIWhale);

        response = await getUserUnits(USDC.superToken, "0", DAIWhale.address);

        expect(response.approved).to.equal(true);
        expect(response.units).to.equal("0");

        userFlowRate = parseUnits("100", 18).div(getBigNumber(3600 * 24 * 30));

        await sf.cfaV1.createFlow({
            superToken: DAI.superToken,
            receiver: app.address,
            flowRate: userFlowRate
        }).exec(DAIWhale);

        response = await getUserUnits(USDC.superToken, "0", DAIWhale.address);

        expect(response.units).to.be.closeTo(userFlowRate.div(parseUnits("1", 9)), constants.One);

        userFlowRate = parseUnits("50", 18).div(getBigNumber(3600 * 24 * 30));

        await sf.cfaV1.updateFlow({
            superToken: DAI.superToken,
            receiver: app.address,
            flowRate: userFlowRate
        }).exec(DAIWhale);

        response = await getUserUnits(USDC.superToken, "0", DAIWhale.address);

        expect(response.units).to.be.closeTo(userFlowRate.div(parseUnits("1", 9)), constants.One);

        userFlowRate = constants.Zero;

        await sf.cfaV1.deleteFlow({
            superToken: DAI.superToken,
            sender: DAIWhale.address,
            receiver: app.address
        }).exec(DAIWhale);

        response = await getUserUnits(USDC.superToken, "0", DAIWhale.address);

        expect(response.units).to.be.closeTo(userFlowRate.div(parseUnits("1", 9)), constants.One);
    });

    describe.only("Distribution Tests", () => {
        it("should be able to distribute tokens", async () => {
            await loadFixture(setupEnv);

            userFlowRate = parseUnits("100", 18).div(getBigNumber(3600 * 24 * 30));

            await sf.idaV1.approveSubscription({
                indexId: "0",
                superToken: USDC.superToken,
                publisher: app.address
            }).exec(DAIWhale);

            await sf.cfaV1.createFlow({
                superToken: DAI.superToken,
                receiver: app.address,
                flowRate: userFlowRate
            }).exec(DAIWhale);

            response = await getUserUnits(USDC.superToken, "0", DAIWhale.address);

            expect(response.units).to.be.closeTo(userFlowRate.div(parseUnits("1", 9)), constants.One);

            await USDCx.transfer({
                receiver: app.address,
                amount: parseUnits("100", 18)
            }).exec(USDCWhale);

            await increaseTime(getSeconds(30));

            balanceBefore = await USDCx.balanceOf({ account: DAIWhale.address, providerOrSigner: ethersProvider });
            console.log("Balance before: ", balanceBefore);

            await app.distribute();

            balanceAfter = await USDCx.balanceOf({ account: DAIWhale.address, providerOrSigner: ethersProvider });
            console.log("Balance after: ", balanceAfter);

            expect(getBigNumber(balanceAfter).sub(getBigNumber(balanceBefore))).to.be.closeTo(parseUnits("100", 18), parseUnits("1", 18));
            expect(await USDCx.balanceOf({ account: app.address, providerOrSigner: ethersProvider })).to.be.closeTo(constants.Zero, parseUnits("1", 9));
        });

        it("should be able to distribute tokens to multiple streamers correctly", async() => {
            await loadFixture(setupEnv);

            userFlowRate1 = parseUnits("100", 18).div(getBigNumber(3600 * 24 * 30));
            userFlowRate2 = parseUnits("50", 18).div(getBigNumber(3600 * 24 * 30));

            await sf.idaV1.approveSubscription({
                indexId: "0",
                superToken: USDC.superToken,
                publisher: app.address
            }).exec(DAIWhale);

            await sf.idaV1.approveSubscription({
                indexId: "0",
                superToken: USDC.superToken,
                publisher: app.address
            }).exec(DAIWhale2);

            await sf.cfaV1.createFlow({
                superToken: DAI.superToken,
                receiver: app.address,
                flowRate: userFlowRate1
            }).exec(DAIWhale);

            await sf.cfaV1.createFlow({
                superToken: DAI.superToken,
                receiver: app.address,
                flowRate: userFlowRate2
            }).exec(DAIWhale2);

            response1 = await getUserUnits(USDC.superToken, "0", DAIWhale.address);
            response2 = await getUserUnits(USDC.superToken, "0", DAIWhale2.address);

            expect(response1.units).to.be.closeTo(userFlowRate1.div(parseUnits("1", 9)), constants.One);
            expect(response2.units).to.be.closeTo(userFlowRate2.div(parseUnits("1", 9)), constants.One);

            await USDCx.transfer({
                receiver: app.address,
                amount: parseUnits("100", 18)
            }).exec(USDCWhale);

            await increaseTime(getSeconds(30));

            balanceBefore1 = await USDCx.balanceOf({ account: DAIWhale.address, providerOrSigner: ethersProvider });
            balanceBefore2 = await USDCx.balanceOf({ account: DAIWhale2.address, providerOrSigner: ethersProvider });
            console.log("Balance before 1: ", balanceBefore1);
            console.log("Balance before 2: ", balanceBefore2);

            await app.distribute();

            balanceAfter1 = await USDCx.balanceOf({ account: DAIWhale.address, providerOrSigner: ethersProvider });
            balanceAfter2 = await USDCx.balanceOf({ account: DAIWhale2.address, providerOrSigner: ethersProvider });

            console.log("Balance after 1: ", balanceAfter1);
            console.log("Balance after 2: ", balanceAfter2);

            expect(getBigNumber(balanceAfter1).sub(getBigNumber(balanceBefore1))).to.be.closeTo(parseUnits("66", 18), parseUnits("1", 18));
            expect(getBigNumber(balanceAfter2).sub(getBigNumber(balanceBefore2))).to.be.closeTo(parseUnits("33", 18), parseUnits("1", 18));
            expect(await USDCx.balanceOf({ account: app.address, providerOrSigner: ethersProvider })).to.be.closeTo(constants.Zero, parseUnits("1", 9));
        });

    });
});