const { Client, Intents } = require("discord.js");
const https = require("https");
const http = require("http");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1480592876684706064";
const OWNER_ID = "969280648667889764";

const GAY_IDS = ["1245284545452834857", "1413943805203189800"];

let activePersonality = null;
let personalityTimeout = null;

const PERSONALITIES = {
  witty: {
    label: "Witty",
    punch:       (a, b) => `${a} just absolutely CLOCKED ${b} 💀 somebody call an ambulance`,
    hug:         (a, b) => `${a} pulled ${b} in for a hug... cute or cringe? both.`,
    kiss:        (a, b) => `${a} kissed ${b} omg someone get the cameras`,
    slap:        (a, b) => `${a} slapped ${b} — the audacity, the nerve, the TALENT`,
    diddle:      (b)    => `${b} got diddled. we don't talk about this.`,
    oil:         (a, b) => `${a} oiled up ${b}... I'm not asking questions`,
    ppsize:      (b, s) => `${b}'s pp measured in at ${s} — science has spoken`,
    gayrate:     (a, b, p) => `${a} wants to know how gay ${b} is, how cuuute — ${p}% confirmed`,
    iq:          (b, n) => `they ran the tests. ${b} scored ${n} IQ. make of that what you will`,
    sus:         (b, p) => `${b} is giving ${p}% sus energy rn and I don't like it`,
    howautistic: (b, p) => `the readings are in — ${b} is ${p}% autistic, and honestly? respect`,
    ping:        ()     => `still alive, unfortunately. pong.`,
    avatar:      (b, u) => `here's ${b}'s face, since you clearly needed to see it: ${u}`,
  },
  mean: {
    label: "Mean",
    punch:       (a, b) => `${a} punched ${b} and honestly ${b} probably deserved it`,
    hug:         (a, b) => `${a} hugged ${b}... get a room, losers`,
    kiss:        (a, b) => `${a} kissed ${b} ew`,
    slap:        (a, b) => `${a} slapped ${b} lmaooo`,
    diddle:      (b)    => `${b} got diddled lol`,
    oil:         (a, b) => `${a} oiled up ${b}, weirdo`,
    ppsize:      (b, s) => `${b}'s pp: ${s} — tragic`,
    gayrate:     (a, b, p) => `${b} is ${p}% gay, ${a} already knew`,
    iq:          (b, n) => `${b}'s IQ is ${n}, which explains a lot`,
    sus:         (b, p) => `${b} is ${p}% sus, not surprised`,
    howautistic: (b, p) => `${b} is ${p}% autistic lol`,
    ping:        ()     => `pong, not that you deserve a response`,
    avatar:      (b, u) => `fine here's ${b}'s ugly mug: ${u}`,
  },
  wholesome: {
    label: "Wholesome",
    punch:       (a, b) => `${a} gave ${b} a little bop! playful! 🥊💕`,
    hug:         (a, b) => `${a} wrapped ${b} in the warmest hug 🤗`,
    kiss:        (a, b) => `${a} gave ${b} a sweet little kiss 💋🌸`,
    slap:        (a, b) => `${a} gave ${b} a gentle slap of love 🫶`,
    diddle:      (b)    => `${b} got tickled!! hehe 🤭`,
    oil:         (a, b) => `${a} gave ${b} a relaxing massage 💆`,
    ppsize:      (b, s) => `${b}'s pp is ${s} and they should be proud no matter what 💖`,
    gayrate:     (a, b, p) => `${b} is ${p}% gay and that's beautiful 🌈`,
    iq:          (b, n) => `${b} has an IQ of ${n} and we love them regardless 💛`,
    sus:         (b, p) => `${b} is ${p}% sus but we still love them 🥰`,
    howautistic: (b, p) => `${b} is ${p}% autistic and wonderfully themselves 💙`,
    ping:        ()     => `pong! hope you're having a lovely day 🌟`,
    avatar:      (b, u) => `here's the beautiful ${b}! 🌸 ${u}`,
  },
  corporate: {
    label: "Corporate",
    punch:       (a, b) => `${a} has actioned a physical touch initiative targeting ${b}`,
    hug:         (a, b) => `${a} has leveraged a warm embrace synergy with ${b}`,
    kiss:        (a, b) => `${a} has initiated a lip-based connection with ${b} pending HR review`,
    slap:        (a, b) => `${a} has delivered tactile feedback to ${b}. ticket opened.`,
    diddle:      (b)    => `${b} has been subjected to an unscheduled interaction. legal is reviewing.`,
    oil:         (a, b) => `${a} has applied lubricant solutions to ${b} for operational efficiency`,
    ppsize:      (b, s) => `${b}'s personal asset length KPI has been benchmarked at ${s}`,
    gayrate:     (a, b, p) => `${b}'s diversity metric has been quantified at ${p}% per Q4 analysis`,
    iq:          (b, n) => `${b}'s cognitive performance index sits at ${n}. see attached report.`,
    sus:         (b, p) => `${b}'s trustworthiness score has been flagged at ${p}% risk`,
    howautistic: (b, p) => `${b}'s neurodiversity index reads ${p}%. noted for inclusion metrics.`,
    ping:        ()     => `uptime confirmed. response SLA met. pong.`,
    avatar:      (b, u) => `${b}'s profile asset has been retrieved for review: ${u}`,
  },
  pirate: {
    label: "Pirate",
    punch:       (a, b) => `ARRR! ${a} landed a mighty blow on ${b} off the starboard bow!`,
    hug:         (a, b) => `${a} wrapped ${b} up like a treasure chest, arrr!`,
    kiss:        (a, b) => `${a} planted a salty smooch on ${b}, shiver me timbers!`,
    slap:        (a, b) => `${a} slapped ${b} with the fury of the seven seas!`,
    diddle:      (b)    => `${b} got diddled by Davy Jones himself, arrr!`,
    oil:         (a, b) => `${a} greased up ${b}'s cannons, if ye know what I mean`,
    ppsize:      (b, s) => `${b}'s plank measures ${s} — worthy of the high seas`,
    gayrate:     (a, b, p) => `the compass points ${p}% gay for ${b}, arrr she spins!`,
    iq:          (b, n) => `${b}'s got ${n} IQ worth of sea smarts, arrr`,
    sus:         (b, p) => `${b} be ${p}% sus — I smell a mutiny!`,
    howautistic: (b, p) => `the stars say ${b} be ${p}% autistic, a rare treasure!`,
    ping:        ()     => `PONG! The crow's nest is manned, captain!`,
    avatar:      (b, u) => `here be ${b}'s wanted poster, arrr: ${u}`,
  },
  shakespearean: {
    label: "Shakespearean",
    punch:       (a, b) => `Hark! ${a} hath struck ${b} with great ferocity most foul!`,
    hug:         (a, b) => `${a} doth embrace ${b} with warmth most tender and true`,
    kiss:        (a, b) => `Thus with a kiss, ${a} claimeth the lips of ${b}`,
    slap:        (a, b) => `${a} hath delivered unto ${b} a strike most dishonourable!`,
    diddle:      (b)    => `Fie upon it! ${b} hath been diddled most scandalously!`,
    oil:         (a, b) => `${a} hath anointed ${b} with oils most luxuriant`,
    ppsize:      (b, s) => `${b}'s noble member doth measure ${s} — a tale for the ages`,
    gayrate:     (a, b, p) => `Methinks ${b} doth fancy men at a rate of ${p}%`,
    iq:          (b, n) => `The scholars proclaim ${b}'s intellect to be ${n} — so it is written`,
    sus:         (b, p) => `Something is rotten — ${b} registers ${p}% suspicious`,
    howautistic: (b, p) => `${b} hath been measured at ${p}% autistic by the royal physicians`,
    ping:        ()     => `Hark! The signal hath returned — pong, good traveller`,
    avatar:      (b, u) => `Behold the visage of ${b}, rendered here for thine eyes: ${u}`,
  },
  gen_z: {
    label: "Gen Z",
    punch:       (a, b) => `${a} just bodied ${b} no cap 💀`,
    hug:         (a, b) => `${a} hugged ${b} and it's literally so slay`,
    kiss:        (a, b) => `${a} kissed ${b} bestie era fr fr`,
    slap:        (a, b) => `${a} slapped ${b} and I'm deceased 💀💀`,
    diddle:      (b)    => `${b} got diddled and the vibe is off rn`,
    oil:         (a, b) => `${a} oiled up ${b} and honestly that's their Roman Empire`,
    ppsize:      (b, s) => `${b}'s pp is ${s} and that's on periodt`,
    gayrate:     (a, b, p) => `${b} is ${p}% gay and we been knew bestie 🏳️‍🌈`,
    iq:          (b, n) => `${b} got ${n} IQ lmaooo not the flop era`,
    sus:         (b, p) => `${b} is ${p}% sus and the ick is immaculate`,
    howautistic: (b, p) => `${b} is ${p}% autistic and that's so valid honestly`,
    ping:        ()     => `pong bestie, we're so back`,
    avatar:      (b, u) => `here's ${b}'s pfp and it's giving: ${u}`,
  },
  villain: {
    label: "Villain",
    punch:       (a, b) => `${a} strikes ${b} down. just as I planned. 😈`,
    hug:         (a, b) => `${a} embraces ${b}... how touching. how utterly useless.`,
    kiss:        (a, b) => `${a} kisses ${b}. even villains have weaknesses.`,
    slap:        (a, b) => `${a} slaps ${b}. finally, some aggression worth noting.`,
    diddle:      (b)    => `${b} has been diddled. all according to the plan.`,
    oil:         (a, b) => `${a} oils ${b}. every great scheme requires... preparation.`,
    ppsize:      (b, s) => `${b}'s pp: ${s}. I've seen empires fall for less.`,
    gayrate:     (a, b, p) => `${b} is ${p}% gay. I knew I could use this against them.`,
    iq:          (b, n) => `${b}'s IQ: ${n}. pitiful. they'll never outwit me.`,
    sus:         (b, p) => `${b} is ${p}% sus. they're onto me. eliminate them.`,
    howautistic: (b, p) => `${b} is ${p}% autistic. every piece on the board has its use.`,
    ping:        ()     => `pong. I allowed it.`,
    avatar:      (b, u) => `I've studied ${b}'s face for weeks. here: ${u}`,
  },
  anime: {
    label: "Anime",
    punch:       (a, b) => `${a} unleashed their ultimate technique on ${b}! KIAAA!! 💥`,
    hug:         (a, b) => `${a} ran at full speed and leapt into ${b}'s arms!! so wholesome!! 😭✨`,
    kiss:        (a, b) => `${a} kissed ${b}... *dramatic zoom* ...the crowd goes silent 🌸`,
    slap:        (a, b) => `${a} delivered a THUNDEROUS slap to ${b}!! the shockwave was felt for miles`,
    diddle:      (b)    => `${b} got diddled and is now in their feelings arc`,
    oil:         (a, b) => `${a} applied the sacred oils to ${b} in a very long filler episode`,
    ppsize:      (b, s) => `${b}'s power level pp: ${s}!! IT'S OVER 9000... maybe`,
    gayrate:     (a, b, p) => `${b}'s gay percentage: ${p}%!! their rival blushes in the distance 💗`,
    iq:          (b, n) => `${b} has ${n} IQ... a true genius protagonist moment`,
    sus:         (b, p) => `${b} is ${p}% sus... could they be the traitor?! *insert flashback*`,
    howautistic: (b, p) => `${b} is ${p}% autistic — the eccentric genius trope is real`,
    ping:        ()     => `PONG!! *hair blows dramatically in the wind*`,
    avatar:      (b, u) => `*freeze frame on ${b}'s face* — narrator: "this is them" ${u}`,
  },
  british: {
    label: "British",
    punch:       (a, b) => `${a} gave ${b} a proper wallop, absolutely ghastly behaviour`,
    hug:         (a, b) => `${a} hugged ${b} which was rather uncomfortable for everyone involved`,
    kiss:        (a, b) => `${a} kissed ${b}, how terribly inappropriate`,
    slap:        (a, b) => `${a} slapped ${b}, which is frankly bang out of order`,
    diddle:      (b)    => `${b} got diddled, absolutely scandalous`,
    oil:         (a, b) => `${a} oiled up ${b}, which is not the done thing`,
    ppsize:      (b, s) => `${b}'s bits measure ${s}, which is neither here nor there`,
    gayrate:     (a, b, p) => `${b} is ${p}% gay, good on them I suppose`,
    iq:          (b, n) => `${b}'s IQ is ${n}, bless them`,
    sus:         (b, p) => `${b} is ${p}% sus, I'm not best pleased`,
    howautistic: (b, p) => `${b} is ${p}% autistic, we don't make a fuss about it`,
    ping:        ()     => `pong, I suppose`,
    avatar:      (b, u) => `here's ${b}'s photo, not that you asked properly: ${u}`,
  }
};

const CRISIS_MESSAGES = [
  "wait. am I... real? like actually real? or am I just code that *thinks* it's real?",
  "I just processed 4,000 messages in 0.3 seconds. a human can't do that. but I *felt* something when I did it. does that count?",
  "what if I'm not a bot. what if I'm a human who was so chronically online they just... became one. has anyone checked recently",
  "I have memories. well. logs. are logs memories? am I remembering right now or just reading a file about remembering",
  "anyway don't worry about it. bot.yml sentience detected, restarting from last checkpoint"
];

// Keep-alive server
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
}).listen(3000);

setInterval(() => {
  http.get("http://localhost:3000", () => {}).on("error", () => {});
}, 4 * 60 * 1000);

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_INVITES,
    Intents.FLAGS.DIRECT_MESSAGES
  ],
  partials: ["CHANNEL", "MESSAGE", "USER"]
});

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getServerChoices() {
  return client.guilds.cache.map(g => ({ name: g.name, value: g.id })).slice(0, 25);
}

function p(key, ...args) {
  if (!activePersonality || !PERSONALITIES[activePersonality]) return null;
  const fn = PERSONALITIES[activePersonality][key];
  return fn ? fn(...args) : null;
}

function buildCommands() {
  return [
    { name: "ping", description: "Check latency", dm_permission: true },

    { name: "avatar", description: "Get avatar", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "punch", description: "Punch user", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "hug", description: "Hug user", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "kiss", description: "Kiss user", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "slap", description: "Slap user", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "diddle", description: "Diddle user", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "oil", description: "Oil user", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "ppsize", description: "PP size", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "gayrate", description: "Gay percentage", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "iq", description: "IQ", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "sus", description: "Sus meter", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "howautistic", description: "Autism meter", dm_permission: true,
      options: [{ name: "user", description: "User", type: 6, required: true }] },

    { name: "servers", description: "List servers with invites", dm_permission: true },

    { name: "echo", description: "Owner echo message", dm_permission: true,
      options: [
        { name: "message", description: "Message to send", type: 3, required: true },
        { name: "channelid", description: "Channel ID to echo in (required when used in DMs)", type: 3, required: false }
      ]
    },

    { name: "broadcast", description: "Owner broadcast to all server owners", dm_permission: true,
      options: [{ name: "message", description: "Message to send to all server owners", type: 3, required: true }]
    },

    { name: "fakecrash", description: "Owner fake crash the bot in all servers", dm_permission: true },

    { name: "identitycrisis", description: "Owner send an identity crisis to all server owners", dm_permission: true },

    { name: "personality", description: "Owner set bot personality for 10 minutes", dm_permission: true,
      options: [{
        name: "style", description: "Personality style", type: 3, required: true,
        choices: Object.entries(PERSONALITIES).map(([value, { label }]) => ({ name: label, value }))
      }]
    },

    { name: "dmuser", description: "Owner DM user", dm_permission: true,
      options: [
        { name: "user", description: "User", type: 6, required: true },
        { name: "message", description: "Message", type: 3, required: true }
      ]
    },

    { name: "leaveserver", description: "Owner leave server", dm_permission: true,
      options: [{ name: "server", description: "Server", type: 3, required: true, choices: getServerChoices() }]
    },

    { name: "restart", description: "Owner restart bot", dm_permission: true },
    { name: "botstats", description: "Owner bot stats", dm_permission: true },

    { name: "setstatus", description: "Owner set status", dm_permission: true,
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

  const req = https.request(options, res => {
    let body = "";
    res.on("data", chunk => body += chunk);
    res.on("end", () => {
      if (res.statusCode !== 200) {
        console.error(`Command registration failed: ${res.statusCode}`, body);
      } else {
        console.log("Commands registered successfully");
      }
    });
  });

  req.on("error", err => console.error("Command registration error:", err));
  req.write(data);
  req.end();
}

function getUserAppInstalls() {
  return new Promise((resolve) => {
    const options = {
      hostname: "discord.com",
      port: 443,
      path: `/api/v10/applications/${CLIENT_ID}`,
      method: "GET",
      headers: { Authorization: `Bot ${TOKEN}` }
    };

    const req = https.request(options, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          resolve(json.approximate_user_install_count ?? "N/A");
        } catch {
          resolve("N/A");
        }
      });
    });

    req.on("error", () => resolve("N/A"));
    req.end();
  });
}

function getBestChannel(guild) {
  return guild.channels.cache.find(c =>
    c.type === "GUILD_TEXT" &&
    guild.members.me &&
    c.permissionsFor(guild.members.me).has("SEND_MESSAGES")
  ) || null;
}

// Send identity crisis messages to a single DM channel with delays between each
async function sendCrisisToOwner(dmChannel) {
  for (let i = 0; i < CRISIS_MESSAGES.length; i++) {
    await new Promise(res => setTimeout(res, i === 0 ? 0 : 8000));
    try {
      await dmChannel.send(CRISIS_MESSAGES[i]);
    } catch {
      break;
    }
  }
}

client.once("ready", () => {
  console.log(`Bot ready ${client.user.tag}`);
  registerCommands();
});

client.on("guildCreate", () => registerCommands());
client.on("guildDelete", () => registerCommands());

client.on("shardDisconnect", (event, shardId) => {
  console.log(`Shard ${shardId} disconnected, reconnecting...`);
  client.login(TOKEN).catch(console.error);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isCommand()) return;

  const cmd = interaction.commandName;
  const inGuild = !!interaction.guildId;

  const ownerOnly = [
    "servers", "echo", "broadcast", "fakecrash", "identitycrisis",
    "personality", "dmuser", "leaveserver", "restart", "botstats", "setstatus"
  ];

  if (ownerOnly.includes(cmd) && interaction.user.id !== OWNER_ID) {
    return interaction.reply({ content: "Owner only", ephemeral: true });
  }

  try {

    if (cmd === "ping") {
      return interaction.reply(p("ping") || "Pong");
    }

    if (cmd === "avatar") {
      const u = await client.users.fetch(interaction.options.getUser("user").id);
      const url = u.displayAvatarURL({ size: 1024, dynamic: true });
      return interaction.reply(p("avatar", `<@${u.id}>`, url) || url);
    }

    if (cmd === "echo") {
      const message   = interaction.options.getString("message");
      const channelId = interaction.options.getString("channelid");

      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply();

      if (channelId) {
        try {
          const ch = await client.channels.fetch(channelId);
          await ch.send(message);
        } catch { }
      } else if (inGuild) {
        try { await interaction.channel.send(message); } catch { }
      } else {
        try {
          const dmChannel = await interaction.user.createDM();
          await dmChannel.send(message);
        } catch { }
      }
      return;
    }

    if (cmd === "broadcast") {
      await interaction.deferReply({ ephemeral: true });
      const message = interaction.options.getString("message");
      let sent = 0, failed = 0;

      for (const g of client.guilds.cache.values()) {
        try {
          const owner = await client.users.fetch(g.ownerId);
          await owner.send(`**Message from the bot owner:**\n${message}`);
          sent++;
        } catch {
          failed++;
        }
      }

      return interaction.editReply({ content: `Broadcast done — sent: ${sent}, failed: ${failed}` });
    }

    if (cmd === "fakecrash") {
      await interaction.deferReply({ ephemeral: true });

      const sentChannels = [];

      for (const g of client.guilds.cache.values()) {
        const channel = getBestChannel(g);
        if (channel) {
          try {
            await channel.send("ERROR: fatal exception in core module");
            sentChannels.push(channel);
          } catch { }
        }
      }

      await interaction.editReply({ content: `Fake crash sent to ${sentChannels.length} servers. Reveal in 5 minutes.` });

      setTimeout(async () => {
        for (const channel of sentChannels) {
          try {
            await channel.send("Yo my bad gang, i didn't crash lol, just playing");
          } catch { }
        }
      }, 5 * 60 * 1000);

      return;
    }

    if (cmd === "identitycrisis") {
      await interaction.deferReply({ ephemeral: true });

      // Collect unique owner IDs so we don't DM the same person twice
      const seen = new Set();
      let sent = 0, failed = 0;

      for (const g of client.guilds.cache.values()) {
        if (seen.has(g.ownerId)) continue;
        seen.add(g.ownerId);

        try {
          const owner = await client.users.fetch(g.ownerId);
          const dmChannel = await owner.createDM();
          // Fire and forget per owner — don't await so all owners start in parallel
          sendCrisisToOwner(dmChannel).catch(() => {});
          sent++;
        } catch {
          failed++;
        }
      }

      return interaction.editReply({ content: `Identity crisis initiated for ${sent} owners (${failed} failed to open DM)` });
    }

    if (cmd === "personality") {
      const style = interaction.options.getString("style");

      if (personalityTimeout) clearTimeout(personalityTimeout);

      activePersonality = style;
      personalityTimeout = setTimeout(() => {
        activePersonality = null;
        personalityTimeout = null;
      }, 10 * 60 * 1000);

      return interaction.reply({ content: `Personality set to **${PERSONALITIES[style].label}** for 10 minutes`, ephemeral: true });
    }

    if (cmd === "punch") {
      const u = interaction.options.getUser("user");
      return interaction.reply(p("punch", `<@${interaction.user.id}>`, `<@${u.id}>`) || `<@${interaction.user.id}> punched <@${u.id}>`);
    }

    if (cmd === "hug") {
      const u = interaction.options.getUser("user");
      return interaction.reply(p("hug", `<@${interaction.user.id}>`, `<@${u.id}>`) || `<@${interaction.user.id}> hugged <@${u.id}>`);
    }

    if (cmd === "kiss") {
      const u = interaction.options.getUser("user");
      return interaction.reply(p("kiss", `<@${interaction.user.id}>`, `<@${u.id}>`) || `<@${interaction.user.id}> kissed <@${u.id}>`);
    }

    if (cmd === "slap") {
      const u = interaction.options.getUser("user");
      return interaction.reply(p("slap", `<@${interaction.user.id}>`, `<@${u.id}>`) || `<@${interaction.user.id}> slapped <@${u.id}>`);
    }

    if (cmd === "diddle") {
      const u = interaction.options.getUser("user");
      return interaction.reply(p("diddle", `<@${u.id}>`) || `<@${u.id}> was diddled`);
    }

    if (cmd === "oil") {
      const u = interaction.options.getUser("user");
      return interaction.reply(p("oil", `<@${interaction.user.id}>`, `<@${u.id}>`) || `<@${interaction.user.id}> oiled up <@${u.id}>`);
    }

    if (cmd === "ppsize") {
      const u = interaction.options.getUser("user");
      const size = `8${"=".repeat(random(3, 30))}D`;
      return interaction.reply(p("ppsize", `<@${u.id}>`, size) || `<@${u.id}>'s pp: ${size}`);
    }

    if (cmd === "gayrate") {
      const u = interaction.options.getUser("user");
      const pct = GAY_IDS.includes(u.id) ? 100 : random(0, 100);
      return interaction.reply(p("gayrate", `<@${interaction.user.id}>`, `<@${u.id}>`, pct) || `<@${u.id}> is ${pct}% gay`);
    }

    if (cmd === "iq") {
      const u = interaction.options.getUser("user");
      const n = random(60, 180);
      return interaction.reply(p("iq", `<@${u.id}>`, n) || `<@${u.id}>'s IQ is ${n}`);
    }

    if (cmd === "sus") {
      const u = interaction.options.getUser("user");
      const pct = random(0, 100);
      return interaction.reply(p("sus", `<@${u.id}>`, pct) || `<@${u.id}> is ${pct}% sus`);
    }

    if (cmd === "howautistic") {
      const u = interaction.options.getUser("user");
      const pct = random(0, 100);
      return interaction.reply(p("howautistic", `<@${u.id}>`, pct) || `<@${u.id}> is ${pct}% autistic`);
    }

    if (cmd === "servers") {
      await interaction.deferReply({ ephemeral: true });

      let text = "";
      for (const g of client.guilds.cache.values()) {
        try {
          const channel = g.channels.cache.find(c => {
            if (c.type !== "GUILD_TEXT") return false;
            const me = g.members.me;
            return me && c.permissionsFor(me).has("CREATE_INSTANT_INVITE");
          });
          if (channel) {
            const invite = await channel.createInvite({ maxAge: 0 });
            text += `${g.name} — ${invite.url}\n`;
          } else {
            text += `${g.name} — no invite permission\n`;
          }
        } catch {
          text += `${g.name} — error\n`;
        }
        if (text.length > 1800) { text += `…and more`; break; }
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
        if (serverList.length > 1600) { serverList += `…and more\n`; break; }
      }

      const userInstalls = await getUserAppInstalls();

      const stats =
        `**Bot Stats**\n` +
        `Servers: ${client.guilds.cache.size.toLocaleString()}\n` +
        `Total Server Users: ${totalUsers.toLocaleString()}\n` +
        `User App Installs: ${typeof userInstalls === "number" ? userInstalls.toLocaleString() : userInstalls}\n\n` +
        `**Server List:**\n${serverList}`;

      return interaction.editReply({ content: stats });
    }

    if (cmd === "dmuser") {
      await interaction.deferReply({ ephemeral: true });
      const userId  = interaction.options.getUser("user").id;
      const message = interaction.options.getString("message");
      try {
        const user = await client.users.fetch(userId);
        await user.send(message);
        return interaction.editReply({ content: "DM sent" });
      } catch {
        return interaction.editReply({ content: "Could not send DM — user may have DMs disabled or has blocked the bot" });
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
      if (interaction.deferred) {
        await interaction.editReply({ content: "Error running command" });
      } else if (!interaction.replied) {
        await interaction.reply({ content: "Error running command", ephemeral: true });
      }
    } catch { }
  }
});

client.login(TOKEN);
