// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0;

/// @title Enum - Collection of enums
/// @author Richard Meissner - <richard@gnosis.pm>
contract Enum {
    enum Operation {
        Call,
        DelegateCall
    }
}

interface GnosisSafe {
    /// @dev Allows a Module to execute a Safe transaction without any further confirmations.
    /// @param to Destination address of module transaction.
    /// @param value Ether value of module transaction.
    /// @param data Data payload of module transaction.
    /// @param operation Operation type of module transaction.
    function execTransactionFromModule(address to, uint256 value, bytes calldata data, Enum.Operation operation)
        external
        returns (bool success);
}

contract DelayedTxModule {
    
    string public constant NAME = "Delayed Transaction Module";
    string public constant VERSION = "1.0.0";

    bytes32 public constant DOMAIN_SEPARATOR_TYPEHASH = 0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;
    // keccak256(
    //     "EIP712Domain(uint256 chainId,address verifyingContract)"
    // );

    bytes32 public constant DELAYED_TRANSACTION_TYPEHASH = keccak256(
         "DelayedTransaction(address executor,address to,uint256 value,bytes data,uint8 operation,uint256 nonce)"
    );

    struct Config {
        uint64 delay; // Delay in seconds before an announced transaction can be executed
        bool requireAnnouncer; // Flag to set if announcer should be checked again before execution
    }
    
    struct Announcement {
        address announcer; // (Optional) If set used to chec if announcer is still present on execution
        uint64 execTime; // Block time in seconds when the announced transaction can be executed
        bool executed; // Flag if the announced transaction was executed
    }
    
    // Executor -> Announcer -> Config
    mapping (address => mapping (address => Config)) configs;
    
    // Transaction Hash -> Announcement
    mapping (bytes32 => Announcement) anouncements;
    
    function updateConfig(address announcer, uint64 delay, bool requireAnnouncer)
        public
    {
        // Note: msg.sender is the executor
        configs[msg.sender][announcer] = Config(delay, requireAnnouncer);
    }
    
    function announceTransaction(address executor, address to, uint256 value, bytes memory data, Enum.Operation operation, uint256 nonce) 
        public 
    {
        // Note: msg.sender is the announcer
        Config memory config = configs[executor][msg.sender];
        require(config.delay > 0, "Could not find valid config for executor and announcer");
        // No need to check overflow because Solidity does this now (starting with 0.8.0)
        uint64 execTime = uint64(block.timestamp) + config.delay;
        bytes memory approveAnnouncement = abi.encodeWithSignature(
            "approveTransactionAnnouncement(address,uint256,bytes,uint8,uint256,address,uint64)", 
            to, 
            value,
            data,
            operation,
            nonce,
            config.requireAnnouncer ? msg.sender : address(0),
            execTime
        );
        // We redirect the anouncement via the executor
        // This is a preemptive check that this modules is enabled and this also notifies the executor that a transaction was announced
        require(GnosisSafe(executor).execTransactionFromModule(address(this), 0, approveAnnouncement, Enum.Operation.Call), "Could not announce transaction");
    }
    
    function approveTransactionAnnouncement(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 nonce,
        address announcer,
        uint64 execTime
    ) 
        public 
    {
        // Note: msg.sender is the executor
        bytes32 txHash = getTransactionHash(msg.sender, to, value, data, operation, nonce);
        Announcement memory anouncement = anouncements[txHash];
        require(!anouncement.executed && anouncement.execTime == 0, "Cannot announce same transaction again");
        anouncements[txHash] = Announcement(announcer, execTime, false);
    }
    
    function revokeTransactionAnnouncement(address to, uint256 value, bytes memory data, Enum.Operation operation, uint256 nonce) 
        public 
    {
        // Note: msg.sender is the executor
        bytes32 txHash = getTransactionHash(msg.sender, to, value, data, operation, nonce);
        delete anouncements[txHash];
    }
    
    /// @notice Allows to trigger execution of a delayed transaction that has been announced before.
    /// @dev This method can be triggered by anyone, as transaction announcement is authorized.
    /// @param executor Contract that will execute the delayed transaction.
    /// @param to Destination address of delayed transaction.
    /// @param value Ether value of delayed transaction.
    /// @param data Data payload of delayed transaction.
    /// @param operation Operation type of delayed transaction.
    /// @param nonce None of delayed transaction.
    function executeTransaction(address executor, address to, uint256 value, bytes memory data, Enum.Operation operation, uint256 nonce) 
        public 
    {
        bytes32 txHash = getTransactionHash(executor, to, value, data, operation, nonce);
        Announcement memory anouncement = anouncements[txHash];
        require(anouncement.execTime <= block.timestamp, "Cannot execute transaction yet");
        // If the announcer is set we should check if the announcer is still enabled
        require(
            anouncement.announcer == address(0) || configs[executor][anouncement.announcer].delay > 0, 
            "Could not find valid config for executor and announcer"
        );
        anouncement.executed = true;
        anouncements[txHash] = anouncement;
        GnosisSafe(executor).execTransactionFromModule(to, value, data, operation);
    }
    
    /// @dev Returns the chain id used by this contract.
    function getChainId() public view returns (uint256) {
        uint256 id;
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            id := chainid()
        }
        return id;
    }
    
    /// @dev Generates the data for the delayed transaction hash (required for signing)
    function generateTransactionHashData(
        address executor,
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 nonce
    ) 
        private 
        view 
        returns (bytes memory) 
    {
        uint256 chainId = getChainId();
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, chainId, this));
        bytes32 transactionHash = keccak256(
            abi.encode(DELAYED_TRANSACTION_TYPEHASH, executor, to, value, keccak256(data), operation, nonce)
        );
        return abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator, transactionHash);
    }
    
    function getTransactionHash(address executor, address to, uint256 value, bytes memory data, Enum.Operation operation, uint256 nonce) 
        public
        view
        returns (bytes32)
    {
        return keccak256(generateTransactionHashData(executor, to, value, data, operation, nonce));
    }
}