import {
  SwapQuote,
  SwapParams,
  BaseSwapProvider,
  NetworkProvider,
  Transaction,
} from '@binkai/swap-plugin';
import { ethers, Provider } from 'ethers';
import { NetworkName, Token, logger } from '@binkai/core';
import { orderRequestToOrderWire, orderWiresToOrderAction } from './utils/order';
import { OrderRequest } from './utils/order';
import { signStandardL1Action } from './utils/singing';
import { privateKeyToAccount } from 'viem/accounts';
import axios from 'axios';

// Core system constants
const CONSTANTS = {
  DEFAULT_GAS_LIMIT: '350000',
  APPROVE_GAS_LIMIT: '50000',
  QUOTE_EXPIRY: 5 * 60 * 1000, // 5 minutes in milliseconds
  HYPERLIQUID_API_BASE: {
    [NetworkName.BNB]: 'https://api.hyperliquid.xyz/v1/',
    [NetworkName.BASE]: 'https://api.hyperliquid.xyz/v1/',
  },
  USDC_ADDRESS: '0x6d1e7cde53ba9467b783cb7c530ce054',
} as const;

enum ChainId {
  BSC = 56,
  ETH = 1,
  BASE = 8453,
  HYPERLIQUID = 999,
}

export class HyperliquidProvider extends BaseSwapProvider {
  private provider: Provider;
  private chainId: ChainId;

  constructor(provider: Provider, chainId: ChainId = ChainId.HYPERLIQUID) {
    // Create a Map with BNB network and the provider
    const providerMap = new Map<NetworkName, NetworkProvider>();
    if (chainId === ChainId.HYPERLIQUID) {
      providerMap.set(NetworkName.HYPERLIQUID, provider);
    }

    super(providerMap);
    this.provider = provider;
    this.chainId = chainId;
  }

  getName(): string {
    return 'hyperliquid';
  }

  getSupportedChains(): string[] {
    return ['hyperliquid'];
  }

  getSupportedNetworks(): NetworkName[] {
    return [NetworkName.HYPERLIQUID];
  }

  protected isNativeToken(tokenAddress: string): boolean {
    return tokenAddress.toLowerCase() === CONSTANTS.USDC_ADDRESS.toLowerCase();
  }

  protected async getToken(tokenAddress: string, network: NetworkName): Promise<Token> {
    const token = await (
      await fetch(`https://api-ui.hyperliquid.xyz/info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'tokenDetails',
          tokenId: tokenAddress,
        }),
      })
    ).json();

    const tokenInfo = {
      chainId: this.chainId,
      address: tokenAddress,
      decimals: tokenAddress === CONSTANTS.USDC_ADDRESS ? 8 : token.weiDecimals,
      symbol: token.name,
      price: token.midPx,
    };
    return tokenInfo;
  }

  async getQuote(params1: SwapParams, userAddress: string): Promise<SwapQuote> {
    console.log('🚀 ~ HyperliquidProvider ~ getQuote ~ params1:', params1);
    try {
      // check is valid limit order
      if (params1?.limitPrice) {
        throw new Error('Hyperliquid does not support limit order for native token swaps');
      }

      const params: SwapParams = {
        fromToken: CONSTANTS.USDC_ADDRESS,
        toToken: '0x0d01dc56dcaaca66ad901c959b4011ec',
        type: 'input',
        amount: '1', // 1 USDC
        network: NetworkName.HYPERLIQUID,
        slippage: 10, // 10% default slippage
      };

      // Fetch input and output token information
      const [fromToken, toToken] = await Promise.all([
        this.getToken(params.fromToken, params.network),
        this.getToken(params.toToken, params.network),
      ]);

      let adjustedAmount = params.amount;
      // if (params.type === 'input') {
      //   // Use the adjustAmount method for all tokens (both native and ERC20)
      //   adjustedAmount = await this.adjustAmount(
      //     params.fromToken,
      //     params.amount,
      //     userAddress,
      //     params.network,
      //   );

      if (adjustedAmount !== params.amount) {
        logger.info(
          `🤖 Hyperliquid adjusted input amount from ${params.amount} to ${adjustedAmount}`,
        );
      }

      // Calculate amountIn based on swap type
      let amountIn: string;
      if (params.type === 'input') {
        amountIn = ethers.parseUnits(adjustedAmount, fromToken.decimals).toString();
      } else {
        // For output type, get reverse quote to calculate input amount
        throw new Error('Hyperliquid does not support output type swaps for native token swaps');
      }
      // Fetch swap transaction data from Hyperliquid API
      const swapTransactionData = {
        amountIn,
        amountOut:
          params.type === 'input'
            ? Number(adjustedAmount) / Number(toToken.price)
            : Number(adjustedAmount) / Number(fromToken.price),
      };

      // Create and store quote
      const swapQuote = this.createSwapQuote(params, fromToken, toToken, swapTransactionData);
      logger.info('🚀 ~ HyperliquidProvider ~ getQuote ~ swapQuote:', swapQuote);
      this.storeQuoteWithExpiry(swapQuote);
      return swapQuote;
    } catch (error: unknown) {
      logger.error('Error getting quote:', error);
      throw new Error(
        `Failed to get quote: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async checkBalance(
    quote: SwapQuote,
    walletAddress: string,
  ): Promise<{ isValid: boolean; message?: string }> {
    try {
      return { isValid: true };
    } catch (error) {
      logger.error('Error checking balance:', error);
      return {
        isValid: false,
        message: `Failed to check balance: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async buildSwapTransaction(quote: SwapQuote, pkWallet: string): Promise<Transaction> {
    console.log('🚀 ~ buildSwapTransaction ~ pkWallet:', pkWallet);
    console.log('🚀 ~ buildSwapTransaction ~ quote:', quote);
    const wallet = privateKeyToAccount(pkWallet as `0x${string}`);
    const vault_or_subaccount_address = null;
    const nonce = Date.now();

    const orderRequest: OrderRequest = {
      asset: 0, // BTC
      is_buy: true,
      sz: 0.001,
      limit_px: 90000,
      reduce_only: false,
      order_type: {
        limit: { tif: 'Gtc' }, // Gtc: Good till Cancel
      },
    };
    const orderWire = orderRequestToOrderWire(orderRequest);
    const orderAction = orderWiresToOrderAction([orderWire]);

    const signature = await signStandardL1Action(
      orderAction,
      wallet,
      vault_or_subaccount_address,
      nonce,
    );

    const requestData = {
      action: orderAction,
      nonce: nonce, // Current timestamp in milliseconds
      signature: signature,
    };

    // WARNING: This sends an actual order on the mainnet.
    // If switching to the testnet, also update the endpoint in Signing.tsx.
    const res = await axios.post('https://api.hyperliquid.xyz/exchange', requestData, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    console.log('🚀 ~ buildSwapTransaction ~ res:', res);

    return {
      to: '',
      data: res.data,
      value: '',
      spender: '',
      network: quote.network,
    };
  }

  // Helper methods for better separation of concerns
  private createSwapQuote(
    params: SwapParams,
    sourceToken: Token,
    destinationToken: Token,
    swapTransactionData: any,
  ): SwapQuote {
    const quoteId = ethers.hexlify(ethers.randomBytes(32));

    return {
      quoteId,
      network: params.network,
      fromToken: sourceToken,
      toToken: destinationToken,
      fromAmount: swapTransactionData.amountIn,
      toAmount: swapTransactionData.amountOut,
      slippage: 100, // 10% default slippage
      type: params.type,
      priceImpact: 0,
      route: ['hyperliquid'],
      estimatedGas: CONSTANTS.DEFAULT_GAS_LIMIT,
      tx: {
        to: '',
        data: '0x',
        value: '0', // For native token swaps, this will be 0
        gasLimit: ethers.parseUnits(CONSTANTS.DEFAULT_GAS_LIMIT, 'wei'),
        network: params.network,
        spender: '',
      },
    };
  }

  private storeQuoteWithExpiry(quote: SwapQuote) {
    this.quotes.set(quote.quoteId, { quote, expiresAt: Date.now() + CONSTANTS.QUOTE_EXPIRY });

    // Delete quote after expiry
    setTimeout(() => {
      this.quotes.delete(quote.quoteId);
    }, CONSTANTS.QUOTE_EXPIRY);
  }
}
