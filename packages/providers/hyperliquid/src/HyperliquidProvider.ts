import { SwapQuote, SwapParams, BaseSwapProvider, NetworkProvider } from '@binkai/swap-plugin';
import { ethers, Provider } from 'ethers';
import { EVM_NATIVE_TOKEN_ADDRESS, NetworkName, Token, logger } from '@binkai/core';
import { TokenQueryParams, TokenInfo } from '@binkai/token-plugin';

// Core system constants
const CONSTANTS = {
  DEFAULT_GAS_LIMIT: '350000',
  APPROVE_GAS_LIMIT: '50000',
  QUOTE_EXPIRY: 5 * 60 * 1000, // 5 minutes in milliseconds
  HYPERLIQUID_BNB_ADDRESS: EVM_NATIVE_TOKEN_ADDRESS,
  HYPERLIQUID_API_BASE: {
    [NetworkName.BNB]: 'https://api.hyperliquid.xyz/v1/',
    [NetworkName.BASE]: 'https://api.hyperliquid.xyz/v1/',
  },
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
  protected GAS_BUFFER: bigint = ethers.parseEther('0.0003');

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
    return tokenAddress.toLowerCase() === EVM_NATIVE_TOKEN_ADDRESS.toLowerCase();
  }


  /* 
  Search token info by hyperliquid api
  Input: Query + Network 
  Query: symbol/address
  Network: NetworkName
  */
  async findToken(query: string, network: NetworkName): Promise<TokenInfo> {
    try {
      
      const response = await fetch('https://api-ui.hyperliquid.xyz/info', {
        method: 'POST',
        headers: {
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Connection': 'keep-alive',
          'Content-Type': 'application/json',
          'Origin': 'https://app.hyperliquid.xyz',
          'Referer': 'https://app.hyperliquid.xyz/',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-site',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
          'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Linux"'
        },
        body: JSON.stringify({
          type: 'spotMeta'
        })
      });

      const parseResponse = await response.json();
      const allTokens = parseResponse.tokens;


      const hyperTokenInfo = allTokens.find(
        (t: any) =>
          t.name?.toLowerCase() === query.toLowerCase() ||
          t.tokenId?.toLowerCase() === query.toLowerCase()
      );


      const tokenInfo: TokenInfo = {
        address: hyperTokenInfo.tokenId || '',
        symbol: hyperTokenInfo.name,
        name: hyperTokenInfo.fullName || hyperTokenInfo.name,
        decimals: hyperTokenInfo.weiDecimals,
        network: network as NetworkName,
      }

      return tokenInfo as TokenInfo;
      

    } catch (error) {
      console.error(`Error in findToken in  hyperliquid provider: ${error}`);
      throw error;
    }
  }


  private async callHyperliquidApi(
    amount: string,
    fromToken: Token,
    toToken: Token,
    userAddress: string,
  ) {
    const network = this.chainId === ChainId.BASE ? NetworkName.BASE : NetworkName.BNB;
    const routePath = `api/v1/routes?tokenIn=${fromToken.address}&tokenOut=${toToken.address}&amountIn=${amount}&gasInclude=true`;
    logger.info('🤖 Kyber Path', routePath);
    const routeResponse = await fetch(`${CONSTANTS.HYPERLIQUID_API_BASE[network]}${routePath}`);
    const routeData = await routeResponse.json();

    if (!routeData.data || routeData.data.length === 0) {
      throw new Error('No swap routes available from Kyber');
    }

    const transactionResponse = await fetch(
      `${CONSTANTS.HYPERLIQUID_API_BASE[network]}api/v1/route/build`,
      {
        method: 'POST',
        body: JSON.stringify({
          routeSummary: routeData.data.routeSummary,
          sender: userAddress,
          recipient: userAddress,
          skipSimulateTx: false,
          slippageTolerance: 200,
        }),
      },
    );

    return {
      routeData: routeData.data,
      transactionData: (await transactionResponse.json()).data,
    };
  }

  private async getReverseQuote(
    amount: string,
    fromToken: Token,
    toToken: Token,
    userAddress: string,
  ): Promise<string> {
    // Swap fromToken and toToken to get reverse quote
    const result = await this.callHyperliquidApi(amount, toToken, fromToken, userAddress);
    logger.info('🚀 ~ HyperliquidProvider ~ result:', result);
    const outputAmount = result.transactionData.amountOut;
    return ethers.formatUnits(outputAmount, toToken.decimals);
  }

  async getQuote(params: SwapParams, userAddress: string): Promise<SwapQuote> {
    try {
      // check is valid limit order
      if (params?.limitPrice) {
        throw new Error('Hyperliquid does not support limit order for native token swaps');
      }

      // Fetch input and output token information
      // const [sourceToken, destinationToken] = await Promise.all([
      //   this.getToken(params.fromToken, params.network),
      //   this.getToken(params.toToken, params.network),
      // ]);


      let sourceToken, destinationToken;

      [sourceToken, destinationToken] = await Promise.all([
        await this.findToken(params.fromToken, params.network),
        await this.findToken(params.toToken, params.network),
      ]);


      let adjustedAmount = params.amount;
      if (params.type === 'input') {
        // Use the adjustAmount method for all tokens (both native and ERC20)
        adjustedAmount = await this.adjustAmount(
          params.fromToken,
          params.amount,
          userAddress,
          params.network,
        );

        if (adjustedAmount !== params.amount) {
          logger.info(
            `🤖 Hyperliquid adjusted input amount from ${params.amount} to ${adjustedAmount}`,
          );
        }
      }

      // Calculate amountIn based on swap type
      let amountIn: string;
      if (params.type === 'input') {
        amountIn = ethers.parseUnits(adjustedAmount, sourceToken.decimals).toString();
      } else {
        // For output type, get reverse quote to calculate input amount
        const amountReverse = ethers.parseUnits('1', destinationToken.decimals).toString();

        const reverseAdjustedAmount = await this.getReverseQuote(
          amountReverse,
          sourceToken,
          destinationToken,
          userAddress,
        );

        const realAmount = Number(reverseAdjustedAmount) * Number(adjustedAmount);

        amountIn = ethers.parseUnits(realAmount.toString(), sourceToken.decimals).toString();
      }

      console.log('🚀 ~ HyperliquidProvider ~ getQuote ~ amountIn:', amountIn);
      console.log('🚀 ~ HyperliquidProvider ~ getQuote ~ sourceToken:', sourceToken);
      console.log('🚀 ~ HyperliquidProvider ~ getQuote ~ destinationToken:', destinationToken);
      console.log('🚀 ~ HyperliquidProvider ~ getQuote ~ userAddress:', userAddress);
      // Get swap route and transaction data
      const { routeData, transactionData } = await this.callHyperliquidApi(
        amountIn,
        sourceToken,
        destinationToken,
        userAddress,
      );

      // Create and store quote
      const swapQuote = this.createSwapQuote(
        params,
        sourceToken,
        destinationToken,
        transactionData,
        routeData,
      );
      this.storeQuoteWithExpiry(swapQuote);
      return swapQuote;
    } catch (error: unknown) {
      logger.error('Error getting quote:', error);
      throw new Error(
        `Failed to get quote: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // Helper methods for better separation of concerns
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
      network: params.network,
      fromToken: sourceToken,
      toToken: destinationToken,
      fromAmount: ethers.formatUnits(swapTransactionData.amountIn, sourceToken.decimals),
      toAmount: ethers.formatUnits(swapTransactionData.amountOut, destinationToken.decimals),
      slippage: 100, // 10% default slippage
      type: params.type,
      priceImpact: routeData.priceImpact || 0,
      route: ['hyperliquid'],
      estimatedGas: CONSTANTS.DEFAULT_GAS_LIMIT,
      tx: {
        to: swapTransactionData.routerAddress,
        data: swapTransactionData.data,
        value: swapTransactionData.transactionValue || '0',
        gasLimit: ethers.parseUnits(CONSTANTS.DEFAULT_GAS_LIMIT, 'wei'),
        network: params.network,
        spender: swapTransactionData.routerAddress,
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
