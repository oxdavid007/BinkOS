import { ISwapProvider, SwapQuote, SwapParams } from '@binkai/swap-plugin';
import { ethers, Contract, Interface, Provider } from 'ethers';

// Enhanced interface with better type safety
interface TokenInfo extends Token {
  // Inherits all Token properties and maintains DRY principle
}

// Core system constants
const CONSTANTS = {
  DEFAULT_GAS_LIMIT: '350000',
  APPROVE_GAS_LIMIT: '50000',
  QUOTE_EXPIRY: 5 * 60 * 1000, // 5 minutes in milliseconds
  BNB_ADDRESS: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  KYBER_BNB_ADDRESS: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  KYBER_API_BASE: 'https://aggregator-api.kyberswap.com/bsc/',
} as const;

export interface SwapTransaction {
  to: string;
  data: string;
  value: string;
  gasLimit: string;
}

export interface Token {
  address: `0x${string}`;
  decimals: number;
  symbol: string;
  chainId: number;
}

enum ChainId {
  BSC = 56,
  ETH = 1,
}

export class KyberProvider implements ISwapProvider {
  private provider: Provider;
  private chainId: ChainId;
  // Token cache with expiration time
  private tokenCache: Map<string, { token: Token; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  // Quote storage with expiration
  private quotes: Map<string, { quote: SwapQuote; expiresAt: number }> = new Map();

  constructor(provider: Provider, chainId: ChainId = ChainId.BSC) {
    this.provider = provider;
    this.chainId = chainId;
  }

  getName(): string {
    return 'kyber';
  }

  getSupportedChains(): string[] {
    return ['bnb', 'ethereum'];
  }

  getPrompt(): string {
    return `If you are using KyberSwap, You can use BNB with address ${CONSTANTS.BNB_ADDRESS}`;
  }

  private async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    const erc20Interface = new Interface([
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
    ]);

    const contract = new Contract(tokenAddress, erc20Interface, this.provider);
    const [decimals, symbol] = await Promise.all([contract.decimals(), contract.symbol()]);

    return {
      address: tokenAddress.toLowerCase() as `0x${string}`,
      decimals: Number(decimals),
      symbol,
      chainId: this.chainId,
    };
  }

  /**
   * Retrieves token information with caching and TTL
   * @param tokenAddress The address of the token
   * @returns Promise<Token>
   */
  private async getToken(tokenAddress: string): Promise<Token> {
    const now = Date.now();
    const cached = this.tokenCache.get(tokenAddress);

    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      return cached.token;
    }

    const info = await this.getTokenInfo(tokenAddress);
    console.log('🤖 Token info', info);
    const token = {
      chainId: info.chainId,
      address: info.address.toLowerCase() as `0x${string}`,
      decimals: info.decimals,
      symbol: info.symbol,
    };

    this.tokenCache.set(tokenAddress, { token, timestamp: now });
    return token;
  }

  async getQuote(params: SwapParams, userAddress: string): Promise<SwapQuote> {
    try {
      // Fetch input and output token information
      const [sourceToken, destinationToken] = await Promise.all([
        this.getToken(params.fromToken),
        this.getToken(params.toToken),
      ]);

      // Calculate input amount based on decimals
      const swapAmount =
        params.type === 'input'
          ? Math.floor(Number(params.amount) * 10 ** sourceToken.decimals)
          : undefined;

      // Convert BNB addresses to KYBER format if needed
      const sourceAddress =
        sourceToken.address === CONSTANTS.BNB_ADDRESS
          ? CONSTANTS.KYBER_BNB_ADDRESS
          : sourceToken.address;
      const destinationAddress =
        destinationToken.address === CONSTANTS.BNB_ADDRESS
          ? CONSTANTS.KYBER_BNB_ADDRESS
          : destinationToken.address;

      // Fetch optimal swap route
      const optimalRoute = await this.fetchOptimalRoute(
        sourceAddress,
        destinationAddress,
        swapAmount,
      );

      // Build swap transaction
      const swapTransactionData = await this.buildSwapRouteTransaction(optimalRoute, userAddress);

      // Create and store quote
      const swapQuote = this.createSwapQuote(
        params,
        sourceToken,
        destinationToken,
        swapTransactionData,
        optimalRoute,
      );
      this.storeQuoteWithExpiry(swapQuote);

      return swapQuote;
    } catch (error: unknown) {
      console.error('Error getting quote:', error);
      throw new Error(
        `Failed to get quote: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // Helper methods for better separation of concerns
  private async fetchOptimalRoute(sourceToken: string, destinationToken: string, amount?: number) {
    const routePath = `api/v1/routes?tokenIn=${sourceToken}&tokenOut=${destinationToken}&amountIn=${amount}&gasInclude=true`;
    const routeResponse = await fetch(`${CONSTANTS.KYBER_API_BASE}${routePath}`);
    const routeData = await routeResponse.json();

    if (!routeData.data || routeData.data.length === 0) {
      throw new Error('No swap routes available from Kyber');
    }
    return routeData.data;
  }

  private async buildSwapRouteTransaction(routeData: any, userAddress: string) {
    const transactionResponse = await fetch(`${CONSTANTS.KYBER_API_BASE}api/v1/route/build`, {
      method: 'POST',
      body: JSON.stringify({
        routeSummary: routeData.routeSummary,
        sender: userAddress,
        recipient: userAddress,
        skipSimulateTx: false,
        slippageTolerance: 200,
      }),
    });
    return (await transactionResponse.json()).data;
  }

  private createSwapQuote(
    params: SwapParams,
    sourceToken: Token,
    destinationToken: Token,
    swapTransactionData: any,
    routeData: any,
  ): SwapQuote {
    const quoteId = ethers.hexlify(ethers.randomBytes(32));

    return {
      quoteId,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: swapTransactionData.amountIn,
      toAmount: swapTransactionData.amountOut,
      fromTokenDecimals: sourceToken.decimals,
      toTokenDecimals: destinationToken.decimals,
      slippage: 100, // 10% default slippage
      type: params.type,
      priceImpact: routeData.priceImpact || 0,
      route: ['kyber'],
      estimatedGas: CONSTANTS.DEFAULT_GAS_LIMIT,
      tx: {
        to: swapTransactionData.routerAddress,
        data: swapTransactionData.data,
        value: swapTransactionData.transactionValue || '0',
        gasLimit: CONSTANTS.DEFAULT_GAS_LIMIT,
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

  async buildSwapTransaction(quote: SwapQuote, userAddress: string): Promise<SwapTransaction> {
    try {
      // Get the stored quote and trade
      const storedData = this.quotes.get(quote.quoteId);

      if (!storedData) {
        throw new Error('Quote expired or not found. Please get a new quote.');
      }

      return {
        to: storedData?.quote.tx?.to || '',
        data: storedData?.quote?.tx?.data || '',
        value: storedData?.quote?.tx?.value || '0',
        gasLimit: '350000',
      };
    } catch (error: unknown) {
      console.error('Error building swap transaction:', error);
      throw new Error(
        `Failed to build swap transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async buildApproveTransaction(
    token: string,
    spender: string,
    amount: string,
    userAddress: string,
  ): Promise<SwapTransaction> {
    const tokenInfo = await this.getToken(token);
    const erc20Interface = new Interface([
      'function approve(address spender, uint256 amount) returns (bool)',
    ]);

    const data = erc20Interface.encodeFunctionData('approve', [
      spender,
      ethers.parseUnits(amount, tokenInfo.decimals),
    ]);

    return {
      to: token,
      data,
      value: '0',
      gasLimit: '100000',
    };
  }

  async checkAllowance(token: string, owner: string, spender: string): Promise<bigint> {
    const erc20 = new Contract(
      token,
      ['function allowance(address owner, address spender) view returns (uint256)'],
      this.provider,
    );
    return await erc20.allowance(owner, spender);
  }
}
