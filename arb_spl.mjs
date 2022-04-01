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
//
// For Debugging:
// NODE_INSPECT_RESUME_ON_START=1 node inspect arb_spl.mjs
// then include `debugger;` where you want to inspect the state
//
// Program Error Codes:
// 0x1 -- check the log notes, but probably insufficient funds
// 0x1770 -- occurs when the Slippage tolerance is exceeded, so when the final
// out amount is less than the minimum out amount.
// 0x178e --
// 0x22 --
// 0x28 --
//
// Sample Quote:
// https://quote-api.jup.ag/v1/quote?outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&inputMint=So11111111111111111111111111111111111111112&amount=100000000&slippage=0.1

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
import fs from 'fs';
import YAML from 'yaml';
import { argv } from "process";
import crypto from 'crypto';

dotenv.config();
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ENDPOINT = process.env.RPC_URL;

// Read the symbols from the args and check that they exist
const [_0, _1, arg2, arg3] = argv;
const BASE_SYM  = arg2;
const QUOTE_SYM = arg3;
if (typeof BASE_SYM === 'undefined' || typeof BASE_SYM === 'undefined') {
  console.log('Symbols are Missing. Usage: `node arb_spl.mjs BASE QUOTE`')
  process.exit(1);
}

// Read the MINTS file. Access values like `MINTS['WSOL']`
const MINTS = YAML.parse(fs.readFileSync('./mints.yml', 'utf8'));
const ASSET_MINT = MINTS[arg2] || MINTS['WSOL'];
const QUOTE_MINT = MINTS[arg3] || MINTS['USDC'];

// Read the Arb Config file. See arb_config.yml
// Access values like ARB_CONFIG[`${BASE_SYM}_${QUOTE_SYM}`]['slippage']
const ARB_CONFIG = YAML.parse(fs.readFileSync('./arb_config.yml', 'utf8'));
if (typeof ARB_CONFIG[`${BASE_SYM}_${QUOTE_SYM}`]['slippage'] === 'undefined') {
  console.log('Slippage is Missing. Check config file.')
  process.exit(1);
}

// 1.0010 = +10 bps
const RISK = ARB_CONFIG[`${BASE_SYM}_${QUOTE_SYM}`]['risk'];
const SLIPPAGE = ARB_CONFIG[`${BASE_SYM}_${QUOTE_SYM}`]['slippage'];
const DECIMAL_CUTTER = 10 ** 6;

// const initial = tokenAccountBalance.value.amount;
// Assumes that USDC is the quote currency!
const initial = ARB_CONFIG[`${BASE_SYM}_${QUOTE_SYM}`]['quote_value'];
// const initial = 100_000_000;

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
  // Rewrite the outAmount if the target is the quote symbol
  // route['marketInfos'].forEach((mi) => {
  //   if (QUOTE_MINT == mi['outputMint']) {
  //       route['outAmount'] = initial / RISK;
  //       route['outAmountWithSlippage'] = initial / RISK;
  //      }
  //    }
  //   // mi => console.log(mi['outputMint'])
  //  );
   // console.log(route);

  const tx = got
    .post("https://quote-api.jup.ag/v1/swap", {
      json: {
        route: route,
        userPublicKey: wallet.publicKey.toString(),
        // to make sure it doesnt close the sol account
        wrapUnwrapSOL: false,
      },
    })
    .json();
    // console.log(tx);
    return tx;
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
      minTimeout: 1000,
      maxTimeout: 1000,
    }
  );
  if (res.meta.err) {
    throw new Error("Transaction failed");
  }
  return txid;
};


while (true) {
  // Account Token Account Info
  // const tokenAccountBalance = await connection.getTokenAccountBalance(
  //   new PublicKey(quoteAddress)
  // );

  var uuid = crypto.randomUUID();
  // console.log(uuid);

  const buyRoute = await getCoinQuote(QUOTE_MINT, ASSET_MINT, initial).then(
    (res) => res.data[0]
  );

  const sellRoute = await getCoinQuote(
    ASSET_MINT,
    QUOTE_MINT,
    // buyRoute.outAmount
    buyRoute.outAmountWithSlippage
  ).then((res) => res.data[0]);

  const isProfitable =
    sellRoute.outAmountWithSlippage > (buyRoute.inAmount * RISK);

  // console.log(`${arg2}: ${buyRoute.inAmount  / DECIMAL_CUTTER} / ${sellRoute.outAmountWithSlippage / DECIMAL_CUTTER}`)
  if (isProfitable) {
    console.log(`uuid: '${uuid}', pair: '${BASE_SYM}_${QUOTE_SYM}', in: ${buyRoute.inAmount / DECIMAL_CUTTER} => ${buyRoute.outAmountWithSlippage / DECIMAL_CUTTER}, out: ${sellRoute.inAmount / DECIMAL_CUTTER} => ${sellRoute.outAmountWithSlippage / DECIMAL_CUTTER}, risk: ${(buyRoute.inAmount * RISK) / DECIMAL_CUTTER}`)
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
              // console.log(transaction);
              // perform the swap
              // Transaction might failed or dropped
              const txid = await connection.sendTransaction(
                transaction,
                [wallet.payer],
                {
                  skipPreflight: true,
                  maxRetries: 11,
                }
              );
              try {
                await getConfirmTransaction(txid);
                console.log(`uuid: '${uuid}', pair: '${BASE_SYM}_${QUOTE_SYM}', tx_status: 'success', tx_url: 'https://solscan.io/tx/${txid}'`);
              } catch (e) {
                if (e.message.includes('not confirmed')) {
                  console.log(`uuid: '${uuid}', pair: '${BASE_SYM}_${QUOTE_SYM}', tx_status: 'expired', tx_url: 'https://solscan.io/tx/${txid}'`);
                  // Hail Mary. Retry TX but don't wait for it.
                  connection.sendTransaction(transaction, [wallet.payer], {
                    skipPreflight: true,
                    maxRetries: 11,
                  });
                } else {
                  console.log(`uuid: '${uuid}', pair: '${BASE_SYM}_${QUOTE_SYM}', tx_status: 'failed', tx_url: 'https://solscan.io/tx/${txid}'`);
                }
              }
            })
        );
      })
    );
  }
}

// Errors
// console.log(e.name);
// console.log(e.message);
// console.log(e);
