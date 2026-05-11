#!/bin/bash
set -e

G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; C='\033[0;36m'; B='\033[1m'; N='\033[0m'
say_ok()   { echo -e "${G}  OK${N} $1"; }
say_fail() { echo -e "${R}  FAIL${N} $1"; exit 1; }
say_info() { echo -e "${Y}  ->${N} $1"; }
say_step() { echo -e "\n${B}${C}=== $1 ===${N}\n"; }

PROGRAM_ID="DFGhPRE6x6YWMKMcEwTrLMt6rBSwQDveq7bVC2Lm6XxZ"
IKA_PROGRAM_ID="87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY"
DWALLET_PDA="54jCzFuk7FyfdZRExC2u7LC28EAJMRqVLrRbJNDqhfwy"
VAULT_CONFIG="C9a2ZhG5vqGEACsv9XY3wokYVnx3if2tdsCam21trTfh"
WITHDRAW_REQ="G46EsymfWt5gK93QkGu4gBAjouHQhzXH4LZWP9rHfwbN"
MSG_APPROVAL="Dhvzue2HZJSSR1ReTQVH9byEU81WoHm2i79VuqZpkqV1"
WITHDRAW_TX="2HY2v1hpWRggeCnhu2ctutFekHr4krwJN6Vo9jikVU6A6BJWiGuRFZBi1yjeYV2rdEzj1VEfde9UMbVBgDiLq9YN"

say_step "1/7  Environment"
solana --version
BAL=$(solana --url devnet balance | awk '{print $1}')
say_info "Devnet balance: $BAL SOL"

say_step "2/7  Rift Vault program deployed"
OWNER=$(solana --url devnet account "$PROGRAM_ID" 2>&1 | awk '/^Owner:/ {print $2}')
[ "$OWNER" = "BPFLoaderUpgradeab1e11111111111111111111111" ] && say_ok "Program deployed" || say_fail "Owner=$OWNER"
say_info "$PROGRAM_ID"

say_step "3/7  Ika dWallet program live"
IKA_OWNER=$(solana --url devnet account "$IKA_PROGRAM_ID" 2>&1 | awk '/^Owner:/ {print $2}')
[ "$IKA_OWNER" = "BPFLoaderUpgradeab1e11111111111111111111111" ] && say_ok "Ika live" || say_fail "Ika Owner=$IKA_OWNER"

say_step "4/7  dWallet DKG'd, owned by Ika"
DW_OWNER=$(solana --url devnet account "$DWALLET_PDA" 2>&1 | awk '/^Owner:/ {print $2}')
DW_LEN=$(solana --url devnet account "$DWALLET_PDA" 2>&1 | awk '/^Length:/ {print $2}')
[ "$DW_OWNER" = "$IKA_PROGRAM_ID" ] && say_ok "dWallet owned by Ika ($DW_LEN bytes)" || say_fail "dW Owner=$DW_OWNER"

say_step "5/7  VaultConfig initialized"
VC_OWNER=$(solana --url devnet account "$VAULT_CONFIG" 2>&1 | awk '/^Owner:/ {print $2}')
[ "$VC_OWNER" = "$PROGRAM_ID" ] && say_ok "VaultConfig OK" || say_fail "VC Owner=$VC_OWNER"

say_step "6/7  WithdrawRequest persisted"
WR_OWNER=$(solana --url devnet account "$WITHDRAW_REQ" 2>&1 | awk '/^Owner:/ {print $2}')
WR_LEN=$(solana --url devnet account "$WITHDRAW_REQ" 2>&1 | awk '/^Length:/ {print $2}')
[ "$WR_OWNER" = "$PROGRAM_ID" ] && say_ok "WithdrawRequest persisted ($WR_LEN bytes)" || say_fail "WR Owner=$WR_OWNER"

say_step "7/7  MessageApproval = Signed + 2PC-MPC sig on-chain"
MA_OWNER=$(solana --url devnet account "$MSG_APPROVAL" 2>&1 | awk '/^Owner:/ {print $2}')
MA_LEN=$(solana --url devnet account "$MSG_APPROVAL" 2>&1 | awk '/^Length:/ {print $2}')
[ "$MA_OWNER" = "$IKA_PROGRAM_ID" ] && say_ok "MessageApproval owned by Ika ($MA_LEN bytes)" || say_fail "MA Owner=$MA_OWNER"
STATUS=$(solana --url devnet account "$MSG_APPROVAL" --output json 2>/dev/null | python3 -c "import sys,json,base64; d=json.load(sys.stdin); raw=base64.b64decode(d['account']['data'][0]); print(raw[172])")
[ "$STATUS" = "1" ] && say_ok "Status = Signed (1)" || say_fail "Status=$STATUS"

echo
echo -e "${G}${B}=== ALL 7 CHECKS PASSED — Rift Vault Ika OPERATIONAL on devnet ===${N}"
echo
echo "Proofs (devnet explorer):"
echo "  Program        : https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo "  dWallet        : https://explorer.solana.com/address/$DWALLET_PDA?cluster=devnet"
echo "  Vault config   : https://explorer.solana.com/address/$VAULT_CONFIG?cluster=devnet"
echo "  WithdrawReq    : https://explorer.solana.com/address/$WITHDRAW_REQ?cluster=devnet"
echo "  MessageApproval: https://explorer.solana.com/address/$MSG_APPROVAL?cluster=devnet"
echo "  Withdraw TX    : https://explorer.solana.com/tx/$WITHDRAW_TX?cluster=devnet"
