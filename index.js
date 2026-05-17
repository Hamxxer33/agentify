require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { ethers } = require('ethers');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const RECEIVING_WALLET = process.env.RECEIVING_WALLET?.toLowerCase();
const BASE_RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
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

const onClientReady = async () => {
  console.log(`✅ Agentify bot online as ${client.user?.tag}`);
  await postStartupMessages();
};

client.once('clientReady', onClientReady);
client.once('ready', onClientReady);

async function postStartupMessages() {
  const guild = client.guilds.cache.first();
  if (!guild) return console.log('❌ No guild cached');

  const verifyChannel = guild.channels.cache.find((c) => c.name === 'verify');
  const submitChannel = guild.channels.cache.find((c) => c.name === 'submit-wallet');

  if (verifyChannel) {
    await clearBotMessages(verifyChannel);
    await postVerifyButton(verifyChannel);
  } else {
    console.log('❌ #verify channel not found');
  }

  if (submitChannel) {
    await clearBotMessages(submitChannel);
    await postSubmitButton(submitChannel);
  } else {
    console.log('❌ #submit-wallet channel not found');
  }
}

async function clearBotMessages(channel) {
  let fetched;
  do {
    fetched = await channel.messages.fetch({ limit: 100 });
    const botMessages = fetched.filter((message) => message.author?.id === client.user.id);
    if (!botMessages.size) break;

    try {
      await channel.bulkDelete(botMessages, true);
    } catch {
      for (const msg of botMessages.values()) {
        await msg.delete().catch(() => null);
      }
    }
  } while (fetched.size === 100);
}

async function postVerifyButton(channel) {
  const embed = new EmbedBuilder()
    .setColor('#00FFD1')
    .setTitle('✅ Verify & Become an Early Supporter')
    .setDescription(
      'Send exactly **0.10 USDC** on **Base network** to:\n' +
        `\`${RECEIVING_WALLET}\`\n\n` +
        'Then click **Verify Me** and enter the wallet address you sent from.\n\n' +
        'After verification, you will receive the **Early Supporter** role.'
    )
    .setFooter({ text: 'Agentify • Agent-Powered NFTs on Base' });

  const button = new ButtonBuilder()
    .setCustomId('verify_me')
    .setLabel('🔍 Verify Me')
    .setStyle(ButtonStyle.Primary);

  await channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
  });
  console.log('✅ Verify button posted in #verify');
}

async function postSubmitButton(channel) {
  const embed = new EmbedBuilder()
    .setColor('#00FFD1')
    .setTitle('📬 Submit Wallet')
    .setDescription('Already sent your **0.10 USDC** on Base? Click the button below, enter your wallet address, and get verified instantly.')
    .setFooter({ text: 'Agentify • Agent-Powered NFTs on Base' });

  const button = new ButtonBuilder()
    .setCustomId('submit_wallet')
    .setLabel('📬 Submit Wallet')
    .setStyle(ButtonStyle.Success);

  await channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
  });
  console.log('✅ Submit button posted in #submit-wallet');
}

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === 'verify_me' || interaction.customId === 'submit_wallet') {
      const modal = new ModalBuilder()
        .setCustomId('wallet_modal')
        .setTitle('Enter Your Wallet Address');

      const walletInput = new TextInputBuilder()
        .setCustomId('wallet_input')
        .setLabel('Wallet you sent 0.10 USDC from')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('0x...')
        .setRequired(true)
        .setMinLength(42)
        .setMaxLength(42);

      modal.addComponents(new ActionRowBuilder().addComponents(walletInput));
      await interaction.showModal(modal);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'wallet_modal') {
    const wallet = interaction.fields.getTextInputValue('wallet_input').trim().toLowerCase();

    if (!ethers.isAddress(wallet)) {
      await interaction.reply({ content: '❌ Invalid wallet address. Must be a full `0x...` address.', ephemeral: true });
      return;
    }

    const role = interaction.guild?.roles.cache.find((r) => r.name === EARLY_SUPPORTER_ROLE);
    if (!role) {
      await interaction.reply({ content: `⚠️ Role \`${EARLY_SUPPORTER_ROLE}\` not found. Ask an admin to create it.`, ephemeral: true });
      return;
    }

    if (interaction.member?.roles?.cache.has(role.id)) {
      await interaction.reply({ content: '✅ You already have the Early Supporter role!', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const verified = await checkUSDCPayment(wallet);
    if (verified) {
      if (interaction.member?.roles) {
        await interaction.member.roles.add(role).catch(() => null);
      }

      const embed = new EmbedBuilder()
        .setColor('#00FFD1')
        .setTitle('🎉 Verified! Welcome, Early Supporter!')
        .setDescription('Payment confirmed on Base.\n\nYou\'ve been granted the **Early Supporter** role and are now eligible for the **$AGENTIFY airdrop**.')
        .setFooter({ text: 'Agentify • Agent-Powered NFTs on Base' });

      await interaction.editReply({ content: '', embeds: [embed] });
    } else {
      const embed = new EmbedBuilder()
        .setColor('#FF4444')
        .setTitle('❌ Payment Not Found')
        .setDescription(
          `No **0.10 USDC** transfer found from \`${wallet}\` in the last 24 hours.\n\n` +
            '**Check:**\n' +
            '• Correct wallet address\n' +
            '• Sent on **Base network**\n' +
            '• Exact amount: **0.10 USDC**\n' +
            '• Wait 1-2 mins then retry'
        )
        .setFooter({ text: 'Agentify • Agent-Powered NFTs on Base' });

      await interaction.editReply({ content: '', embeds: [embed] });
    }
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    const verifyChannel = member.guild.channels.cache.find((c) => c.name === 'verify');
    const verifyUrl = verifyChannel
      ? `https://discord.com/channels/${member.guild.id}/${verifyChannel.id}`
      : 'https://discord.com/invite/FC2RftwyJ';

    const embed = new EmbedBuilder()
      .setColor('#00FFD1')
      .setTitle('👋 Welcome to Agentify!')
      .setDescription(
        `Hey ${member.user.username}! Welcome to the first **Agent-powered NFT marketplace** on Base.\n\n` +
          'Click the button below to verify your wallet and secure your Early Supporter role.\n\n' +
          'Links below will take you to our community and waitlist.'
      )
      .addFields(
        { name: 'Twitter', value: '[https://x.com/agentifyxyz](https://x.com/agentifyxyz)' },
        { name: 'Waitlist', value: '[https://agentify-lyart.vercel.app](https://agentify-lyart.vercel.app)' },
        { name: 'Discord', value: '[discord.gg/FC2RftwyJ](https://discord.gg/FC2RftwyJ)' }
      )
      .setFooter({ text: 'Agentify • Agent-Powered NFTs on Base' });

    const verifyButton = new ButtonBuilder()
      .setLabel('✅ Verify Me')
      .setStyle(ButtonStyle.Link)
      .setURL(verifyUrl);

    await member.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(verifyButton)] });
  } catch (err) {
    console.error('Could not DM member:', err.message);
  }
});

async function checkUSDCPayment(fromWallet) {
  try {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 43200);
    const filter = usdc.filters.Transfer(fromWallet, RECEIVING_WALLET);
    const events = await usdc.queryFilter(filter, fromBlock, currentBlock);

    for (const event of events) {
      if (event.args.value >= BigInt(100000)) return true;
    }

    return false;
  } catch (err) {
    console.error('RPC check error:', err.message);
    return false;
  }
}

client.login(DISCORD_TOKEN);
