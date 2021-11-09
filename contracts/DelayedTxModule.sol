// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0;

contract Enum {
    enum Operation {Call, DelegateCall}
}

interface Executor {
    /// @dev Allows a Module to execute a transaction.
    /// @param to Destination address of module transaction.
    /// @param value Ether value of module transaction.
    /// @param data Data payload of module transaction.
    /// @param operation Operation type of module transaction.
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation
    ) external returns (bool success);
}

contract DelayedTxModule {
    event NewAnnouncement(
        address indexed executor,
        address indexed announcer,
        bytes32 txHash
    );
    event UpdatedConfig(address indexed executor, address indexed announcer, uint64 delaySec, uint16 validityDurationMin, bool requireAnnouncer);

    string public constant NAME = "Delayed Transaction Module";
    string public constant VERSION = "1.0.0";

    bytes32 public constant DOMAIN_SEPARATOR_TYPEHASH =
        0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;
    // keccak256(
    //     "EIP712Domain(uint256 chainId,address verifyingContract)"
    // );

    bytes32 public constant DELAYED_TRANSACTION_TYPEHASH =
        keccak256(
            "DelayedTransaction(address executor,address to,uint256 value,bytes data,uint8 operation,uint256 nonce,uint256 gasLimit)"
        );

    struct Config {
        uint64 delaySec; // Delay in seconds before an announced transaction can be executed
        uint16 validityDurationMin; // Duration in minutes the announcement is valid after delay is over (0 is valid forever)
        bool requireAnnouncer; // Flag to set if announcer should be checked again before execution
        bool notifyExecutor; // Flag to set if new announcements should be channeled through the executor
    }

    struct Announcement {
        address announcer;
        uint64 execTime; // Block time in seconds when the announced transaction can be executed
        uint16 validityDurationMin; // Duration in minutes the announcement is valid after delay is over (0 is valid forever)
        bool requireAnnouncer; // Flag if to check if announcer is still present on execution
        bool executed; // Flag if the announced transaction was executed
    }

    // Executor -> Announcer -> Config
    mapping(address => mapping(address => Config)) public configs;

    // Transaction Hash -> Announcement
    mapping(bytes32 => Announcement) public announcements;

    function updateConfig(
        address announcer,
        uint64 delaySec,
        uint16 validityDurationMin,
        bool requireAnnouncer,
        bool validateAnnouncement
    ) public {
        // Note: msg.sender is the executor
        configs[msg.sender][announcer] = Config(
            delaySec,
            validityDurationMin,
            requireAnnouncer,
            validateAnnouncement
        );
        emit UpdatedConfig(msg.sender, announcer, delaySec, validityDurationMin, requireAnnouncer);
    }

    function announceTransaction(
        address executor,
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 nonce,
        uint256 gasLimit
    ) public
    {  
        announceTransactionWithDuration(executor, to, value, data, operation, nonce, gasLimit, 0);
    }
    
    function announceTransactionWithDuration(address executor, address to, uint256 value, bytes memory data, Enum.Operation operation, uint256 nonce, uint256 gasLimit, uint16 validityDurationMin) 
        public 
    {
        // Note: msg.sender is the announcer
        Config memory config = configs[executor][msg.sender];
        require(
            config.delaySec > 0,
            "Could not find valid config for executor and announcer"
        );
        // No need to check overflow because Solidity does this now (starting with 0.8.0)
        uint64 execTime = uint64(block.timestamp) + config.delaySec;
        require(validityDurationMin <= config.validityDurationMin, "Can only decrease validity duration for a transaction");
        uint16 validityDuration = (validityDurationMin != 0 && validityDurationMin < config.validityDurationMin) ? validityDurationMin : config.validityDurationMin;
        if (config.notifyExecutor) {
            // We redirect the announcement via the executor
            // This is a preemptive check that this modules is enabled and this also notifies the executor that a transaction was announced
            bytes memory approveAnnouncement =
                abi.encodeWithSignature(
                    "approveTransactionAnnouncement(address,uint256,bytes,uint8,uint256,uint256,address,uint64,uint16,bool)",
                    to,
                    value,
                    data,
                    operation,
                    nonce,
                    gasLimit,
                    msg.sender,
                    execTime,
                    validityDuration,
                    config.requireAnnouncer
                );
            require(
                Executor(executor).execTransactionFromModule(
                    address(this),
                    0,
                    approveAnnouncement,
                    Enum.Operation.Call
                ),
                "Could not announce transaction"
            );
        } else {
            addAnnouncement(
                executor,
                to,
                value,
                data,
                operation,
                nonce,
                gasLimit,
                msg.sender,
                execTime,
                validityDuration,
                config.requireAnnouncer
            );
        }
    }

    function approveTransactionAnnouncement(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 nonce,
        uint256 gasLimit,
        address announcer,
        uint64 execTime,
        uint16 expiryTimeMin,
        bool requireAnnouncer
    ) public {
        // Note: msg.sender is the executor
        addAnnouncement(
            msg.sender,
            to,
            value,
            data,
            operation,
            nonce,
            gasLimit,
            announcer,
            execTime,
            expiryTimeMin,
            requireAnnouncer
        );
    }

    function addAnnouncement(
        address executor,
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 nonce,
        uint256 gasLimit,
        address announcer,
        uint64 execTime,
        uint16 expiryTimeMin,
        bool requireAnnouncer
    ) internal {
        bytes32 txHash =
            getTransactionHash(
                executor,
                to,
                value,
                data,
                operation,
                nonce,
                gasLimit
            );
        Announcement memory announcement = announcements[txHash];
        require(execTime > block.timestamp, "Cannot delay transaction into the present or past (only future)");
        require(
            !announcement.executed && announcement.execTime == 0,
            "Cannot announce same transaction again"
        );
        announcements[txHash] = Announcement(
            announcer,
            execTime,
            expiryTimeMin,
            requireAnnouncer,
            false
        );
        emit NewAnnouncement(executor, announcer, txHash);
    }

    function revokeTransactionAnnouncement(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 nonce,
        uint256 gasLimit
    ) public {
        // Note: msg.sender is the executor
        bytes32 txHash =
            getTransactionHash(
                msg.sender,
                to,
                value,
                data,
                operation,
                nonce,
                gasLimit
            );
        Announcement memory announcement = announcements[txHash];
        require(announcement.execTime > 0, "Could not find announcement");
        require(!announcement.executed, "Cannot revoke executed transaction");
        delete announcements[txHash];
    }

    /// @notice Allows to trigger execution of a delayed transaction that has been announced before.
    /// @dev This method can be triggered by anyone, as transaction announcement is authorized.
    /// @param executor Contract that will execute the delayed transaction.
    /// @param to Destination address of delayed transaction.
    /// @param value Ether value of delayed transaction.
    /// @param data Data payload of delayed transaction.
    /// @param operation Operation type of delayed transaction.
    /// @param nonce None of delayed transaction.
    function executeTransaction(
        address executor,
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 nonce,
        uint256 gasLimit
    ) public {
        bytes32 txHash =
            getTransactionHash(
                executor,
                to,
                value,
                data,
                operation,
                nonce,
                gasLimit
            );
        Announcement memory announcement = announcements[txHash];
        require(announcement.execTime > 0, "Could not find announcement");
        require(!announcement.executed, "Cannot execute transaction again");
        require(
            announcement.execTime <= block.timestamp,
            "Cannot execute transaction yet"
        );
        require(
            announcement.validityDurationMin == 0 ||
                uint256(announcement.execTime) +
                    (uint256(announcement.validityDurationMin) * 60) >
                block.timestamp,
            "Announcement expired"
        );
        // If the announcer is set we should check if the announcer is still enabled
        require(
            !announcement.requireAnnouncer ||
                configs[executor][announcement.announcer].delaySec > 0,
            "Could not find valid config for executor and announcer"
        );
        announcement.executed = true;
        announcements[txHash] = announcement;
        uint256 txGas = gasLimit == 0 ? gasleft() : gasLimit;
        bool success =
            Executor(executor).execTransactionFromModule{gas: txGas}(
                to,
                value,
                data,
                operation
            );
        require(gasLimit == 0 || success, "Transaction failed");
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
        uint256 nonce,
        uint256 gasLimit
    ) private view returns (bytes memory) {
        uint256 chainId = getChainId();
        bytes32 domainSeparator =
            keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, chainId, this));
        bytes32 transactionHash =
            keccak256(
                abi.encode(
                    DELAYED_TRANSACTION_TYPEHASH,
                    executor,
                    to,
                    value,
                    keccak256(data),
                    operation,
                    nonce,
                    gasLimit
                )
            );
        return
            abi.encodePacked(
                bytes1(0x19),
                bytes1(0x01),
                domainSeparator,
                transactionHash
            );
    }

    function getTransactionHash(
        address executor,
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 nonce,
        uint256 gasLimit
    ) public view returns (bytes32) {
        return
            keccak256(
                generateTransactionHashData(
                    executor,
                    to,
                    value,
                    data,
                    operation,
                    nonce,
                    gasLimit
                )
            );
    }
}
