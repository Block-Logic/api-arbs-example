// This is an example script to show how a simple arb bot works with two
// SPL tokens. Before using this script:
//   - Create a new wallet into a JSON keypair file.
//   - Use `ruby keypair_tobase58.rb keypair_file.json` to show the base58 key
//   - Copy the base58 key into the .env file. MNGO_USDC_KEY=your-base58-key
//   - Fund the wallet with some SOL and convert equal amounts of SOL into
//     MNGO & USDC tokens. Remember to leave some SOL to pay TX fees.
//   - Run this script `node arb_mngo_usdc.mjs`

import dotenv from "dotenv";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  Transaction,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import got from "got";
import { Wallet } from "@project-serum/anchor";
import promiseRetry from "promise-retry";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

console.log({ dotenv });
dotenv.config();

const connection = new Connection(process.env.RPC_URL);
const wallet = new Wallet(
  Keypair.fromSecretKey(bs58.decode(process.env.MNGO_USDC_KEY || ""))
);

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MNGO_MINT = "MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac";

const getCoinQuote = (inputMint, outputMint, amount) =>
  got
    .get(
      `https://quote-api.jup.ag/v1/quote?outputMint=${outputMint}&inputMint=${inputMint}&amount=${amount}&slippage=0.2`
    )
    .json();

const getTransaction = (route) => {
  return got
    .post("https://quote-api.jup.ag/v1/swap", {
      json: {
        route: route,
        userPublicKey: wallet.publicKey.toString(),
        // to make sure it doesnt close the sol account
        wrapUnwrapSOL: false,
      },
    })
    .json();
};

const getConfirmTransaction = async (txid) => {
  const res = await promiseRetry(
    async (retry, attempt) => {
      let txResult = await connection.getTransaction(txid, {
        commitment: "confirmed",
      });

      if (!txResult) {
        const error = new Error("Transaction was not confirmed");
        error.txid = txid;

        retry(error);
        return;
      }
      return txResult;
    },
    {
      retries: 40,
      minTimeout: 500,
      maxTimeout: 1000,
    }
  );
  if (res.meta.err) {
    throw new Error("Transaction failed");
  }
  return txid;
};

// initial 100 USDC for quote
const initial = 100_000_000;

while (true) {
  const usdcToMngo = await getCoinQuote(USDC_MINT, MNGO_MINT, initial);

  const mngoToUsdc = await getCoinQuote(
    MNGO_MINT,
    USDC_MINT,
    usdcToMngo.data[0].outAmount
  );

  // console.log(`usdcToMngo: ${usdcToMngo.data[0].outAmount}`);
  // console.log(`mngoToUsdc: ${mngoToUsdc.data[0].outAmount}`);

  // when outAmount more than initial
  if (mngoToUsdc.data[0].outAmount > initial) {
    await Promise.all(
      [usdcToMngo.data[0], mngoToUsdc.data[0]].map(async (route) => {
        const { setupTransaction, swapTransaction, cleanupTransaction } =
          await getTransaction(route);

        await Promise.all(
          [setupTransaction, swapTransaction, cleanupTransaction]
            .filter(Boolean)
            .map(async (serializedTransaction) => {
              // get transaction object from serialized transaction
              const transaction = Transaction.from(
                Buffer.from(serializedTransaction, "base64")
              );
              // perform the swap
              // Transaction might failed or dropped
              const txid = await connection.sendTransaction(
                transaction,
                [wallet.payer],
                {
                  skipPreflight: true,
                }
              );
              try {
                await getConfirmTransaction(txid);
                console.log(`Success: https://solscan.io/tx/${txid}`);
              } catch (e) {
                console.log(e);
                console.log(`Failed: https://solscan.io/tx/${txid}`);
              }
            })
        );
      })
    );
  }
}
