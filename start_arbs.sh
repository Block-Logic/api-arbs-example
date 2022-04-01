node arb_spl.mjs MNGO USDC >> arb_spl.log &
node arb_spl.mjs SRM USDC >> arb_spl.log &
node arb_spl.mjs RAY USDC >> arb_spl.log &
node arb_spl.mjs ORCA USDC >> arb_spl.log &
node arb_spl.mjs STEP USDC >> arb_spl.log &
node arb_spl.mjs MER USDC >> arb_spl.log &
# node arb_spl.mjs RIN USDC >> arb_spl.log &
# node arb_spl.mjs MSOL WSOL >> arb_spl.log &
# node arb_spl.mjs STSOL WSOL >> arb_spl.log &
# node arb_spl.mjs UST USDC >> arb_spl.log &
# node arb_spl.mjs USDT USDC >> arb_spl.log &
node arb_spl.mjs WSOL USDC >> arb_spl.log &
ps ax | grep arb_spl
tail -f arb_spl.log
