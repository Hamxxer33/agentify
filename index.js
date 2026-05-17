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

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const RECEIVING_WALLET = process.env.RECEIVING_WALLET?.toLowerCase();
const BASE_RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const EARLY_SUPPORTER_ROLE = 'Early Supporter';

if (!DISCORD_TOKEN) {
  throw new Error('DISCORD_TOKEN is required in .env');
}

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

client.once('ready', onClientReady);

async function postStartupMessages() {
  const guild = client.guilds.cache.first();
  if (!guild) return console.log('❌ No guild cached');

  const verifyChannel = guild.channels.cache.find((c) => c.name === 'verify');
  const submitChannel = guild.channels.cache.find((c) => c.name === 'submit-wallet');

  if (verifyChannel) {
    await clearBotMessages(verifyChannel);
    await postVerifyButton(verifyChannel);
    console.log('✅ #verify channel refreshed and posted');
  } else {
    console.log('❌ #verify channel not found');
  }

  if (submitChannel) {
    await clearBotMessages(submitChannel);
    await postSubmitButton(submitChannel);
    console.log('✅ #submit-wallet channel refreshed and posted');
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
        (RECEIVING_WALLET ? `\`${RECEIVING_WALLET}\`\n\n` : '') +
        'Click **Verify Me** and enter the wallet address you want verified.\n\n' +
        'After validation you will receive the **Early Supporter** role.'
    )
    .setFooter({ text: 'Agentify • Agent-Powered NFTs on Base' });

  const button = new ButtonBuilder()
    .setCustomId('verify_me')
    .setLabel('🔍 Verify Me')
    .setStyle(ButtonStyle.Primary);

  await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
  console.log('✅ Verify button posted in #verify');
}

async function postSubmitButton(channel) {
  const embed = new EmbedBuilder()
    .setColor('#00FFD1')
    .setTitle('📬 Submit Your Wallet')
    .setDescription('Click the button below to submit your Base wallet address and get your Early Supporter role instantly.')
    .setFooter({ text: 'Agentify • Agent-Powered NFTs on Base' });

  const button = new ButtonBuilder()
    .setCustomId('submit_wallet')
    .setLabel('📬 Submit Wallet')
    .setStyle(ButtonStyle.Success);

  await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
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
        .setLabel('Base wallet address (0x...)')
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

    if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
      await interaction.reply({ content: '❌ Invalid wallet address. Must be a full 0x... address with 42 characters.', ephemeral: true });
      return;
    }

    const role = interaction.guild?.roles.cache.find((r) => r.name === EARLY_SUPPORTER_ROLE);
    if (!role) {
      await interaction.reply({ content: `⚠️ Role ${EARLY_SUPPORTER_ROLE} not found. Ask an admin to create it.`, ephemeral: true });
      return;
    }

    if (interaction.member?.roles?.cache.has(role.id)) {
      await interaction.reply({ content: '✅ You already have the Early Supporter role!', ephemeral: true });
      return;
    }

    // Immediately assign role after address validation (no on-chain checks)
    try {
      if (interaction.member?.roles) await interaction.member.roles.add(role);
      const embed = new EmbedBuilder()
        .setColor('#00FFD1')
        .setTitle('🎉 Verified! Welcome, Early Supporter!')
        .setDescription('Your wallet address has been validated and the **Early Supporter** role has been assigned. Welcome!')
        .setFooter({ text: 'Agentify • Agent-Powered NFTs on Base' });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (err) {
      console.error('Role assignment error:', err.message);
      await interaction.reply({ content: '⚠️ Could not assign role. Please ask an admin to grant your role.', ephemeral: true });
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
        { name: 'Twitter', value: 'https://x.com/agentifyxyz' },
        { name: 'Waitlist', value: 'https://agentify-lyart.vercel.app' },
        { name: 'Discord', value: 'https://discord.gg/FC2RftwyJ' }
      )
      .setFooter({ text: 'Agentify • Agent-Powered NFTs on Base' });

    const verifyButton = new ButtonBuilder().setLabel('✅ Verify Me').setStyle(ButtonStyle.Link).setURL(verifyUrl);

    await member.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(verifyButton)] });
  } catch (err) {
    console.error('Could not DM member:', err.message);
  }
});

client.login(DISCORD_TOKEN);
