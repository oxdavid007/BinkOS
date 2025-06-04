import { z } from 'zod';
import {
  AgentNodeTypes,
  BaseTool,
  CustomDynamicStructuredTool,
  IToolConfig,
  ToolProgress,
  ErrorStep,
  StructuredError,
  NetworkName,
  logger,
} from '@binkai/core';
import { ProviderRegistry } from './ProviderRegistry';
import { IWalletProvider, WalletInfo, WalletBalance } from './types';
import { defaultTokens } from '@binkai/token-plugin';

export interface WalletToolConfig extends IToolConfig {
  defaultNetwork?: string;
  supportedNetworks?: string[];
}

export function mergeObjects<T extends Record<string, any>>(obj1: T, obj2: T): T {
  // Create a new object to avoid mutating the inputs
  const result = { ...obj1 };

  // Add or override properties from obj2
  for (const key in obj2) {
    if (Object.prototype.hasOwnProperty.call(obj2, key)) {
      // If both objects have the same key and both values are objects, merge recursively
      if (
        key in result &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        typeof obj2[key] === 'object' &&
        obj2[key] !== null &&
        !Array.isArray(result[key]) &&
        !Array.isArray(obj2[key])
      ) {
        result[key] = mergeObjects(result[key], obj2[key]);
      } else if (obj2[key] === null || obj2[key] === undefined) {
        // Keep obj1's value if obj2's value is null or undefined
        continue;
      } else if (result[key] === null || result[key] === undefined) {
        // Take obj2's value if obj1's value is null or undefined
        result[key] = obj2[key];
      } else {
        // Otherwise just take the value from obj2
        result[key] = obj2[key];
      }
    }
  }

  return result;
}

export class GetWalletBalanceTool extends BaseTool {
  public readonly agentNodeSupports: AgentNodeTypes[] = [
    AgentNodeTypes.PLANNER,
    AgentNodeTypes.EXECUTOR,
  ];
  public registry: ProviderRegistry;
  private supportedNetworks: Set<string>;

  constructor(config: WalletToolConfig) {
    super(config);
    this.registry = new ProviderRegistry();
    this.supportedNetworks = new Set<string>(config.supportedNetworks || []);
  }

  registerProvider(provider: IWalletProvider): void {
    this.registry.registerProvider(provider);
    logger.info('🔌 Provider registered:', provider.constructor.name);
    provider?.getSupportedNetworks().forEach(network => {
      this.supportedNetworks.add(network);
    });
  }

  getName(): string {
    return 'get_wallet_balance';
  }

  getDescription(): string {
    const providers = this.registry.getProviderNames().join(', ');
    const networks = Array.from(this.supportedNetworks).join(', ');

    return `Returns token and native coin balances for a wallet. If no network is specified, all supported networks will be queried. If no address is provided, the agent's wallet address is used.
  
  Supported networks: ${networks || 'none registered yet'}.
  Available providers: ${providers || 'none registered yet'}.`;
  }

  private getSupportedNetworks(): string[] {
    const agentNetworks = Object.keys(this.agent.getNetworks());
    const providerNetworks = Array.from(this.supportedNetworks);
    return agentNetworks.filter(network => providerNetworks.includes(network));
  }

  mockResponseTool(args: any): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        status: args.status,
      }),
    );
  }

  getSchema(): z.ZodObject<any> {
    const supportedNetworks = this.getSupportedNetworks();
    if (supportedNetworks.length === 0) {
      throw new Error('No supported networks available');
    }

    return z.object({
      address: z
        .string()
        .optional()
        .describe(
          "The wallet address to query. If not provided, the agent's wallet address will be used automatically.",
        ),
      network: z
        .enum(['bnb', 'solana', 'ethereum', 'hyperliquid', 'base'])
        .optional()
        .describe('The blockchain network to query the wallet on.'),
    });
  }

  private addAddressToNativeBalance(results: WalletInfo, network: NetworkName): WalletInfo {
    if (results?.nativeBalance && !results.nativeBalance.tokenAddress) {
      const nativeSymbol = results.nativeBalance.symbol;

      // Find the native token address from defaultTokens
      if (defaultTokens && defaultTokens[network]) {
        // Look for the native token in defaultTokens
        for (const address in defaultTokens[network]) {
          const token = defaultTokens[network][address];
          if (token.symbol === nativeSymbol) {
            results.nativeBalance.tokenAddress = address;
            break;
          }
        }
      }
    }
    return results;
  }

  private async fetchHyperliquidBalance(userAddress: string): Promise<WalletInfo> {
    const url = 'https://api-ui.hyperliquid.xyz/info';
    const payload = {
      type: 'spotClearinghouseState',
      user: userAddress,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();

      // Convert Hyperliquid response to WalletInfo format
      const tokens: WalletBalance[] = data.balances?.map((balance: any) => ({
        symbol: balance.coin,
        balance: balance.total,
        decimals: 18, // Default decimals, you might need to adjust based on token
        name: balance.coin,
        tokenAddress: balance.token?.toString(),
      })) || [];


      const walletInfo: WalletInfo = {
        address: userAddress,
        tokens: tokens,
      };

      return walletInfo;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw error;
    }
  }
  

  createTool(): CustomDynamicStructuredTool {
    logger.info('🛠️ Creating wallet balance tool');
    return {
      name: this.getName(),
      description: this.getDescription(),
      schema: this.getSchema(),
      func: async (
        args: any,
        runManager?: any,
        config?: any,
        onProgress?: (data: ToolProgress) => void,
      ) => {
        try {
          const network = args.network;
          let address = args.address;
          logger.info(`🔍 Getting wallet balance for ${address || 'agent wallet'} on ${network}`);

          // STEP 1: Validate network
          const supportedNetworks = this.getSupportedNetworks();
          if (!supportedNetworks.includes(network)) {
            logger.error(`❌ Network ${network} is not supported`);
            throw this.createError(
              ErrorStep.NETWORK_VALIDATION,
              `Network ${network} is not supported.`,
              {
                requestedNetwork: network,
                supportedNetworks: supportedNetworks,
              },
            );
          }

          // Special handling for Hyperliquid
          if (network === 'hyperliquid') {
            onProgress?.({
              progress: 50,
              message: `Retrieving hyperliquid balance for ${address}`,
            });
            
            const hyperliquidBalance = await this.fetchHyperliquidBalance(address);
            
            onProgress?.({
              progress: 100,
              message: `Successfully retrieved hyperliquid balance for ${address}`,
            });

            return JSON.stringify({
              status: 'success',
              data: hyperliquidBalance,
              network,
              address,
            });
          }

          // STEP 2: Get wallet address
          try {
            // If no address provided, get it from the agent's wallet
            if (!address) {
              logger.info('🔑 No address provided, using agent wallet');
              address = await this.agent.getWallet().getAddress(network);
              logger.info(`🔑 Using agent wallet address: ${address}`);
            }
          } catch (error) {
            logger.error(`❌ Failed to get wallet address for network ${network}`);
            throw error;
          }

          onProgress?.({
            progress: 20,
            message: `Retrieving wallet information for ${address}`,
          });

          // STEP 3: Check providers
          const providers = this.registry.getProvidersByNetwork(network);
          if (providers.length === 0) {
            logger.error(`❌ No providers available for network ${network}`);
            throw this.createError(
              ErrorStep.PROVIDER_AVAILABILITY,
              `No providers available for network ${network}.`,
              {
                network: network,
                availableProviders: this.registry.getProviderNames(),
                supportedNetworks: Array.from(this.supportedNetworks),
              },
            );
          }

          logger.info(`🔄 Found ${providers.length} providers for network ${network}`);

          let results: WalletInfo = {};
          const errors: Record<string, string> = {};

          // STEP 4: Query providers
          // Try all providers and collect results
          for (const provider of providers) {
            logger.info(`🔄 Querying provider: ${provider.getName()}`);
            try {
              const data = await provider.getWalletInfo(address, network);
              logger.info(`✅ Successfully got data from ${provider.getName()}`);
              results = mergeObjects(results, data);
            } catch (error) {
              logger.warn(
                `⚠️ Failed to get wallet info from ${provider.getName()}: ${error instanceof Error ? error.message : error}`,
              );
              this.logError(
                `Failed to get wallet info from ${provider.getName()}: ${error}`,
                'warn',
              );
              errors[provider.getName()] = error instanceof Error ? error.message : String(error);
            }
          }

          // If no successful results, throw error
          if (Object.keys(results).length === 0) {
            logger.error(`❌ All providers failed for ${address}`);
            throw `All providers failed for ${address}`;
          }

          logger.info(`💰 Wallet info retrieved successfully for ${address}`);

          if (Object.keys(errors).length > 0) {
            logger.warn(`⚠️ Some providers failed but we have partial results`);
          }

          onProgress?.({
            progress: 100,
            message: `Successfully retrieved wallet information for ${address}`,
          });

          // Add address to nativeBalance if it exists
          results = this.addAddressToNativeBalance(results, network);

          logger.info(`✅ Returning wallet balance data for ${address}`);

          if (results?.tokens && Array.isArray(results?.tokens)) {
            results.tokens = results.tokens.filter(token => {
              if (token?.symbol === 'BNB' || token?.symbol === 'ETH' || token?.symbol === 'SOL') {
                return true;
              }
              return Number(token?.usdValue) > 0.00001 && Number(token?.balance) > 0.00001;
            });
          }

          return JSON.stringify({
            status: 'success',
            data: results,
            errors: Object.keys(errors).length > 0 ? errors : undefined,
            network,
            address,
          });
        } catch (error) {
          logger.error(
            '❌ Error in wallet balance tool:',
            error instanceof Error ? error.message : error,
          );
          return this.handleError(error, args);
        }
      },
    };
  }
}
