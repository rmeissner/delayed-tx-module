// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0;

contract TestExecutor {
    address public module;

    function setModule(address _module) external {
        module = _module;
    }

    function call(address payable to, uint256 value, bytes calldata data) external {
        bool success;
        (success,) = to.call{value: value}(data);
        require(success, "Call failed");
    }

    function execTransactionFromModule(address payable to, uint256 value, bytes calldata data, uint8 operation)
        external
        returns (bool success)
    {
        require(msg.sender == module, "Not authorized");
        if (operation == 1)
            (success,) = to.delegatecall(data);
        else
            (success,) = to.call{value: value}(data);
    }
}