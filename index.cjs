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

    { name: "avatar", description: "Get a user's avatar",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "punch", description: "Punch a user",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "hug", description: "Hug a user",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "kiss", description: "Kiss a user",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "slap", description: "Slap a user",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "diddle", description: "Diddle a user",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "oil", description: "Oil a user",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "ppsize", description: "Check a user's PP size",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "gayrate", description: "Check a user's gay percentage",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "iq", description: "Check a user's IQ",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "sus", description: "Check a user's sus meter",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "howautistic", description: "Check a user's autism meter",
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "servers", description: "List servers with invites" },

    { name: "echo", description: "Make the bot say something",
      options: [
        { name: "message", description: "Message to send", type: 3, required: true },
        { name: "channel", description: "Channel to send in (defaults to current)", type: 7, required: false }
      ]
    },

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

    { name: "setstatus", description: "Owner set bot status",
      options: [
        { name: "text", description: "Status text", type: 3, required: true },
        { name: "type", description: "Activity type", type: 3, required: false,
          choices: [
            { name: "Playing", value: "PLAYING" },
            { name: "Watching", value: "WATCHING" },
            { name: "Listening", value: "LISTENING" },
            { name: "Competing", value: "COMPETING" }
          ]
        },
        { name: "status", description: "Online status", type: 3, required: false,
          choices: [
            { name: "Online", value: "online" },
            { name: "Idle", value: "idle" },
            { name: "Do Not Disturb", value: "dnd" },
            { name: "Invisible", value: "invisible" }
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

  const req = https.request(options, res => {
    res.on("data", d => {
      // Silently consume response
    });
  });
  req.on("error", err => console.error("Command registration error:", err));
  req.write(data);
  req.end();
}

client.once("ready", () => {
  console.log(`Bot ready: ${client.user.tag}`);
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
    return interaction.reply({ content: "Owner only.", ephemeral: true });
  }

  try {

    // ── Ping ──────────────────────────────────────────────────────────────
    if (cmd === "ping") {
      return interaction.reply(`Pong! Latency: ${client.ws.ping}ms`);
    }

    // ── Avatar ────────────────────────────────────────────────────────────
    if (cmd === "avatar") {
      const u = interaction.options.getUser("user");
      return interaction.reply(`**${u.username}'s avatar:**\n${u.displayAvatarURL({ size: 1024, dynamic: true })}`);
    }

    // ── Fun / action commands ─────────────────────────────────────────────
    const target = interaction.options.getUser?.("user");

    if (cmd === "punch") return interaction.reply(`<@${interaction.user.id}> punched <@${target.id}> 👊`);
    if (cmd === "hug")   return interaction.reply(`<@${interaction.user.id}> hugged <@${target.id}> 🤗`);
    if (cmd === "kiss")  return interaction.reply(`<@${interaction.user.id}> kissed <@${target.id}> 💋`);
    if (cmd === "slap")  return interaction.reply(`<@${interaction.user.id}> slapped <@${target.id}> 👋`);
    if (cmd === "diddle") return interaction.reply(`<@${interaction.user.id}> diddled <@${target.id}>`);
    if (cmd === "oil")   return interaction.reply(`<@${interaction.user.id}> oiled up <@${target.id}> 🛢️`);

    // ── Stat commands (all show the selected user) ────────────────────────
    if (cmd === "ppsize") {
      const size = "=".repeat(random(3, 30));
      return interaction.reply(`**${target.username}'s PP:** 8${size}D`);
    }

    if (cmd === "gayrate") {
      return interaction.reply(`**${target.username}** is **${random(0, 100)}%** gay 🏳️‍🌈`);
    }

    if (cmd === "iq") {
      return interaction.reply(`**${target.username}'s IQ:** ${random(60, 180)} 🧠`);
    }

    if (cmd === "sus") {
      return interaction.reply(`**${target.username}** is **${random(0, 100)}%** sus 📮`);
    }

    if (cmd === "howautistic") {
      return interaction.reply(`**${target.username}** is **${random(0, 100)}%** autistic 🧩`);
    }

    // ── Servers ───────────────────────────────────────────────────────────
    if (cmd === "servers") {
      let text = "";
      for (const g of client.guilds.cache.values()) {
        try {
          const channel = g.channels.cache.find(c =>
            c.type === "GUILD_TEXT" &&
            c.permissionsFor(g.me).has("CREATE_INSTANT_INVITE")
          );
          if (channel) {
            const invite = await channel.createInvite({ maxAge: 0 });
            text += `**${g.name}** — ${invite.url}\n`;
          } else {
            text += `**${g.name}** — no invite permission\n`;
          }
        } catch {
          text += `**${g.name}** — error generating invite\n`;
        }
        if (text.length > 1800) {
          text += "\n*(truncated)*";
          break;
        }
      }
      return interaction.reply({ content: text || "No servers.", ephemeral: true });
    }

    // ── Echo ──────────────────────────────────────────────────────────────
    // Defers ephemerally so no "X used /echo" is shown, then deletes the
    // deferred reply. The message is sent directly to the channel so there
    // is no visible trace back to the command invoker.
    if (cmd === "echo") {
      const message = interaction.options.getString("message");
      const channelOption = interaction.options.getChannel("channel");
      const targetChannel = channelOption ?? interaction.channel;

      // Acknowledge silently (ephemeral so no one else sees it)
      await interaction.deferReply({ ephemeral: true });

      try {
        await targetChannel.send(message);
        await interaction.deleteReply();
      } catch {
        await interaction.editReply({ content: "Could not send message to that channel." });
      }
      return;
    }

    // ── DM user ───────────────────────────────────────────────────────────
    if (cmd === "dmuser") {
      const user = interaction.options.getUser("user");
      const message = interaction.options.getString("message");
      try {
        await user.send(message);
        return interaction.reply({ content: `DM sent to **${user.username}**.`, ephemeral: true });
      } catch {
        return interaction.reply({ content: "User has DMs disabled.", ephemeral: true });
      }
    }

    // ── Leave server ──────────────────────────────────────────────────────
    if (cmd === "leaveserver") {
      const serverId = interaction.options.getString("server");
      const guild = client.guilds.cache.get(serverId);
      if (!guild) return interaction.reply({ content: "Server not found.", ephemeral: true });
      const name = guild.name;
      await guild.leave();
      return interaction.reply({ content: `Left **${name}**.`, ephemeral: true });
    }

    // ── Bot stats ─────────────────────────────────────────────────────────
    if (cmd === "botstats") {
      // Fetch full member counts for all guilds
      const guilds = [...client.guilds.cache.values()];
      let totalUsers = 0;
      const lines = [];

      for (const g of guilds) {
        // memberCount is the most accurate count without fetching all members
        totalUsers += g.memberCount;
        lines.push(`**${g.name}** — ${g.memberCount.toLocaleString()} members`);
      }

      const serverList = lines.join("\n");
      const summary = `**Total servers:** ${guilds.length}\n**Total users:** ${totalUsers.toLocaleString()}\n\n${serverList}`;

      // Split if too long
      if (summary.length <= 2000) {
        return interaction.reply({ content: summary, ephemeral: true });
      } else {
        // Send in chunks
        await interaction.reply({ content: summary.slice(0, 2000), ephemeral: true });
        let remaining = summary.slice(2000);
        while (remaining.length > 0) {
          await interaction.followUp({ content: remaining.slice(0, 2000), ephemeral: true });
          remaining = remaining.slice(2000);
        }
        return;
      }
    }

    // ── Restart ───────────────────────────────────────────────────────────
    if (cmd === "restart") {
      await interaction.reply({ content: "Restarting...", ephemeral: true });
      process.exit(0);
    }

    // ── Set status ────────────────────────────────────────────────────────
    if (cmd === "setstatus") {
      const text       = interaction.options.getString("text");
      const actType    = interaction.options.getString("type") ?? "PLAYING";
      const onlineStatus = interaction.options.getString("status") ?? "online";

      client.user.setPresence({
        activities: [{ name: text, type: actType }],
        status: onlineStatus
      });

      return interaction.reply({
        content: `Status updated: **${actType}** ${text} (${onlineStatus})`,
        ephemeral: true
      });
    }

  } catch (err) {
    console.error(err);
    if (!interaction.replied && !interaction.deferred) {
      interaction.reply({ content: "An error occurred.", ephemeral: true });
    } else if (interaction.deferred) {
      interaction.editReply({ content: "An error occurred." });
    }
  }
});

client.login(TOKEN);
