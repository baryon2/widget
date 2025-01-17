import { AbstractWallet, Account, WalletArgument, WalletName, extractChainId, keyType } from '../Wallet';
import { fromBase64, fromBech32, toHex, fromHex, toBase64 } from '@cosmjs/encoding';
import {
    Registry,
    TxBodyEncodeObject,
    makeAuthInfoBytes,
    makeSignDoc,
} from '@cosmjs/proto-signing';
import { Transaction } from '../../utils/type';
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { AminoTypes, createDefaultAminoConverters } from "@cosmjs/stargate"
import { Any } from "cosmjs-types/google/protobuf/any";
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys'

export class MetamaskSnapWallet implements AbstractWallet {
    name: WalletName.MetamaskSnap;
    chainId: string;
    registry: Registry;
    prefix: string;
    aminoTypes = new AminoTypes(createDefaultAminoConverters())

    constructor(arg: WalletArgument, registry: Registry) {
        this.chainId = arg.chainId || 'cosmoshub';
        this.registry = registry;
        this.prefix = arg.prefix || 'evmos'
    }

    async getAccounts(): Promise<Account[]> {
    
        let account;
        try {
            // @ts-ignore
            await window.ethereum.request({
              method: 'wallet_requestSnaps',
              params: {
                'npm:@leapwallet/metamask-cosmos-snap': {},
              },
            });

            // @ts-ignore
            account = await window.ethereum.request({
                method: 'wallet_invokeSnap',
                params: {
                  snapId: "npm:@leapwallet/metamask-cosmos-snap",
                  request: {
                    method: 'getKey',
                    params: {
                      chainId: this.chainId,
                    },
                  },
                },
              });

          } catch (error) {
            throw new Error('Please install Metamask extension');
          }

        return [account];
    }

    async getConnectedAccounts() {
        const connected = localStorage.getItem("metamask-connected")
        if (connected) {
            return JSON.parse(connected) as Account[]
        }
        return this.getAccounts()
    }

    async supportCoinType(coinType?: string): Promise<boolean> {
        // Here, you can check if Metamask supports a specific type of cryptocurrency.
        return true;
    }

    async sign(transaction: Transaction): Promise<TxRaw | Uint8Array> {
        const accouts = await this.getAccounts()
        const hex = toHex(fromBech32(transaction.signerAddress).data)
        const accountFromSigner = accouts.find((account) => toHex(fromBech32(account.address).data) === hex);
        if (!accountFromSigner) {
            throw new Error("Failed to retrieve account from signer");
        }

        const pubkey = Any.fromPartial({
            typeUrl: keyType(transaction.chainId),
            value: PubKey.encode({
                key: accountFromSigner.pubkey,
            }).finish()
        })
        const txBodyEncodeObject: TxBodyEncodeObject = {
            typeUrl: "/cosmos.tx.v1beta1.TxBody",
            value: {
                messages: transaction.messages,
                memo: transaction.memo,
            },
        };
        const txBodyBytes = this.registry.encode(txBodyEncodeObject);
        const gasLimit = Number(transaction.fee.gas);
        const authInfoBytes = makeAuthInfoBytes(
            [{ pubkey, sequence: transaction.signerData.sequence }],
            transaction.fee.amount,
            gasLimit,
            transaction.fee.granter,
            transaction.fee.payer,
        );
        const signDoc = makeSignDoc(txBodyBytes, authInfoBytes, transaction.chainId, transaction.signerData.accountNumber);

        // // @ts-ignore
        // const offlineSigner = window.getOfflineSigner(this.chainId)
        // const { signature, signed } = await offlineSigner.signDirect(transaction.signerAddress, signDoc);;
        // @ts-ignore
        const { signature, signed } = await window.ethereum.request({
            method: 'wallet_invokeSnap',
            params: {
              snapId: "npm:@leapwallet/metamask-cosmos-snap",
              request: {
                method: 'signDirect',
                params: {
                  chainId: this.chainId,
                  signerAddress: transaction.signerAddress,
                  signDoc,
                },
              },
            },
          });

          console.log(signature, 'signature', signed)

        //   throw new Error('debuging')
        return TxRaw.fromPartial({
            bodyBytes: signed.bodyBytes,
            authInfoBytes: signed.authInfoBytes,
            signatures: [fromBase64(signature.signature)],
        });
    }
}
