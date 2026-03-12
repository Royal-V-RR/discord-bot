const { Client, Intents } = require("discord.js");
const https = require("https");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1480592876684706064";
const OWNER_ID = "969280648667889764";

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_INVITES,
    Intents.FLAGS.DIRECT_MESSAGES
  ]
});

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getServerChoices() {
  return client.guilds.cache.map(g => ({ name: g.name, value: g.id })).slice(0, 25);
}

function buildCommands() {
  return [
    { name: "ping", description: "Check latency" },

    { name: "avatar", description: "Get avatar",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "punch", description: "Punch user",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "hug", description: "Hug user",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "kiss", description: "Kiss user",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "slap", description: "Slap user",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "diddle", description: "Diddle user",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "oil", description: "Oil user",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "ppsize", description: "PP size",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "gayrate", description: "Gay percentage",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "iq", description: "IQ",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "sus", description: "Sus meter",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "howautistic", description: "Autism meter",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "servers", description: "List servers with invites" },

    { name: "echo", description: "Owner echo message",
      options: [{ name: "message", description: "Message to send", type: 3, required: true }] },

    { name: "dmuser", description: "Owner DM user",
      options: [
        { name: "user", description: "User", type: 6, required: true },
        { name: "message", description: "Message", type: 3, required: true }
      ]
    },

    { name: "leaveserver", description: "Owner leave server",
      options: [{ name: "server", description: "Server", type: 3, required: true, choices: getServerChoices() }]
    },

    { name: "restart", description: "Owner restart bot" },
    { name: "botstats", description: "Owner bot stats" },

    { name: "setstatus", description: "Owner set status",
      options: [
        { name: "text", description: "Status text", type: 3, required: true },
        { name: "type", description: "Status type", type: 3, required: false,
          choices: [
            { name: "Playing",   value: "PLAYING"   },
            { name: "Watching",  value: "WATCHING"  },
            { name: "Listening", value: "LISTENING" },
            { name: "Competing", value: "COMPETING" }
          ]
        }
      ]
    }
  ];
}

function registerCommands() {
  const commands = buildCommands();
  const data = JSON.stringify(commands);

  const options = {
    hostname: "discord.com",
    port: 443,
    path: `/api/v10/applications/${CLIENT_ID}/commands`,
    method: "PUT",
    headers: {
      Authorization: `Bot ${TOKEN}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data)
    }
  };

  const req = https.request(options, res => {});
  req.write(data);
  req.end();
}

client.once("ready", () => {
  console.log(`Bot ready ${client.user.tag}`);
  registerCommands();
});

client.on("guildCreate", () => registerCommands());
client.on("guildDelete", () => registerCommands());

client.on("interactionCreate", async interaction => {
  if (!interaction.isCommand()) return;

  const cmd = interaction.commandName;

  const ownerOnly = [
    "servers", "echo", "dmuser", "leaveserver",
    "restart", "botstats", "setstatus"
  ];

  if (ownerOnly.includes(cmd) && interaction.user.id !== OWNER_ID) {
    return interaction.reply({ content: "Owner only", ephemeral: true });
  }

  try {

    if (cmd === "ping") {
      return interaction.reply("Pong");
    }

    if (cmd === "avatar") {
      const u = interaction.options.getUser("user");
      return interaction.reply(u.displayAvatarURL({ size: 1024, dynamic: true }));
    }

    if (cmd === "echo") {
      const message = interaction.options.getString("message");
      await interaction.reply({ content: "Done", ephemeral: true });
      return interaction.channel.send(message);
    }

    if (cmd === "punch") {
      const u = interaction.options.getUser("user");
      return interaction.reply(`<@${interaction.user.id}> punched <@${u.id}>`);
    }

    if (cmd === "hug") {
      const u = interaction.options.getUser("user");
      return interaction.reply(`<@${interaction.user.id}> hugged <@${u.id}>`);
    }

    if (cmd === "kiss") {
      const u = interaction.options.getUser("user");
      return interaction.reply(`<@${interaction.user.id}> kissed <@${u.id}>`);
    }

    if (cmd === "slap") {
      const u = interaction.options.getUser("user");
      return interaction.reply(`<@${interaction.user.id}> slapped <@${u.id}>`);
    }

    if (cmd === "diddle") {
      const u = interaction.options.getUser("user");
      return interaction.reply(`<@${u.id}> was diddled`);
    }

    if (cmd === "oil") {
      const u = interaction.options.getUser("user");
      return interaction.reply(`<@${interaction.user.id}> oiled up <@${u.id}>`);
    }

    if (cmd === "ppsize") {
      const u = interaction.options.getUser("user");
      return interaction.reply(`<@${u.id}>'s pp: 8${"=".repeat(random(3, 30))}D`);
    }

    if (cmd === "gayrate") {
      const u = interaction.options.getUser("user");
      return interaction.reply(`<@${u.id}> is ${random(0, 100)}% gay`);
    }

    if (cmd === "iq") {
      const u = interaction.options.getUser("user");
      return interaction.reply(`<@${u.id}>'s IQ is ${random(60, 180)}`);
    }

    if (cmd === "sus") {
      const u = interaction.options.getUser("user");
      return interaction.reply(`<@${u.id}> is ${random(0, 100)}% sus`);
    }

    if (cmd === "howautistic") {
      const u = interaction.options.getUser("user");
      return interaction.reply(`<@${u.id}> is ${random(0, 100)}% autistic`);
    }

    if (cmd === "servers") {
      // Defer immediately so Discord doesn't time out while we fetch invites
      await interaction.deferReply({ ephemeral: true });

      let text = "";
      for (const g of client.guilds.cache.values()) {
        try {
          const channel = g.channels.cache.find(c =>
            c.type === "GUILD_TEXT" &&
            c.permissionsFor(g.me).has("CREATE_INSTANT_INVITE")
          );
          if (channel) {
            const invite = await channel.createInvite({ maxAge: 0 });
            text += `${g.name} — ${invite.url}\n`;
          } else {
            text += `${g.name} — no invite permission\n`;
          }
        } catch {
          text += `${g.name} — error\n`;
        }
        if (text.length > 1800) {
          text += `…and more`;
          break;
        }
      }
      return interaction.editReply({ content: text || "No servers" });
    }

    if (cmd === "botstats") {
      await interaction.deferReply({ ephemeral: true });

      let totalUsers = 0;
      let serverList = "";
      for (const g of client.guilds.cache.values()) {
        totalUsers += g.memberCount;
        serverList += `• ${g.name} (${g.memberCount.toLocaleString()} users)\n`;
        if (serverList.length > 1600) {
          serverList += `…and more\n`;
          break;
        }
      }

      const stats =
        `**Bot Stats**\n` +
        `Servers: ${client.guilds.cache.size.toLocaleString()}\n` +
        `Total Users: ${totalUsers.toLocaleString()}\n\n` +
        `**Server List:**\n${serverList}`;

      return interaction.editReply({ content: stats });
    }

    if (cmd === "dmuser") {
      const user    = interaction.options.getUser("user");
      const message = interaction.options.getString("message");
      try {
        await user.send(message);
        return interaction.reply({ content: "DM sent", ephemeral: true });
      } catch {
        return interaction.reply({ content: "User has DMs disabled", ephemeral: true });
      }
    }

    if (cmd === "leaveserver") {
      const serverId = interaction.options.getString("server");
      const guild    = client.guilds.cache.get(serverId);
      if (!guild) return interaction.reply({ content: "Server not found", ephemeral: true });
      const name = guild.name;
      await guild.leave();
      return interaction.reply({ content: `Left ${name}`, ephemeral: true });
    }

    if (cmd === "restart") {
      await interaction.reply({ content: "Restarting", ephemeral: true });
      process.exit(0);
    }

    if (cmd === "setstatus") {
      const text = interaction.options.getString("text");
      const type = interaction.options.getString("type") || "PLAYING";
      client.user.setActivity(text, { type });
      return interaction.reply({ content: `Status set to ${type}: ${text}`, ephemeral: true });
    }

  } catch (err) {
    console.error(err);
    try {
      // Use editReply if we already deferred, otherwise reply
      if (interaction.deferred) {
        await interaction.editReply({ content: "Error running command" });
      } else if (!interaction.replied) {
        await interaction.reply({ content: "Error running command", ephemeral: true });
      }
    } catch {
      // Interaction already expired, nothing we can do
    }
  }
});

client.login(TOKEN);
