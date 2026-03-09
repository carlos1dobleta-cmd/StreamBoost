require("dotenv").config();

const { Client, GatewayIntentBits, Partials } = require("discord.js");
const express = require("express");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

/* ======================
   BOT READY
====================== */

client.once("ready", () => {
  console.log(`Bot conectado como ${client.user.tag}`);
});

/* ======================
   COMANDO PING
====================== */

client.on("messageCreate", (message) => {
  if (message.author.bot) return;

  if (message.content === "!ping") {
    message.reply("🏓 Pong!");
  }
});

/* ======================
   TEMP VOICE (simple)
====================== */

client.on("voiceStateUpdate", async (oldState, newState) => {

  if (!newState.channel) return;

  if (newState.channel.name === "➕ Crear Voice") {

    const channel = await newState.guild.channels.create({
      name: `🔊 ${newState.member.user.username}`,
      type: 2,
      parent: newState.channel.parent
    });

    await newState.member.voice.setChannel(channel);
  }

});

/* ======================
   LOGIN BOT
====================== */

if (!process.env.TOKEN) {
  console.log("❌ TOKEN no encontrado");
  process.exit(1);
}

client.login(process.env.TOKEN);

/* ======================
   EXPRESS SERVER
====================== */

const app = express();

app.get("/", (req, res) => {
  res.send("StreamBoost Bot Online");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🌐 Web server running on port " + PORT);
});
