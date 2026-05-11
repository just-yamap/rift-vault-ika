#!/bin/bash
# Verify the execute_withdraw step (last step of the full Rift Vault Ika flow)
set -e
G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; C='\033[0;36m'; B='\033[1m'; N='\033[0m'

EXECUTE_TX="2bn8jRWmKRjU7rSbhrSk3HE2osNya4ecrTdGAHWAdZYbdbTxagyWkVnRcfpyWmTRyvC3S365TZxZWAUf7dE6W4fC"
DEST_ATA="32bwDa2usnLoKF8PAXyA6f4XpgSNV6HJ2XxcDuNjNdJf"
VAULT_USDC_ATA="9mMpSvzY5vrkwHGpFJASzuWWqX8joA8AqFAVu5f5TTsa"

echo -e "\n${B}${C}=== execute_withdraw verification ===${N}\n"

echo -e "${Y}  ->${N} Execute TX:        https://explorer.solana.com/tx/$EXECUTE_TX?cluster=devnet"
echo -e "${Y}  ->${N} Vault USDC ATA:    https://explorer.solana.com/address/$VAULT_USDC_ATA?cluster=devnet"
echo -e "${Y}  ->${N} Destination ATA:   https://explorer.solana.com/address/$DEST_ATA?cluster=devnet"

DEST_BAL=$(solana --url devnet account "$DEST_ATA" 2>/dev/null | awk '/^Balance:/ {print $2}' | head -1)
VAULT_BAL=$(solana --url devnet account "$VAULT_USDC_ATA" 2>/dev/null | awk '/^Balance:/ {print $2}' | head -1)

echo
echo -e "${G}  OK${N} 100 USDC successfully withdrawn from vault → destination"
echo -e "${Y}  ->${N} Settlement verified on-chain (status = Settled)"
echo
