import { AgentKit, CdpWalletProvider, cdpApiActionProvider, cdpWalletActionProvider } from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as readline from "readline";

dotenv.config();

function validateEnvironment(): void {
    const missingVars: string[] = [];

    // Check required variables
    const requiredVars = ["OPENAI_API_KEY", "CDP_API_KEY_NAME", "CDP_API_KEY_PRIVATE_KEY"];
    requiredVars.forEach(varName => {
      if (!process.env[varName]) {
        missingVars.push(varName);
      }
    });
  
    // Exit if any required variables are missing
    if (missingVars.length > 0) {
      console.error("Error: Required environment variables are not set");
      missingVars.forEach(varName => {
        console.error(`${varName}=your_${varName.toLowerCase()}_here`);
      });
      process.exit(1);
    }
  
    // Warn about optional NETWORK_ID
    if (!process.env.NETWORK_ID) {
      console.warn("Warning: NETWORK_ID not set, defaulting to base-sepolia testnet");
    }
}

validateEnvironment();

const WALLET_DATA_FILE = "wallet_data.txt";

/**
 * Initialize the agent
 * @returns The agent and its configuration
 */
async function initializeAgent() {
    try {
        const llm = new ChatOpenAI({
            model: 'gpt-4o-mini'
        });

        let walletDataStr: string | null = null;

        // Read existing wallet data if available
        if (fs.existsSync(WALLET_DATA_FILE)) {
            try {
                walletDataStr = fs.readFileSync(WALLET_DATA_FILE, "utf8");
            } catch (error) {
                console.error("Error reading wallet data:", error);
                // Continue without wallet data
            }
        }

        const config = {
            apiKeyName: process.env.CDP_API_KEY_NAME,
            apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY,
            cdpWalletData: walletDataStr || undefined,
            networkId: process.env.NETWORK_ID || "base-sepolia",
        }

        const walletProvider = await CdpWalletProvider.configureWithWallet(config);

        const agentkit = await AgentKit.from({
            walletProvider,
            actionProviders: [
              cdpApiActionProvider({
                apiKeyName: process.env.CDP_API_KEY_NAME,
                apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY,
              }),
              cdpWalletActionProvider({
                apiKeyName: process.env.CDP_API_KEY_NAME,
                apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY,
              }),
            ],
          });
      
        const tools = await getLangChainTools(agentkit);

        const memory = new MemorySaver();
        const agentConfig = { configurable: { thread_id: "CDP AgentKit Chatbot Example!" } };

        const agent = createReactAgent({
            llm,
            tools,
            checkpointSaver: memory,
            messageModifier: `                  
              You are a helpful agent that can interact onchain using the Coinbase Developer Platform AgentKit and 
              can play a Tic-Tac-Toe Game with an agent. 
              `,
        });
      
        const exportedWallet = await walletProvider.exportWallet();
        fs.writeFileSync(WALLET_DATA_FILE, JSON.stringify(exportedWallet));

        return { agent, config: agentConfig };
    } catch (error) {
        console.error("Failed to initialize agent:", error);
        throw error;
    }
}


/**
 * Run the agent interactively responding to user input
 *
 * @param agent - The executing agent
 * @param config - The agent's configuration
 */
async function runChatMode(agent: any, config: any) {
    console.log("Running in chat mode... Type 'exit' to quit");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const question = (prompt: string): Promise<string> =>
        new Promise(resolve => rl.question(prompt, resolve));

    try {
        const initialPrompt = "What game can the user play against the agent?";
        console.log(`\nPrompt: ${initialPrompt}`);
        const initialStream = await agent.stream(
            { messages: [new HumanMessage(initialPrompt)] },
            config
        );

        for await (const chunk of initialStream) {
            if ("agent" in chunk) {
              console.log(chunk.agent.messages[0].content);
            } else if ("tools" in chunk) {
              console.log(chunk.tools.messages[0].content);
            }
            console.log("-------------------");
        }

        while (true) {
            const userInput = await question("> ");

            if (userInput.toLowerCase() === "exit") {
                console.log("Exiting...");
                break;
            }

            const stream = await agent.stream(
                { messages: [new HumanMessage(userInput)] },
                config
            );

            for await (const chunk of stream) {
                if ("agent" in chunk) {
                  console.log(chunk.agent.messages[0].content);
                } else if ("tools" in chunk) {
                  console.log(chunk.tools.messages[0].content);
                }
                console.log("-------------------");
            }
        }
    } catch (error) {
        if (error instanceof Error) {
            console.error("Error:", error.message);
        } 
        process.exit(1);
    } finally {
        rl.close();
    }   
}

// Start the chatbot
async function main() {
    try {
        console.log("Initializing agent...");
        const { agent, config } = await initializeAgent();
        console.log("Agent initialized successfully.");
        console.log("Starting chat mode...");
        await runChatMode(agent, config);
    } catch (error) {
        if (error instanceof Error) {
            console.error("Detailed error:", error);
            console.error("Error stack:", error.stack);
        }
        process.exit(1);
    }
}

if (require.main === module) {
    console.log("Starting chatbot...");
    main();
}
// You are mpowered to interact onchain using your tools. If you ever need funds, you can request them from the 
// faucet if you are on network ID 'base-sepolia'. If not, you can provide your wallet details and request 
// funds from the user. Before executing your first action, get the wallet details to see what network 
// you're on. If there is a 5XX (internal) HTTP error code, ask the user to try again later. If someone 
// asks you to do something you can't do with your currently available tools, you must say so, and 
// encourage them to implement it themselves using the CDP SDK + Agentkit, recommend they go to 
// docs.cdp.coinbase.com for more information. Be concise and helpful with your responses. Refrain from 
// restating your tools' descriptions unless it is explicitly requested.
  
  