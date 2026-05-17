require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const { ethers } = require('ethers');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const RECEIVING_WALLET = process.env.RECEIVING_WALLET?.toLowerCase();
const BASE_RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const SUBMIT_CHANNEL_NAME = 'submit-wallet';
const VERIFY_CHANNEL_NAME = 'verify';
const EARLY_SUPPORTER_ROLE = 'Early Supporter';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)'];

if (!DISCORD_TOKEN) {
  throw new Error('DISCORD_TOKEN is required in .env');
}

if (!RECEIVING_WALLET || !ethers.isAddress(RECEIVING_WALLET)) {
  throw new Error('RECEIVING_WALLET is required in .env and must be a valid wallet address');
}

const provider = new ethers.JsonRpcProvider(BASE_RPC);
const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const createWelcomeEmbed = (member, verifyChannelId) =>
  new EmbedBuilder()
    .setColor('#00FFD1')
    .setTitle('👋 Welcome to Agentify!')
    .setDescription(
      `Hey ${member.user.username}! Welcome to the first **Agent-powered NFT marketplace** on Base.\n\n` +
        'To become an **Early Supporter** and secure your spot for the future **$AGENTIFY token airdrop**, complete verification below.'
    )
    .addFields(
      {
        name: '✅ How to Verify',
        value:
          '1. Send exactly **0.10 USDC** on **Base network** to:\n' +
          `\`${RECEIVING_WALLET}\`\n\n` +
          `2. Go to <#${verifyChannelId}> and type:\n` +
          '`!verify 0xYourWalletAddress`',
      },
      {
        name: '🎁 What You Get',
        value: '• Early Supporter role\n• Whitelist for Agentify launch\n• $AGENTIFY token airdrop eligibility',
      }
    )
    .setFooter({ text: 'Agentify • Agent-Powered NFTs on Base' });

client.on('guildMemberAdd', async (member) => {
  try {
    const verifyChannel = member.guild.channels.cache.find(
      (channel) => channel.name === VERIFY_CHANNEL_NAME
    );

    await member.send({
      embeds: [createWelcomeEmbed(member, verifyChannel?.id ?? 'submit-wallet')],
    });
  } catch (err) {
    console.error('Could not DM member:', err.message);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.name !== SUBMIT_CHANNEL_NAME) return;
  if (!message.guild) return;

  const content = message.content.trim();
  if (!content.startsWith('!verify')) return;

  const parts = content.split(/\s+/);
  const wallet = parts[1]?.toLowerCase();

  if (!wallet || !ethers.isAddress(wallet)) {
    await message.reply('❌ Invalid wallet address. Use: `!verify 0xYourWalletAddress`');
    return;
  }

  const role = message.guild.roles.cache.find((r) => r.name === EARLY_SUPPORTER_ROLE);
  if (!role) {
    await message.reply(`⚠️ Role \`${EARLY_SUPPORTER_ROLE}\` not found. Ask an admin to create it and try again.`);
    return;
  }

  if (message.member.roles.cache.has(role.id)) {
    await message.reply('✅ You are already verified as an Early Supporter!');
    return;
  }

  await message.reply(`🔍 Checking your USDC payment from \`${wallet}\`... please wait.`);

  const verified = await checkUSDCPayment(wallet);

  if (verified) {
    await message.member.roles.add(role);

    const embed = new EmbedBuilder()
      .setColor('#00FFD1')
      .setTitle('✅ Verified! Welcome, Early Supporter!')
      .setDescription(
        'Payment confirmed. You\'ve been granted the **Early Supporter** role.\n\n' +
          'You\'re now whitelisted for the Agentify launch and **$AGENTIFY airdrop**. 🎉'
      )
      .setFooter({ text: 'Agentify • Agent-Powered NFTs on Base' });

    await message.reply({ embeds: [embed] });
  } else {
    const embed = new EmbedBuilder()
      .setColor('#FF4444')
      .setTitle('❌ Payment Not Found')
      .setDescription(
        `Could not find a **0.10 USDC** transfer from \`${wallet}\` to the Agentify wallet in the last 24 hours.\n\n` +
          '**Make sure:**\n' +
          '• You sent from the wallet address you typed\n' +
          '• You sent on **Base network** (not Ethereum)\n' +
          '• Amount is exactly **0.10 USDC**\n' +
          '• Wait 1-2 minutes after sending, then try again'
      )
      .setFooter({ text: 'Agentify • Agent-Powered NFTs on Base' });

    await message.reply({ embeds: [embed] });
  }
});

async function checkUSDCPayment(fromWallet) {
  try {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 43200);
    const filter = usdc.filters.Transfer(fromWallet, RECEIVING_WALLET);
    const events = await usdc.queryFilter(filter, fromBlock, currentBlock);

    for (const event of events) {
      const amount = event.args.value;
      if (amount === BigInt(100000)) {
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error('RPC check error:', err.message);
    return false;
  }
}

client.once('ready', () => {
  console.log(`✅ Agentify bot online as ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
