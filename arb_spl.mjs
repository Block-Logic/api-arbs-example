// This is an example script to show how a simple arb bot works with two
// SPL tokens. Before using this script:
//   - Create a new wallet into a JSON keypair file.
//   - Use `ruby keypair_tobase58.rb keypair_file.json` to show the base58 key
//   - Copy the base58 key into the .env file. PRIVATE_KEY=your-base58-key
//   - Fund the wallet with some SOL and convert equal amounts of SOL into
//     the two tokens. Remember to leave some SOL to pay TX fees.
//   - Run this script `node arb_spl.mjs WSOL USDC` (or change the tokens)
//
// Credits: https://github.com/vvllxxdd/jupiter-arb

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

import { argv } from "process";

const [_0, _1, arg2, arg3] = argv;

dotenv.config();

const ASSETS = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  UST: "9vMJfxuKxXBoEa7rM12mYLMwTacLMLDJqHozw96WQL8i",
  WSOL: "So11111111111111111111111111111111111111112",
  MSOL: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  STSOL: "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj",
  ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  SOETH: "2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk",
  BTC: "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  SAMO: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  MNGO: "MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac"
};

const PRIVATE_KEY = process.env.PRIVATE_KEY;

const ENDPOINT = process.env.RPC_URL;

const ASSET_MINT = ASSETS[arg2] || ASSETS.BTC;

const QUOTE_MINT = ASSETS[arg3] || ASSETS.USDC;

const PROFITABILITY_THRESHOLD = 1.0000; // 1.0010 = +10 bps

const SLIPPAGE = 0.25; // % 0.10 = 10 bps

const DECIMAL_CUTTER = 10 ** 6;

const connection = new Connection(ENDPOINT);

const wallet = new Wallet(Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY)));

const quoteAddress = await Token.getAssociatedTokenAddress(
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  new PublicKey(QUOTE_MINT),
  wallet.publicKey
);

const getCoinQuote = (inputMint, outputMint, amount) =>
  got
    .get(
      `https://quote-api.jup.ag/v1/quote?outputMint=${outputMint}&inputMint=${inputMint}&amount=${amount}&slippage=${SLIPPAGE}`
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
        const error = new Error(
          `Transaction was not confirmed in ${attempt} attempts`
        );
        error.txid = txid;

        retry(error);
        return;
      }
      return txResult;
    },
    {
      retries: 60,
      minTimeout: 500,
      maxTimeout: 1000,
    }
  );
  if (res.meta.err) {
    throw new Error("Transaction failed");
  }
  return txid;
};

// const initial = tokenAccountBalance.value.amount;
const initial = 100_000_000; // Assumes that USDC is the quote currency

while (true) {
  // Account Token Account Info
  // const tokenAccountBalance = await connection.getTokenAccountBalance(
  //   new PublicKey(quoteAddress)
  // );

  const buyRoute = await getCoinQuote(QUOTE_MINT, ASSET_MINT, initial).then(
    (res) => res.data[0]
  );

  const sellRoute = await getCoinQuote(
    ASSET_MINT,
    QUOTE_MINT,
    buyRoute.outAmount
    // buyRoute.outAmountWithSlippage
  ).then((res) => res.data[0]);

  const isProfitable =
    sellRoute.outAmountWithSlippage >
    buyRoute.inAmount * PROFITABILITY_THRESHOLD;

  // console.log(`${sellRoute.outAmount / DECIMAL_CUTTER} / ${sellRoute.outAmountWithSlippage / DECIMAL_CUTTER}`)
  if (isProfitable) {
    console.log(`${arg2}: In: $${buyRoute.inAmount / DECIMAL_CUTTER} Out: $${sellRoute.outAmountWithSlippage / DECIMAL_CUTTER}`)
    // console.log(
    //   `
    //   Asset: ${arg2}
    //   buyRoute:       $${buyRoute.inAmount / DECIMAL_CUTTER}
    //   sellRoute.out:  $${sellRoute.outAmount / DECIMAL_CUTTER}
    //   sellRoute.slip: $${sellRoute.outAmountWithSlippage / DECIMAL_CUTTER}
    //   Swap rate is $${buyRoute.inAmount / DECIMAL_CUTTER} for $${
    //     sellRoute.outAmountWithSlippage / DECIMAL_CUTTER
    //   }.
    //   Min. profitable: $${
    //     (buyRoute.inAmount / DECIMAL_CUTTER) * PROFITABILITY_THRESHOLD
    //   }.
    //   ${isProfitable ? "Profitable" : "Not profitable"}
    //   <--------------------------------------------------->
    // `
    // );
  };

  // when outAmount more than initial
  if (isProfitable) {
    await Promise.all(
      [buyRoute, sellRoute].map(async (route) => {
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
                  maxRetries: 9,
                }
              );
              try {
                await getConfirmTransaction(txid);
                console.log(`  Success: https://solscan.io/tx/${txid}`);
              } catch (e) {
                // console.log(e);
                console.log(`  Failed: https://solscan.io/tx/${txid}`);

                // console.log(
                //   `  Failed: https://solscan.io/tx/${txid}. Retrying...`
                // );
                // I'm not waiting around for this TX. It is a hail-mary to
                // rescue this leg of the trade. Retrying here will help if the
                // first attempt died in the validator queue. Retrying the same
                // TX after an execution failure is a no-op.
                // connection.sendTransaction(transaction, [wallet.payer], {
                //   skipPreflight: true,
                //   maxRetries: 9,
                // });
              }
            })
        );
      })
    );
  }
}
