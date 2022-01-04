// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {IInstantDistributionAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IInstantDistributionAgreementV1.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";

/**
 * @title Supertoken distribution contract
 * @dev Contract which distributes tokens based on flow rate of a user using Superfluid IDA
 * @author rashtrakoff
 * @custom:experimental This is an experimental contract
 */
// solhint-disable not-rely-on-time
contract FlowShares is Ownable, SuperAppBase {
    using SafeERC20 for ERC20;

    uint32 public constant DIST_INDEX_ID = 0;
    address public immutable streamToken;
    address public immutable distToken;
    uint256 public lastDistAt;

    ISuperfluid private host;
    IConstantFlowAgreementV1 private cfa;
    IInstantDistributionAgreementV1 private ida;

    constructor(
        ISuperfluid _host,
        IConstantFlowAgreementV1 _cfa,
        IInstantDistributionAgreementV1 _ida,
        address _streamToken,
        address _distToken,
        string memory regKey
    ) {
        require(
            address(_host) != address(0) &&
                address(_cfa) != address(0) &&
                address(_ida) != address(0),
            "SF params invalid"
        );

        host = _host;
        cfa = _cfa;
        ida = _ida;
        streamToken = _streamToken;
        distToken = _distToken;

        uint256 configWord = SuperAppDefinitions.APP_LEVEL_FINAL;

        (bytes(regKey).length > 0)
            ? _host.registerAppWithKey(configWord, regKey)
            : _host.registerApp(configWord);

        // Ricochet and Dividend Rights Token tutorial way of creating an index
        _host.callAgreement(
            _ida,
            abi.encodeWithSelector(
                _ida.createIndex.selector,
                ISuperToken(_distToken),
                DIST_INDEX_ID,
                new bytes(0) // placeholder ctx
            ),
            new bytes(0) // user data
        );
    }

    function calcUserUninvested(
        uint256 _userPrevUpdateTimestamp,
        uint256 _flowRate
    ) public view returns (uint256 _userUninvested) {
        _userUninvested =
            _flowRate *
            (block.timestamp -
                (
                    (_userPrevUpdateTimestamp > lastDistAt)
                        ? _userPrevUpdateTimestamp
                        : lastDistAt
                ));

        console.log("Uninvested amount is: %s", _userUninvested);
    }

    function _updateShares(bytes memory _ctx)
        internal
        returns (bytes memory _newCtx)
    {
        ISuperToken superDistToken = ISuperToken(distToken);
        address msgSender = host.decodeCtx(_ctx).msgSender;
        (, int96 flowRate) = _getFlow(msgSender);
        uint256 userFlowRate = uint256(uint96(flowRate));

        console.log("Reaching here 4");

        (, , uint128 totalUnitsApproved, uint128 totalUnitsPending) = ida
            .getIndex(superDistToken, address(this), DIST_INDEX_ID);

        uint256 balance = superDistToken.balanceOf(address(this)) /
            (10**(18 - ERC20(superDistToken.getUnderlyingToken()).decimals()));

        console.log("Reaching here 4.1");

        if (totalUnitsApproved + totalUnitsPending > 0 && balance > 0)
            _distribute();

        console.log("Reaching here 4.5");

        (_newCtx, ) = host.callAgreementWithContext(
            ida,
            abi.encodeWithSelector(
                ida.updateSubscription.selector,
                superDistToken,
                DIST_INDEX_ID,
                msgSender,
                uint128(userFlowRate / 1e9),
                new bytes(0)
            ),
            new bytes(0),
            _ctx
        );

        console.log("Reaching here 4.6");
    }

    function _distribute() internal returns (bytes memory _newCtx) {
        ISuperToken superDistToken = ISuperToken(distToken);

        console.log("Reaching here 4.2");
        (uint256 actualAmount, ) = ida.calculateDistribution(
            superDistToken,
            address(this),
            DIST_INDEX_ID,
            superDistToken.balanceOf(address(this))
        );

        require(
            superDistToken.balanceOf(address(this)) >= actualAmount,
            "FlowShares: !enough distTokens"
        );

        console.log("Reaching here 4.3");

        _newCtx = host.callAgreement(
            ida,
            abi.encodeWithSelector(
                ida.distribute.selector,
                superDistToken,
                DIST_INDEX_ID,
                new bytes(0)
            ),
            new bytes(0)
        );

        lastDistAt = block.timestamp;

        console.log("Reaching here 4.4");
    }

    function _afterAgreement(bytes memory _ctx, bytes memory _cbdata)
        internal
        returns (bytes memory _newCtx)
    {
        address msgSender = host.decodeCtx(_ctx).msgSender;
        uint256 userUninvested = abi.decode(_cbdata, (uint256));

        _newCtx = _updateShares(_ctx);

        ISuperToken(streamToken).transfer(msgSender, userUninvested);
    }

    function _beforeAgreement(bytes memory _ctx)
        internal
        view
        returns (bytes memory _cbdata)
    {
        address msgSender = host.decodeCtx(_ctx).msgSender;
        (uint256 timestamp, int96 flowRate) = _getFlow(msgSender);

        _cbdata = abi.encode(
            calcUserUninvested(timestamp, uint256(uint96(flowRate)))
        );
    }

    function _getFlow(address _user) internal view returns (uint256 _timestamp, int96 _flowRate) {
        (_timestamp, _flowRate, , ) = cfa.getFlow(
            ISuperToken(streamToken),
            _user,
            address(this)
        );

        // There shouldn't be any outflow from the contract
        assert(_flowRate >= 0); 
    }


    function _onlyExpected(ISuperToken _superToken, address _agreementClass)
        internal
        view
    {
        if (
            ISuperAgreement(_agreementClass).agreementType() ==
            keccak256(
                "org.superfluid-finance.agreements.ConstantFlowAgreement.v1"
            )
        ) {
            require(
                address(_superToken) == streamToken,
                "FlowShares: Not stream token"
            );
        } else if (
            ISuperAgreement(_agreementClass).agreementType() ==
            keccak256(
                "org.superfluid-finance.agreements.InstantDistributionAgreement.v1"
            )
        ) {
            require(
                address(_superToken) == distToken,
                "FlowShares: Not dist token"
            );
        }
    }

    function _onlyHost() internal view {
        require(msg.sender == address(host), "FlowShares: Not host");
    }


    /********************************************
     * Superfluid app callbacks
     ********************************************/

    function beforeAgreementCreated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, // agreementId,
        bytes calldata, // agreementData,
        bytes calldata // ctx
    ) external view override returns (bytes memory _cbdata) {
        console.log("Reaching here 1");
        _onlyHost();
        _onlyExpected(_superToken, _agreementClass);

        console.log("Reaching here 1.1");

        _cbdata = new bytes(0);

        console.log("Reaching here 2");
    }

    function afterAgreementCreated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, // _agreementId,
        bytes calldata, // agreementData
        bytes calldata, // _cbdata
        bytes calldata _ctx
    ) external override returns (bytes memory _newCtx) {
        _onlyHost();
        _onlyExpected(_superToken, _agreementClass);

        console.log("Reaching here 3");
        _newCtx = _updateShares(_ctx);

        console.log("Reaching here 5");
    }

    function beforeAgreementUpdated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, // agreementId,
        bytes calldata, // agreementData,
        bytes calldata _ctx
    ) external view override returns (bytes memory _cbdata) {
        _onlyHost();
        _onlyExpected(_superToken, _agreementClass);

        _cbdata = _beforeAgreement(_ctx);
    }

    function afterAgreementUpdated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, //_agreementId
        bytes calldata, // agreementData
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory _newCtx) {
        _onlyHost();
        _onlyExpected(_superToken, _agreementClass);

        _newCtx = _afterAgreement(_ctx, _cbdata);
    }

    function beforeAgreementTerminated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, // agreementId,
        bytes calldata, // agreementData,
        bytes calldata _ctx
    ) external view override returns(bytes memory _cbdata) {
        _onlyHost();
        _onlyExpected(_superToken, _agreementClass);

        _cbdata = _beforeAgreement(_ctx);
    }

    function afterAgreementTerminated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, //_agreementId
        bytes calldata, // agreementData
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override returns (bytes memory _newCtx) {
        _onlyHost();
        _onlyExpected(_superToken, _agreementClass);

        _newCtx = _afterAgreement(_ctx, _cbdata);
    }
}
