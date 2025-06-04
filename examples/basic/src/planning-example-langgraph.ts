import { ethers } from 'ethers';
import {
  Agent,
  Wallet,
  Network,
  settings,
  NetworkType,
  NetworksConfig,
  NetworkName,
  IToolExecutionCallback,
  ToolExecutionData,
  ToolExecutionState,
  PlanningAgent,
  IHumanReviewCallback,
  HumanReviewData,
  AskUserData,
  IAskUserCallback,
  OpenAIModel,
  logger,
} from '@binkai/core';
import { SwapPlugin } from '@binkai/swap-plugin';
import { OkxProvider } from '@binkai/okx-provider';
import { ThenaProvider } from '@binkai/thena-provider';
import { JupiterProvider } from '@binkai/jupiter-provider';
import { Connection } from '@solana/web3.js';
import { TokenPlugin } from '@binkai/token-plugin';
import { BirdeyeProvider } from '@binkai/birdeye-provider';
import { WalletPlugin } from '@binkai/wallet-plugin';
import { BnbProvider } from '@binkai/rpc-provider';
import { KyberProvider } from '@binkai/kyber-provider';
import { AlchemyProvider } from '@binkai/alchemy-provider';
import { HyperliquidProvider } from '@binkai/hyperliquid-provider';
import { BridgePlugin } from '@binkai/bridge-plugin';
import { deBridgeProvider } from '@binkai/debridge-provider';
import { KnowledgePlugin } from '@binkai/knowledge-plugin';
import { BinkProvider } from '@binkai/bink-provider';
import { ImagePlugin } from '@binkai/image-plugin';

// Hardcoded RPC URLs for demonstration
const BNB_RPC = 'https://bsc-dataseed1.binance.org';
const ETH_RPC = 'https://eth.llamarpc.com';
const SOL_RPC = 'https://api.mainnet-beta.solana.com';
const BASE_RPC = 'https://base.llamarpc.com';
const HYPERLIQUID_RPC = 'https://rpc.hyperliquid.xyz/evm';

// Example callback implementation
class ExampleToolExecutionCallback implements IToolExecutionCallback {
  onToolExecution(data: ToolExecutionData): void {
    const stateEmoji = {
      [ToolExecutionState.STARTED]: '🚀',
      [ToolExecutionState.IN_PROCESS]: '⏳',
      [ToolExecutionState.COMPLETED]: '✅',
      [ToolExecutionState.FAILED]: '❌',
    };

    const emoji = stateEmoji[data.state] || '🔄';

    console.log(`${emoji} [${new Date(data.timestamp).toISOString()}] ${data.message}`);

    if (data.state === ToolExecutionState.IN_PROCESS && data.data) {
      console.log(`   Progress: ${data.data.progress || 0}%`);
    }

    if (data.state === ToolExecutionState.COMPLETED && data.data) {
      console.log(
        `   Result: ${JSON.stringify(data.data).substring(0, 100)}${JSON.stringify(data.data).length > 100 ? '...' : ''}`,
      );
    }

    if (data.state === ToolExecutionState.FAILED && data.error) {
      console.log(`   Error: ${data.error.message || String(data.error)}`);
    }
  }
}

class ExampleHumanReviewCallback implements IHumanReviewCallback {
  onHumanReview(data: HumanReviewData): void {
    console.log(`Human review: ${data.toolName}`, data.data);
  }
}

class ExampleAskUserCallback implements IAskUserCallback {
  onAskUser(data: AskUserData): void {
    console.log(`Ask user: ${data.question}`);
  }
}

async function main() {
  console.log('🚀 Starting BinkOS planning example...\n');

  // Check required environment variables
  if (!settings.has('OPENAI_API_KEY')) {
    console.error('❌ Error: Please set OPENAI_API_KEY in your .env file');
    process.exit(1);
  }

  console.log('🔑 OpenAI API key found\n');

  //configure enable logger
  logger.enable();

  // Define available networks
  console.log('📡 Configuring networks...');
  const networks: NetworksConfig['networks'] = {
    [NetworkName.SOLANA]: {
      type: 'solana' as NetworkType,
      config: {
        rpcUrl: SOL_RPC,
        name: 'Solana',
        nativeCurrency: {
          name: 'Solana',
          symbol: 'SOL',
          decimals: 9,
        },
      },
    },
    [NetworkName.BNB]: {
      type: 'evm' as NetworkType,
      config: {
        chainId: 56,
        rpcUrl: BNB_RPC,
        name: 'BNB Chain',
        nativeCurrency: {
          name: 'BNB',
          symbol: 'BNB',
          decimals: 18,
        },
      },
    },
    [NetworkName.ETHEREUM]: {
      type: 'evm' as NetworkType,
      config: {
        chainId: 1,
        rpcUrl: ETH_RPC,
        name: 'Ethereum',
        nativeCurrency: {
          name: 'Ether',
          symbol: 'ETH',
          decimals: 18,
        },
      },
    },
    [NetworkName.BASE]: {
      type: 'evm' as NetworkType,
      config: {
        chainId: 8453,
        rpcUrl: BASE_RPC,
        name: 'Base',
        nativeCurrency: {
          name: 'Ether',
          symbol: 'ETH',
          decimals: 18,
        },
      },
    },
    [NetworkName.HYPERLIQUID]: {
      type: 'evm' as NetworkType,
      config: {
        chainId: 999,
        rpcUrl: HYPERLIQUID_RPC,
        name: 'Hyperliquid',
        nativeCurrency: {
          name: 'Hyperliquid',
          symbol: 'HYPE',
          decimals: 18,
        },
      },
    },
  };
  console.log('✓ Networks configured:', Object.keys(networks).join(', '), '\n');

  // Initialize network
  console.log('🌐 Initializing network...');
  const network = new Network({ networks });
  console.log('✓ Network initialized\n');

  // Initialize providers
  console.log('🔌 Initializing providers...');
  const bnbProvider = new ethers.JsonRpcProvider(BNB_RPC);
  const solProvider = new Connection(SOL_RPC);
  const ethProvider = new ethers.JsonRpcProvider(ETH_RPC);
  const baseProvider = new ethers.JsonRpcProvider(BASE_RPC);
  const hyperliquidProvider = new ethers.JsonRpcProvider(HYPERLIQUID_RPC);
  console.log('✓ Providers initialized\n');

  // Initialize a new wallet
  console.log('👛 Creating wallet...');
  const wallet = new Wallet(
    {
      seedPhrase:
        settings.get('WALLET_MNEMONIC') ||
        'test test test test test test test test test test test junk',
      index: 0,
    },
    network,
  );
  console.log('✓ Wallet created\n');

  console.log('🤖 Wallet BNB:', await wallet.getAddress(NetworkName.BNB));
  console.log('🤖 Wallet ETH:', await wallet.getAddress(NetworkName.ETHEREUM));
  console.log('🤖 Wallet SOL:', await wallet.getAddress(NetworkName.SOLANA));
  console.log('🤖 Wallet BASE:', await wallet.getAddress(NetworkName.BASE));
  console.log('🤖 Wallet HYPERLIQUID:', await wallet.getAddress(NetworkName.HYPERLIQUID));

  // Create an agent with OpenAI
  console.log('🤖 Initializing AI agent...');
  const llm = new OpenAIModel({
    apiKey: settings.get('OPENAI_API_KEY') || '',
    model: 'gpt-4o-mini',
  });
  const agent = new PlanningAgent(
    llm,
    {
      isHumanReview: true,
      temperature: 0,
      systemPrompt: `You are a BINK AI agent. You are able to perform swaps, bridges and get token information on multiple chains. 
        If you do not have the token address, you can use the symbol to get the token information before performing a bridge or swap.`,
    },
    wallet,
    networks,
  );
  console.log('✓ Agent initialized\n');

  // Register callbacks
  console.log('🔔 Registering callbacks...');
  agent.registerToolExecutionCallback(new ExampleToolExecutionCallback());
  agent.registerHumanReviewCallback(new ExampleHumanReviewCallback());
  agent.registerAskUserCallback(new ExampleAskUserCallback());
  console.log('✓ Callbacks registered\n');

  // Initialize providers for plugins
  const birdeye = new BirdeyeProvider({
    apiKey: settings.get('BIRDEYE_API_KEY'),
  });

  const alchemyProvider = new AlchemyProvider({
    apiKey: settings.get('ALCHEMY_API_KEY'),
  });

  const bnbProviderOS = new BnbProvider({
    rpcUrl: BNB_RPC,
  });

  const binkProvider = new BinkProvider({
    apiKey: settings.get('BINK_API_KEY') || '',
    baseUrl: settings.get('BINK_API_URL') || '',
    imageApiUrl: settings.get('BINK_IMAGE_API_URL') || '',
  });

  // Initialize Token Plugin
  console.log('🔍 Initializing token plugin...');
  const tokenPlugin = new TokenPlugin();
  await tokenPlugin.initialize({
    providers: [birdeye, alchemyProvider],
    supportedChains: ['solana', 'bnb', 'ethereum', 'base', 'hyperliquid'],
  });
  console.log('✓ Token plugin initialized\n');

  // Initialize Wallet Plugin
  console.log('🔄 Initializing wallet plugin...');
  const walletPlugin = new WalletPlugin();
  await walletPlugin.initialize({
    providers: [bnbProviderOS, alchemyProvider, birdeye],
    supportedChains: ['bnb', 'solana', 'base', 'hyperliquid'],
  });
  console.log('✓ Wallet plugin initialized\n');

  // Initialize Swap Plugin
  console.log('🔄 Initializing swap plugin...');
  const swapPlugin = new SwapPlugin();

  const ChainId = {
    BSC: 56,
    ETH: 1,
    BASE: 8453,
    HYPERLIQUID: 999,
  };

  // Create swap providers
  const okx = new OkxProvider(bnbProvider, 56);
  const jupiter = new JupiterProvider(solProvider);
  const thena = new ThenaProvider(ethProvider, 1);
  const kyber = new KyberProvider(baseProvider, 8453 as number);
  const hyperliquid = new HyperliquidProvider(hyperliquidProvider, ChainId.HYPERLIQUID);

  await swapPlugin.initialize({
    defaultSlippage: 0.5,
    providers: [okx, thena, jupiter, kyber, hyperliquid],
    supportedChains: ['bnb', 'ethereum', 'solana', 'base', 'hyperliquid'],
  });
  console.log('✓ Swap plugin initialized\n');

  // Initialize Bridge Plugin
  console.log('🔄 Initializing bridge plugin...');
  const bridgePlugin = new BridgePlugin();
  const debridge = new deBridgeProvider([bnbProvider, solProvider], 56, 7565164);

  await bridgePlugin.initialize({
    providers: [debridge],
    supportedChains: ['bnb', 'solana', 'base'],
  });
  console.log('✓ Bridge plugin initialized\n');

  // Initialize Knowledge Plugin
  console.log('🔄 Initializing knowledge plugin...');
  const knowledgePlugin = new KnowledgePlugin();
  await knowledgePlugin.initialize({
    providers: [binkProvider],
  });
  console.log('✓ Knowledge plugin initialized\n');

  // Initialize Image Plugin
  console.log('🔄 Initializing image plugin...');
  const imagePlugin = new ImagePlugin();
  await imagePlugin.initialize({
    providers: [binkProvider],
    supportedChains: ['bnb'],
  });
  console.log('✓ Image plugin initialized\n');

  // Register plugins with agent
  console.log('🔌 Registering plugins with agent...');
  await agent.registerPlugin(walletPlugin);
  await agent.registerListPlugins([swapPlugin, tokenPlugin, bridgePlugin, knowledgePlugin, imagePlugin]);
  console.log('✓ All plugins registered\n');

  return await agent.graph;

  // Example 1: Buy with exact input amount on BNB Chain
  // console.log('💱 Example 1: Buy BINK from exactly 0.0001 BNB with 0.5% slippage on bnb chain.');
  // const result1 = await agent.execute({
  //   input: `
  //     Buy BINK from exactly 0.0001 BNB with 0.5% slippage on bnb chain.
  //   `,
  //   //input: `swap crosschain 5 WETH on BNB to JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN on solana`,
  // });
  // console.log('✓ Swap result:', result1, '\n');

  // Example 2: Sell with exact output amount on BNB Chain
  // console.log('💱 Example 2: buy BINK from 10 USDC on solana');
  // const result2 = await agent.execute(`
  //    buy CAKE on BNB from 10 USDC on solana and stake it on ethereum chain
  //   `,
  // );

  // console.log('✓ Swap result:', result2, '\n');

  // // Get plugin information
  // // const registeredPlugin = agent.getPlugin('swap') as SwapPlugin;
  // const registeredPlugin = agent.getPlugin('bridge') as BridgePlugin;

  // // // Check available providers for each chain
  // console.log('📊 Available providers by chain:');
  // const chains = registeredPlugin.getSupportedNetworks();
  // for (const chain of chains) {
  //   const providers = registeredPlugin.getProvidersForNetwork(chain);
  //   console.log(`Chain ${chain}:`, providers.map(p => p.getName()).join(', '));
  // }
  // console.log();
}

// main().catch(error => {
//   console.error('❌ Error:', error.message);
//   process.exit(1);
// });

export const graph = main() as any;
