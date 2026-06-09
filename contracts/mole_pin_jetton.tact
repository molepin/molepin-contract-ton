// SPDX-License-Identifier: MIT
//
// MolePinJetton — MolePin (MOL) on TON, TEP-74 Jetton  · stage-1 (token core)
// ----------------------------------------------------------------------------
// WARNING: Unaudited. Do NOT deploy to mainnet before an external audit +
// testnet verification. (KO: 미감사. 감사+테스트넷 검증 전 메인넷 금지.)
//
// Stage-1 scope: pure TEP-74 Jetton (Minter + Wallet). No LayerZero yet.
// (KO: 1단계 = 순수 Jetton. LayerZero 래핑은 2단계.)
//
// Design (carried from the EVM mesh):
//   - Fixed max supply 6,942,420,888,888 (the MolePin invariant across all chains).
//     (KO: 전 체인 공급 불변식 — TON local decimals 9.)
//   - decimals = 9 (TON convention; EVM side uses 18, OFT shared-decimals bridges them).
//   - Mint is owner-gated and supply-capped. In stage-2 the mint authority moves to
//     the LayerZero OApp so inbound bridge messages can mint. (KO: 2단계에서 mint 권한을
//     OApp으로 이전 → 인바운드 브릿지가 mint.)
//   - Burn reduces totalSupply on the minter (outbound bridge will burn in stage-2).
//   - owner -> mainnet multisig. (KO: owner는 메인넷 멀티시그.)
//
// Reference: TEP-74/64/89, tact-lang/jetton (Tact 1.6.x). Standard opcodes used.

import "@stdlib/ownable";
import "@stdlib/deploy";

// ── TEP-74 / TEP-89 standard messages (opcodes are fixed by the standard) ──

message(0x0f8a7ea5) JettonTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x178d4519) JettonTransferInternal {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    responseDestination: Address;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x7362d09c) JettonTransferNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    forwardPayload: Slice as remaining;
}

message(0x595f07bc) JettonBurn {
    queryId: Int as uint64;
    amount: Int as coins;
    responseDestination: Address;
    customPayload: Cell?;
}

message(0x7bdd97de) JettonBurnNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    responseDestination: Address;
}

message(0xd53276db) JettonExcesses {
    queryId: Int as uint64;
}

// ── MolePin-specific control messages ──

// Mint new MOL to a recipient. Owner-gated + supply-capped.
// (KO: owner만, 상한 6.94T 초과 불가. 2단계엔 OApp이 owner 역할.)
message(0x1674b0a0) MolePinMint {
    queryId: Int as uint64;
    amount: Int as coins;
    receiver: Address;
}

// Permanently stop minting (one-way). (KO: mint 영구 종료, 되돌릴 수 없음.)
message(0x4a8b1c33) MolePinCloseMinting {
    queryId: Int as uint64;
}

// On-chain getter return for TEP-74 minter data.
struct JettonMinterData {
    totalSupply: Int;
    mintable: Bool;
    owner: Address;
    content: Cell;
    walletCode: Cell;
}

struct JettonWalletData {
    balance: Int;
    owner: Address;
    minter: Address;
    walletCode: Cell;
}

// MolePin fixed supply invariant (token count, independent of decimals).
// (KO: 토큰 개수 불변식. decimals와 무관.)
const MOLEPIN_MAX_SUPPLY: Int = 6942420888888 * 1000000000; // 6,942,420,888,888 * 10^9

// Gas guards (TON requires the sender to fund storage + forwarding).
const MIN_TONS_FOR_STORAGE: Int = ton("0.02");
const GAS_CONSUMPTION: Int = ton("0.015");

// ============================================================================
//  MolePinJettonMinter — the master (mint, supply accounting, wallet factory)
// ============================================================================
contract MolePinJettonMinter with OwnableTransferable, Deployable {
    totalSupply: Int as coins;
    mintable: Bool;
    owner: Address;
    content: Cell;

    init(owner: Address, content: Cell) {
        self.totalSupply = 0;
        self.mintable = true;
        self.owner = owner;
        self.content = content;
    }

    // ── Mint (owner-gated, supply-capped) ──
    receive(msg: MolePinMint) {
        self.requireOwner();
        require(self.mintable, "MOL: minting closed");
        require(msg.amount > 0, "MOL: zero amount");
        require(self.totalSupply + msg.amount <= MOLEPIN_MAX_SUPPLY, "MOL: cap exceeded");

        self.totalSupply += msg.amount;

        // Deploy/route to the receiver's wallet via internal transfer (mint path).
        let winit: StateInit = self.walletStateInit(msg.receiver);
        let walletAddr: Address = contractAddress(winit);
        send(SendParameters {
            to: walletAddr,
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: JettonTransferInternal {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: myAddress(),
                responseDestination: self.owner,
                forwardTonAmount: 0,
                forwardPayload: emptySlice(),
            }.toCell(),
            code: winit.code,
            data: winit.data,
        });
    }

    // ── Close minting permanently (one-way) ──
    receive(msg: MolePinCloseMinting) {
        self.requireOwner();
        self.mintable = false;
    }

    // ── Burn accounting: a wallet notifies the minter on burn ──
    receive(msg: JettonBurnNotification) {
        // Only the legitimate wallet for msg.sender may report a burn.
        let expected: Address = contractAddress(self.walletStateInit(msg.sender));
        require(sender() == expected, "MOL: not wallet");

        require(self.totalSupply >= msg.amount, "MOL: supply underflow");
        self.totalSupply -= msg.amount;

        // Return excess gas to the original response destination.
        if (msg.responseDestination != newAddress(0, 0)) {
            send(SendParameters {
                to: msg.responseDestination,
                value: 0,
                mode: SendRemainingValue + SendIgnoreErrors,
                bounce: false,
                body: JettonExcesses { queryId: msg.queryId }.toCell(),
            });
        }
    }

    // ── Wallet StateInit factory (one wallet per owner) ──
    fun walletStateInit(ownerAddress: Address): StateInit {
        return initOf MolePinJettonWallet(ownerAddress, myAddress());
    }

    // ── Getters (TEP-74) ──
    get fun get_jetton_data(): JettonMinterData {
        return JettonMinterData {
            totalSupply: self.totalSupply,
            mintable: self.mintable,
            owner: self.owner,
            content: self.content,
            walletCode: self.walletStateInit(myAddress()).code,
        };
    }

    get fun get_wallet_address(ownerAddress: Address): Address {
        return contractAddress(self.walletStateInit(ownerAddress));
    }
}

// ============================================================================
//  MolePinJettonWallet — per-holder balance + transfers + burn
// ============================================================================
contract MolePinJettonWallet with Deployable {
    balance: Int as coins;
    owner: Address;
    minter: Address;

    init(owner: Address, minter: Address) {
        self.balance = 0;
        self.owner = owner;
        self.minter = minter;
    }

    // ── Outgoing transfer: owner moves tokens to another wallet ──
    receive(msg: JettonTransfer) {
        require(sender() == self.owner, "MOL: not owner");
        require(msg.amount > 0, "MOL: zero amount");
        require(self.balance >= msg.amount, "MOL: insufficient balance");

        let ctx: Context = context();
        require(
            ctx.value > msg.forwardTonAmount + MIN_TONS_FOR_STORAGE + 2 * GAS_CONSUMPTION,
            "MOL: insufficient gas",
        );

        self.balance -= msg.amount;

        // Route to the destination's wallet (deploy if needed).
        let destInit: StateInit = initOf MolePinJettonWallet(msg.destination, self.minter);
        let destWallet: Address = contractAddress(destInit);
        send(SendParameters {
            to: destWallet,
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: JettonTransferInternal {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: self.owner,
                responseDestination: msg.responseDestination,
                forwardTonAmount: msg.forwardTonAmount,
                forwardPayload: msg.forwardPayload,
            }.toCell(),
            code: destInit.code,
            data: destInit.data,
        });
    }

    // ── Incoming transfer (from minter on mint, or from another wallet) ──
    receive(msg: JettonTransferInternal) {
        // Sender must be either the minter (mint) or a legitimate sibling wallet.
        let fromWallet: Address = contractAddress(
            initOf MolePinJettonWallet(msg.sender, self.minter),
        );
        require(
            sender() == self.minter || sender() == fromWallet,
            "MOL: unauthorized internal",
        );

        self.balance += msg.amount;

        // Optional transfer notification to the new owner.
        if (msg.forwardTonAmount > 0) {
            send(SendParameters {
                to: self.owner,
                value: msg.forwardTonAmount,
                mode: SendPayGasSeparately,
                bounce: false,
                body: JettonTransferNotification {
                    queryId: msg.queryId,
                    amount: msg.amount,
                    sender: msg.sender,
                    forwardPayload: msg.forwardPayload,
                }.toCell(),
            });
        }

        // Return excess gas.
        if (msg.responseDestination != newAddress(0, 0)) {
            send(SendParameters {
                to: msg.responseDestination,
                value: 0,
                mode: SendRemainingValue + SendIgnoreErrors,
                bounce: false,
                body: JettonExcesses { queryId: msg.queryId }.toCell(),
            });
        }
    }

    // ── Burn: holder destroys tokens, minter reduces totalSupply ──
    receive(msg: JettonBurn) {
        require(sender() == self.owner, "MOL: not owner");
        require(msg.amount > 0, "MOL: zero amount");
        require(self.balance >= msg.amount, "MOL: insufficient balance");

        let ctx: Context = context();
        require(
            ctx.value > MIN_TONS_FOR_STORAGE + 2 * GAS_CONSUMPTION,
            "MOL: insufficient gas",
        );

        self.balance -= msg.amount;

        // Notify the minter to decrease total supply.
        send(SendParameters {
            to: self.minter,
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: JettonBurnNotification {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: self.owner,
                responseDestination: msg.responseDestination,
            }.toCell(),
        });
    }

    // ── Getter (TEP-74) ──
    get fun get_wallet_data(): JettonWalletData {
        return JettonWalletData {
            balance: self.balance,
            owner: self.owner,
            minter: self.minter,
            walletCode: initOf MolePinJettonWallet(self.owner, self.minter).code,
        };
    }
}
