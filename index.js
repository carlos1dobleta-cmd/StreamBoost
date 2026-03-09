require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  Events,
} = require("discord.js");

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(
      {
        guilds: {},
        users: {},
      },
      null,
      2
    )
  );
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    console.error("Error leyendo store:", error);
    return { guilds: {}, users: {} };
  }
}

function writeStore(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function createDefaultGuildData() {
  return {
    config: {
      prefixName: "Gerbercitooo",
      autoRoleId: null,
      welcomeChannelId: null,
      logChannelId: null,
      ticketCategoryId: null,
      ticketPanelChannelId: null,
      statsCategoryId: null,
      memberCountChannelId: null,
      botCountChannelId: null,
      brandChannelId: null,
      tempVoiceCategoryId: null,
      tempVoiceCreateChannelId: null,
      staffRoleIds: [],
      contentModRoleIds: [],
      levelsEnabled: true,
      countingChannelId: null,
      countingCurrent: 1,
      countingLastUserId: null,
    },
    tickets: {},
    tempVoices: {},
    roleButtons: {},
  };
}

function ensureGuildData(guildId) {
  const store = readStore();
  if (!store.guilds[guildId]) {
    store.guilds[guildId] = createDefaultGuildData();
    writeStore(store);
  }
  return store.guilds[guildId];
}

function getGuildConfig(guildId) {
  ensureGuildData(guildId);
  const store = readStore();
  return store.guilds[guildId].config;
}

function updateGuildData(guildId, updater) {
  const store = readStore();
  if (!store.guilds[guildId]) {
    store.guilds[guildId] = createDefaultGuildData();
  }
  updater(store.guilds[guildId]);
  writeStore(store);
}

function getUserKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function ensureUserData(guildId, userId) {
  const store = readStore();
  const key = getUserKey(guildId, userId);

  if (!store.users[key]) {
    store.users[key] = {
      xp: 0,
      level: 0,
      balance: 0,
      lastXpAt: 0,
      lastDailyAt: 0,
    };
    writeStore(store);
  }

  return store.users[key];
}

function updateUserData(guildId, userId, updater) {
  const store = readStore();
  const key = getUserKey(guildId, userId);

  if (!store.users[key]) {
    store.users[key] = {
      xp: 0,
      level: 0,
      balance: 0,
      lastXpAt: 0,
      lastDailyAt: 0,
    };
  }

  updater(store.users[key]);
  writeStore(store);
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds && parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ") || "0s";
}

async function safeSend(channel, payload) {
  try {
    return await channel.send(payload);
  } catch (error) {
    console.error("Error enviando mensaje:", error.message);
    return null;
  }
}

function bigEmbed({
  color = 0x5865f2,
  title,
  description,
  footer,
  thumbnail,
  image,
}) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  if (footer) embed.setFooter({ text: footer });
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);

  return embed;
}

async function logAction(guild, description, color = 0x5865f2) {
  const config = getGuildConfig(guild.id);
  if (!config.logChannelId) return;

  const channel = guild.channels.cache.get(config.logChannelId);
  if (!channel || !channel.isTextBased()) return;

  await safeSend(channel, {
    embeds: [
      bigEmbed({
        color,
        title: "📋 Registro del servidor",
        description,
        footer: `${guild.name} • Logs`,
      }),
    ],
  });
}

async function ensureRole(guild, name, options = {}) {
  let role = guild.roles.cache.find((r) => r.name === name);

  if (!role) {
    role = await guild.roles.create({
      name,
      color: options.color,
      hoist: options.hoist ?? false,
      mentionable: options.mentionable ?? false,
      permissions: options.permissions ?? [],
      reason: "Creación automática de plantilla",
    });
  }

  return role;
}

async function ensureCategory(guild, name, permissionOverwrites = []) {
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === name
  );

  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites,
      reason: "Creación automática de plantilla",
    });
  }

  return category;
}

async function ensureTextChannel(guild, category, name, options = {}) {
  let channel = guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildText &&
      c.parentId === category.id &&
      c.name === name
  );

  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: options.topic || null,
      permissionOverwrites: options.permissionOverwrites || [],
      reason: "Creación automática de plantilla",
    });
  }

  return channel;
}

async function ensureVoiceChannel(guild, category, name, options = {}) {
  let channel = guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildVoice &&
      c.parentId === category.id &&
      c.name === name
  );

  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: options.permissionOverwrites || [],
      userLimit: options.userLimit || 0,
      reason: "Creación automática de plantilla",
    });
  }

  return channel;
}

async function wipeServerContent(guild) {
  const me = guild.members.me || (await guild.members.fetchMe());
  const botHighestRole = me.roles.highest;

  const channels = [...guild.channels.cache.values()].sort((a, b) => b.position - a.position);
  for (const channel of channels) {
    try {
      await channel.delete("Reemplazando servidor con nueva plantilla");
    } catch (error) {
      console.error(`No pude borrar canal ${channel.name}:`, error.message);
    }
  }

  await guild.roles.fetch();

  const roles = [...guild.roles.cache.values()]
    .filter(
      (role) =>
        role.id !== guild.roles.everyone.id &&
        !role.managed &&
        role.editable &&
        role.position < botHighestRole.position
    )
    .sort((a, b) => b.position - a.position);

  for (const role of roles) {
    try {
      await role.delete("Reemplazando servidor con nueva plantilla");
    } catch (error) {
      console.error(`No pude borrar rol ${role.name}:`, error.message);
    }
  }

  updateGuildData(guild.id, (data) => {
    data.config = createDefaultGuildData().config;
    data.tickets = {};
    data.tempVoices = {};
    data.roleButtons = {};
  });
}

async function createBaseRoles(guild) {
  const ownerRole = await ensureRole(guild, "👑 Owner", {
    color: 0xf1c40f,
    hoist: true,
    mentionable: true,
    permissions: [PermissionsBitField.Flags.Administrator],
  });

  const adminRole = await ensureRole(guild, "🛡️ Admin", {
    color: 0xe74c3c,
    hoist: true,
    mentionable: true,
    permissions: [
      PermissionsBitField.Flags.ManageGuild,
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageRoles,
      PermissionsBitField.Flags.ManageMessages,
      PermissionsBitField.Flags.KickMembers,
      PermissionsBitField.Flags.BanMembers,
      PermissionsBitField.Flags.ModerateMembers,
      PermissionsBitField.Flags.ViewAuditLog,
      PermissionsBitField.Flags.ManageWebhooks,
    ],
  });

  const moderatorRole = await ensureRole(guild, "🔨 Moderator", {
    color: 0x3498db,
    hoist: true,
    mentionable: true,
    permissions: [
      PermissionsBitField.Flags.ManageMessages,
      PermissionsBitField.Flags.KickMembers,
      PermissionsBitField.Flags.ModerateMembers,
      PermissionsBitField.Flags.MoveMembers,
      PermissionsBitField.Flags.MuteMembers,
      PermissionsBitField.Flags.DeafenMembers,
      PermissionsBitField.Flags.ViewAuditLog,
    ],
  });

  const kickModRole = await ensureRole(guild, "🟢 Kick Mod", {
    color: 0x2ecc71,
    hoist: true,
    mentionable: true,
  });

  const youtubeModRole = await ensureRole(guild, "🔴 YouTube Mod", {
    color: 0xe74c3c,
    hoist: true,
    mentionable: true,
  });

  const tiktokModRole = await ensureRole(guild, "⚫ TikTok Mod", {
    color: 0x2c3e50,
    hoist: true,
    mentionable: true,
  });

  const vipRole = await ensureRole(guild, "💎 VIP", {
    color: 0x9b59b6,
    hoist: true,
    mentionable: true,
  });

  const memberRole = await ensureRole(guild, "👤 Member", {
    color: 0x95a5a6,
    hoist: false,
    mentionable: false,
  });

  const participantesRole = await ensureRole(guild, "✅ Participantes", {
    color: 0x2ecc71,
    hoist: false,
    mentionable: true,
  });

  updateGuildData(guild.id, (data) => {
    data.config.autoRoleId = memberRole.id;
    data.config.staffRoleIds = [ownerRole.id, adminRole.id, moderatorRole.id];
    data.config.contentModRoleIds = [
      kickModRole.id,
      youtubeModRole.id,
      tiktokModRole.id,
    ];
  });

  return {
    ownerRole,
    adminRole,
    moderatorRole,
    kickModRole,
    youtubeModRole,
    tiktokModRole,
    vipRole,
    memberRole,
    participantesRole,
  };
}

function makeStaffOverwrites(guild, roleIds) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
  ];

  for (const roleId of roleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.Connect,
        PermissionsBitField.Flags.Speak,
      ],
    });
  }

  return overwrites;
}

async function updateStatsForGuild(guild) {
  const config = getGuildConfig(guild.id);
  if (!config.memberCountChannelId || !config.botCountChannelId) return;

  const membersChannel = guild.channels.cache.get(config.memberCountChannelId);
  const botsChannel = guild.channels.cache.get(config.botCountChannelId);
  const brandChannel = config.brandChannelId
    ? guild.channels.cache.get(config.brandChannelId)
    : null;

  const memberCount = guild.members.cache.filter((m) => !m.user.bot).size;
  const botCount = guild.members.cache.filter((m) => m.user.bot).size;

  try {
    if (brandChannel) {
      const wanted = `┋🟢┋${(config.prefixName || "Gerbercitooo").toLowerCase()}`;
      if (brandChannel.name !== wanted) await brandChannel.setName(wanted);
    }

    if (membersChannel) {
      const wanted = `┋👥┋members-${memberCount}`;
      if (membersChannel.name !== wanted) await membersChannel.setName(wanted);
    }

    if (botsChannel) {
      const wanted = `┋🤖┋bots-${botCount}`;
      if (botsChannel.name !== wanted) await botsChannel.setName(wanted);
    }
  } catch (error) {
    console.error("Error actualizando stats:", error.message);
  }
}

async function sendSetupMessages({
  guild,
  welcomeChannel,
  rulesChannel,
  autoRolesChannel,
  announcementsChannel,
  alertsChannel,
  ticketsChannel,
}) {
  if (welcomeChannel) {
    await safeSend(welcomeChannel, {
      embeds: [
        bigEmbed({
          color: 0x57f287,
          title: "👋 Bienvenido a la comunidad",
          description:
            `Bienvenido a **${guild.name}**\n\n` +
            `Aquí encontrarás una comunidad organizada para hablar, compartir clips, participar en eventos y disfrutar del servidor.\n\n` +
            `✅ Lee las reglas\n` +
            `🎭 Elige tus roles\n` +
            `📢 Revisa los anuncios y alertas\n` +
            `💬 Participa en los canales de la comunidad`,
          footer: `${guild.name} • Welcome`,
        }),
      ],
    });
  }

  if (rulesChannel) {
    await safeSend(rulesChannel, {
      embeds: [
        bigEmbed({
          color: 0xfee75c,
          title: "📜 Reglas del servidor",
          description:
            `1. Respeta a todos los miembros.\n` +
            `2. Nada de spam, flood o contenido tóxico.\n` +
            `3. Usa cada canal para el tema correcto.\n` +
            `4. No abuses de menciones o pings.\n` +
            `5. Sigue las indicaciones del staff.\n` +
            `6. Evita compartir contenido prohibido.\n\n` +
            `El incumplimiento puede terminar en mute, kick o ban.`,
          footer: `${guild.name} • Rules`,
        }),
      ],
    });
  }

  if (announcementsChannel) {
    await safeSend(announcementsChannel, {
      embeds: [
        bigEmbed({
          color: 0x5865f2,
          title: "📢 Announcements",
          description:
            `Este canal está reservado para avisos importantes del servidor.\n\n` +
            `✨ Novedades\n` +
            `🎉 Eventos\n` +
            `🎁 Sorteos\n` +
            `🛠️ Cambios del servidor\n` +
            `📣 Comunicados del staff`,
          footer: `${guild.name} • Announcements`,
        }),
      ],
    });
  }

  if (alertsChannel) {
    await safeSend(alertsChannel, {
      embeds: [
        bigEmbed({
          color: 0xeb459e,
          title: "🔔 Alertas y notificaciones",
          description:
            `Aquí se enviarán alertas importantes relacionadas con streams, contenido y avisos especiales.\n\n` +
            `🟢 Kick\n` +
            `🔴 YouTube\n` +
            `⚫ TikTok\n` +
            `📌 Otras notificaciones del servidor`,
          footer: `${guild.name} • Alerts`,
        }),
      ],
    });
  }

  if (autoRolesChannel) {
    await safeSend(autoRolesChannel, {
      embeds: [
        bigEmbed({
          color: 0xeb459e,
          title: "🎭 Panel de Roles",
          description:
            `Pulsa los botones de abajo para recibir o quitarte roles automáticos.\n\n` +
            `💎 VIP\n` +
            `✅ Participantes\n\n` +
            `Los roles de staff y moderación se entregan manualmente.`,
          footer: `${guild.name} • Auto Roles`,
        }),
      ],
    });
  }

  if (ticketsChannel) {
    const embed = bigEmbed({
      color: 0x5865f2,
      title: "🎫 Sistema de Soporte",
      description:
        `Bienvenido al panel de soporte.\n\n` +
        `Pulsa el botón para abrir un ticket privado con el staff.\n\n` +
        `✅ Atención privada\n` +
        `⚡ Respuesta del equipo\n` +
        `🔒 Ticket seguro\n` +
        `⛔ No abras tickets por bromas o spam`,
      footer: `${guild.name} • Support Panel`,
    }).addFields(
      {
        name: "📌 Cuándo abrir ticket",
        value:
          "• Problemas con el servidor\n• Reportes\n• Soporte general\n• Dudas importantes",
      },
      {
        name: "⛔ No usar tickets para",
        value: "• Spam\n• Bromas\n• Saludos\n• Cosas que van en general",
      }
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket:create")
        .setLabel("Abrir Ticket")
        .setEmoji("🎫")
        .setStyle(ButtonStyle.Primary)
    );

    await safeSend(ticketsChannel, {
      embeds: [embed],
      components: [row],
    });
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName("setup-template")
    .setDescription("Borra el contenido del servidor y crea la nueva plantilla"),

  new SlashCommandBuilder()
    .setName("setup-roles")
    .setDescription("Crea los roles automáticos del servidor"),

  new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("Envía el panel bonito de tickets")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Canal donde enviar el panel")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    ),

  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Configura autorol")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Establece el autorol")
        .addRoleOption((opt) =>
          opt.setName("role").setDescription("Rol").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("clear").setDescription("Quita el autorol")
    ),

  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Configura canal de logs")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Canal de logs")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Canal")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    ),

  new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Configura canal de bienvenida")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Canal de bienvenida")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Canal")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    ),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Configura server stats")
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription("Crea los canales stats")
        .addStringOption((opt) =>
          opt.setName("brand").setDescription("Texto principal").setRequired(false)
        )
    ),

  new SlashCommandBuilder()
    .setName("tempvoice")
    .setDescription("Configura temp voice")
    .addSubcommand((sub) =>
      sub.setName("setup").setDescription("Crea la categoría y canal temp voice")
    ),

  new SlashCommandBuilder()
    .setName("role-button")
    .setDescription("Crea botón para dar o quitar rol")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Canal")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    )
    .addRoleOption((opt) =>
      opt.setName("role").setDescription("Rol").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("label").setDescription("Texto del botón").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("emoji").setDescription("Emoji").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Banea un usuario")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Usuario").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Razón").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulsa un usuario")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Usuario").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Razón").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a un usuario")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Usuario").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("minutes")
        .setDescription("Minutos")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Razón").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Borra mensajes")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Cantidad")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Reclama tu diaria"),

  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Mira tu balance")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Usuario").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Cara o cruz")
    .addStringOption((opt) =>
      opt
        .setName("choice")
        .setDescription("cara o cruz")
        .setRequired(true)
        .addChoices(
          { name: "cara", value: "cara" },
          { name: "cruz", value: "cruz" }
        )
    )
    .addIntegerOption((opt) =>
      opt.setName("bet").setDescription("Apuesta").setRequired(true).setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Mira tu rango")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Usuario").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("levels")
    .setDescription("Activa o desactiva niveles")
    .addBooleanOption((opt) =>
      opt.setName("enabled").setDescription("true/false").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("counting")
    .setDescription("Configura el conteo")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Fija canal de conteo")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Canal")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("reset").setDescription("Resetea el conteo")
    ),
].map((c) => c.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message],
});

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    if (process.env.DEV_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(
          process.env.CLIENT_ID,
          process.env.DEV_GUILD_ID
        ),
        { body: commands }
      );
      console.log("Comandos slash registrados en guild de desarrollo.");
    } else {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
        body: commands,
      });
      console.log("Comandos slash registrados globalmente.");
    }
  } catch (error) {
    console.error("Error registrando comandos:", error);
  }
}

async function createTemplate(interaction) {
  const guild = interaction.guild;

  await interaction.reply({
    content: "⚙️ Borrando el servidor y montando la nueva plantilla...",
    ephemeral: true,
  });

  await guild.members.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);
  await guild.roles.fetch().catch(() => null);

  await wipeServerContent(guild);
  await guild.channels.fetch().catch(() => null);
  await guild.roles.fetch().catch(() => null);

  const roles = await createBaseRoles(guild);

  const staffOverwrites = makeStaffOverwrites(guild, [
    roles.ownerRole.id,
    roles.adminRole.id,
    roles.moderatorRole.id,
  ]);

  const statsVoiceOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.Connect],
      allow: [PermissionsBitField.Flags.ViewChannel],
    },
  ];

  const categories = [
    {
      name: "───・SERVER STATS・───",
      text: ["┋🟢┋gerbercitooo"],
      voice: ["┋👥┋members-0", "┋🤖┋bots-0"],
      isStats: true,
    },
    {
      name: "───・IMPORTANTE・───",
      text: [
        "┋👋┋ᴡᴇʟᴄᴏᴍᴇ",
        "┋🚀┋ʙᴏᴏꜱᴛɪɴɢ",
        "┋🎭┋ᴀᴜᴛᴏ-ʀᴏʟᴇꜱ",
        "┋📢┋ᴀɴɴᴏᴜɴᴄᴇᴍᴇɴᴛꜱ",
        "┋📅┋ᴇᴠᴇɴᴛᴏꜱ",
        "┋📜┋ʀᴜʟᴇꜱ",
      ],
      voice: [],
    },
    {
      name: "───・NOTIFICACIONES・───",
      text: [
        "┋🟢┋ᴋɪᴄᴋ",
        "┋🔴┋ʏᴏᴜᴛᴜʙᴇ",
        "┋⚫┋ᴛɪᴋᴛᴏᴋ",
        "┋📖┋ʀᴏꜱᴀʀɪᴏ",
      ],
      voice: [],
    },
    {
      name: "───・COMMUNITY・───",
      text: [
        "┋💬┋ɢᴇɴᴇʀᴀʟ",
        "┋📸┋ᴍᴜʟᴛɪᴍᴇᴅɪᴀ",
        "┋🎬┋ᴄʟɪᴘꜱ",
        "┋✨┋ʀᴇᴀᴄᴄɪᴏɴᴀʀ",
        "┋😂┋ᴍᴇᴍᴇꜱ",
        "┋🤖┋ʙᴏᴛ-ᴄᴏᴍᴍᴀɴᴅꜱ",
        "┋🎨┋ꜰᴀɴ-ᴀʀᴛꜱ",
        "┋🗑️┋ꜱᴘᴀᴍ",
        "┋🌐┋ᴄᴜᴇɴᴛᴀꜱ-ꜱᴇɢᴜɪᴅᴏʀᴇꜱ",
        "┋🎰┋ᴀᴘᴜᴇꜱᴛᴀꜱ",
        "┋💯┋ʙᴀɴᴅᴀ-ᴄʟɪᴘꜱ",
      ],
      voice: [],
    },
    {
      name: "───・DINÁMICAS COMMUNITY・───",
      text: [
        "┋💣┋ᴄᴀᴘᴛᴜʀᴀᴅᴀꜱ",
        "┋🎤┋ᴀᴜᴅɪᴏꜱ-ʀᴀɴᴅᴏᴍ",
        "┋🚗┋ᴄᴀʀʀᴏꜱ",
        "┋🐶┋ᴍᴀꜱᴄᴏᴛᴀꜱ",
      ],
      voice: [],
    },
    {
      name: "───・JUEGOS・───",
      text: [
        "┋🤫┋ᴄᴏɴꜰᴇꜱɪᴏɴᴇꜱ",
        "┋🔢┋ᴄᴏɴᴛᴇᴏ",
        "┋🎰┋ᴄᴀꜱɪɴᴏ",
      ],
      voice: [],
    },
    {
      name: "───・SORTEOS・───",
      text: ["┋🎁┋ɢɪᴠᴇᴀᴡᴀʏ"],
      voice: [],
    },
    {
      name: "───・ESPERA・───",
      text: [],
      voice: ["🔊 Sala de Espera"],
    },
    {
      name: "───・VOICE CHANNEL・───",
      text: [],
      voice: [
        "🔊 General #1",
        "🔊 General #2",
        "🔊 General #3",
        "🎵 Música #1",
        "🎵 Música #2",
        "⚽ Futbol",
        "💎 Vip",
      ],
    },
    {
      name: "───・COMUNIDAD・───",
      text: ["┋✅┋ᴘᴀʀᴛɪᴄɪᴘᴀɴᴛᴇꜱ", "┋👑┋ɢᴇʀʙᴇʀᴄɪᴛᴏᴏᴏ"],
      voice: [],
    },
    {
      name: "───・CANALES TEMPORALES・───",
      text: ["┋🎧┋ɢᴇꜱᴛɪᴏɴᴀʀ-ᴠᴄ"],
      voice: ["➕ Crear voice"],
    },
    {
      name: "───・SUPPORT・───",
      text: ["┋🎫┋ᴛɪᴄᴋᴇᴛꜱ"],
      voice: ["📞 Soporte"],
    },
    {
      name: "───・AFK・───",
      text: [],
      voice: ["🔇 AFK"],
    },
    {
      name: "───・STAFF・───",
      text: ["┋📢┋ꜱᴛᴀꜰꜰ-ᴀɴɴᴏᴜɴᴄᴇ", "┋📋┋ʟᴏɢꜱ", "┋🛡️┋ᴍᴏᴅ-ᴄʜᴀᴛ"],
      voice: ["🔊 Staff VC #1", "🔊 Staff VC #2"],
      isStaff: true,
    },
  ];

  let welcomeChannel = null;
  let rulesChannel = null;
  let autoRolesChannel = null;
  let announcementsChannel = null;
  let alertsChannel = null;
  let ticketsChannel = null;
  let logsChannel = null;
  let supportCategory = null;
  let tempVoiceCategory = null;
  let tempVoiceCreateChannel = null;
  let statsCategory = null;
  let membersStatsChannel = null;
  let botsStatsChannel = null;
  let brandChannel = null;

  for (const categoryData of categories) {
    const category = await ensureCategory(
      guild,
      categoryData.name,
      categoryData.isStaff ? staffOverwrites : []
    );

    if (categoryData.name === "───・SUPPORT・───") supportCategory = category;
    if (categoryData.name === "───・CANALES TEMPORALES・───") tempVoiceCategory = category;
    if (categoryData.name === "───・SERVER STATS・───") statsCategory = category;

    for (const textName of categoryData.text) {
      const channel = await ensureTextChannel(guild, category, textName, {
        permissionOverwrites: categoryData.isStaff ? staffOverwrites : [],
      });

      if (textName === "┋👋┋ᴡᴇʟᴄᴏᴍᴇ") welcomeChannel = channel;
      if (textName === "┋📜┋ʀᴜʟᴇꜱ") rulesChannel = channel;
      if (textName === "┋🎭┋ᴀᴜᴛᴏ-ʀᴏʟᴇꜱ") autoRolesChannel = channel;
      if (textName === "┋📢┋ᴀɴɴᴏᴜɴᴄᴇᴍᴇɴᴛꜱ") announcementsChannel = channel;
      if (textName === "┋🟢┋ᴋɪᴄᴋ") alertsChannel = channel;
      if (textName === "┋🎫┋ᴛɪᴄᴋᴇᴛꜱ") ticketsChannel = channel;
      if (textName === "┋📋┋ʟᴏɢꜱ") logsChannel = channel;
      if (textName === "┋🟢┋gerbercitooo") brandChannel = channel;
    }

    for (const voiceName of categoryData.voice) {
      const channel = await ensureVoiceChannel(guild, category, voiceName, {
        permissionOverwrites: categoryData.isStaff
          ? staffOverwrites
          : categoryData.isStats
          ? statsVoiceOverwrites
          : [],
      });

      if (voiceName === "➕ Crear voice") tempVoiceCreateChannel = channel;
      if (voiceName === "┋👥┋members-0") membersStatsChannel = channel;
      if (voiceName === "┋🤖┋bots-0") botsStatsChannel = channel;
    }
  }

  updateGuildData(guild.id, (data) => {
    data.config.prefixName = "Gerbercitooo";
    data.config.autoRoleId = roles.memberRole.id;
    data.config.welcomeChannelId = welcomeChannel?.id || null;
    data.config.logChannelId = logsChannel?.id || null;
    data.config.ticketCategoryId = supportCategory?.id || null;
    data.config.ticketPanelChannelId = ticketsChannel?.id || null;
    data.config.statsCategoryId = statsCategory?.id || null;
    data.config.memberCountChannelId = membersStatsChannel?.id || null;
    data.config.botCountChannelId = botsStatsChannel?.id || null;
    data.config.brandChannelId = brandChannel?.id || null;
    data.config.tempVoiceCategoryId = tempVoiceCategory?.id || null;
    data.config.tempVoiceCreateChannelId = tempVoiceCreateChannel?.id || null;
  });

  await guild.members.fetch().catch(() => null);
  await updateStatsForGuild(guild);

  await sendSetupMessages({
    guild,
    welcomeChannel,
    rulesChannel,
    autoRolesChannel,
    announcementsChannel,
    alertsChannel,
    ticketsChannel,
  });

  if (autoRolesChannel) {
    const publicRoleButtons = [
      { role: roles.vipRole, label: "VIP", emoji: "💎" },
      { role: roles.participantesRole, label: "Participantes", emoji: "✅" },
    ];

    for (const entry of publicRoleButtons) {
      const customId = `rolebtn:${entry.role.id}`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(customId)
          .setLabel(entry.label)
          .setEmoji(entry.emoji)
          .setStyle(ButtonStyle.Secondary)
      );

      await autoRolesChannel.send({ components: [row] });

      updateGuildData(guild.id, (data) => {
        data.roleButtons[customId] = {
          roleId: entry.role.id,
          channelId: autoRolesChannel.id,
        };
      });
    }
  }

  await logAction(
    guild,
    `🛠️ **${interaction.user.tag}** creó la plantilla completa del servidor.`,
    0x57f287
  );

  await interaction.editReply({
    content: "",
    embeds: [
      bigEmbed({
        color: 0x57f287,
        title: "✅ Plantilla creada",
        description:
          `La plantilla fue creada correctamente.\n\n` +
          `• Se borró el contenido anterior\n` +
          `• Se crearon roles y permisos\n` +
          `• Los logs van a STAFF\n` +
          `• Los roles mod se entregan manualmente\n` +
          `• Welcome y paneles grandes activados`,
        footer: `${guild.name} • Setup Complete`,
      }),
    ],
  });
}

async function handleSlash(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({
      content: "Este comando solo funciona dentro de un servidor.",
      ephemeral: true,
    });
  }

  ensureGuildData(guild.id);

  const adminOnly = [
    "setup-template",
    "setup-roles",
    "ticket-panel",
    "autorole",
    "logs",
    "welcome",
    "stats",
    "tempvoice",
    "role-button",
    "ban",
    "kick",
    "timeout",
    "clear",
    "levels",
    "counting",
  ];

  if (
    adminOnly.includes(interaction.commandName) &&
    !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)
  ) {
    return interaction.reply({
      content: "❌ Necesitas Administrador para usar este comando.",
      ephemeral: true,
    });
  }

  if (interaction.commandName === "setup-template") {
    return createTemplate(interaction);
  }

  if (interaction.commandName === "setup-roles") {
    const roles = await createBaseRoles(guild);

    return interaction.reply({
      content:
        `✅ Roles creados:\n` +
        `${roles.ownerRole}\n${roles.adminRole}\n${roles.moderatorRole}\n` +
        `${roles.kickModRole}\n${roles.youtubeModRole}\n${roles.tiktokModRole}\n` +
        `${roles.vipRole}\n${roles.memberRole}\n${roles.participantesRole}`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "ticket-panel") {
    const channel = interaction.options.getChannel("channel");

    const embed = bigEmbed({
      color: 0x5865f2,
      title: "🎫 Sistema de Soporte",
      description:
        `Bienvenido al panel de soporte.\n\n` +
        `Pulsa el botón de abajo para abrir un ticket privado.\n\n` +
        `✅ Atención privada\n` +
        `🔒 Canal seguro\n` +
        `⚡ Staff disponible`,
      footer: `${guild.name} • Support Panel`,
    }).addFields(
      {
        name: "📌 Cuándo abrir ticket",
        value:
          "• Reportes\n• Problemas con el servidor\n• Soporte general\n• Dudas importantes",
      },
      {
        name: "⛔ No usar tickets para",
        value: "• Spam\n• Bromas\n• Saludar\n• Cosas que van al chat general",
      }
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket:create")
        .setLabel("Abrir Ticket")
        .setEmoji("🎫")
        .setStyle(ButtonStyle.Primary)
    );

    await channel.send({ embeds: [embed], components: [row] });

    updateGuildData(guild.id, (data) => {
      data.config.ticketPanelChannelId = channel.id;
    });

    return interaction.reply({
      content: `✅ Panel de tickets enviado a ${channel}`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "autorole") {
    const sub = interaction.options.getSubcommand();

    if (sub === "set") {
      const role = interaction.options.getRole("role");
      updateGuildData(guild.id, (data) => {
        data.config.autoRoleId = role.id;
      });

      return interaction.reply({
        content: `✅ Autorol configurado: ${role}`,
        ephemeral: true,
      });
    }

    if (sub === "clear") {
      updateGuildData(guild.id, (data) => {
        data.config.autoRoleId = null;
      });

      return interaction.reply({
        content: "✅ Autorol eliminado.",
        ephemeral: true,
      });
    }
  }

  if (interaction.commandName === "logs") {
    const channel = interaction.options.getChannel("channel");
    updateGuildData(guild.id, (data) => {
      data.config.logChannelId = channel.id;
    });

    return interaction.reply({
      content: `✅ Canal de logs configurado en ${channel}`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "welcome") {
    const channel = interaction.options.getChannel("channel");
    updateGuildData(guild.id, (data) => {
      data.config.welcomeChannelId = channel.id;
    });

    return interaction.reply({
      content: `✅ Canal de bienvenida configurado en ${channel}`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "stats") {
    const brand = interaction.options.getString("brand") || "Gerbercitooo";

    let category = guild.channels.cache.find(
      (c) =>
        c.type === ChannelType.GuildCategory &&
        c.name === "───・SERVER STATS・───"
    );

    if (!category) {
      category = await guild.channels.create({
        name: "───・SERVER STATS・───",
        type: ChannelType.GuildCategory,
      });
    }

    const lockedOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.Connect],
        allow: [PermissionsBitField.Flags.ViewChannel],
      },
    ];

    const brandChannel = await ensureTextChannel(
      guild,
      category,
      `┋🟢┋${brand.toLowerCase()}`
    );

    const membersChannel = await ensureVoiceChannel(
      guild,
      category,
      "┋👥┋members-0",
      { permissionOverwrites: lockedOverwrites }
    );

    const botsChannel = await ensureVoiceChannel(
      guild,
      category,
      "┋🤖┋bots-0",
      { permissionOverwrites: lockedOverwrites }
    );

    updateGuildData(guild.id, (data) => {
      data.config.prefixName = brand;
      data.config.statsCategoryId = category.id;
      data.config.brandChannelId = brandChannel.id;
      data.config.memberCountChannelId = membersChannel.id;
      data.config.botCountChannelId = botsChannel.id;
    });

    await guild.members.fetch().catch(() => null);
    await updateStatsForGuild(guild);

    return interaction.reply({
      content: "✅ Server stats configurado.",
      ephemeral: true,
    });
  }

  if (interaction.commandName === "tempvoice") {
    let category = guild.channels.cache.find(
      (c) =>
        c.type === ChannelType.GuildCategory &&
        c.name === "───・CANALES TEMPORALES・───"
    );

    if (!category) {
      category = await guild.channels.create({
        name: "───・CANALES TEMPORALES・───",
        type: ChannelType.GuildCategory,
      });
    }

    const manageChannel = await ensureTextChannel(
      guild,
      category,
      "┋🎧┋ɢᴇꜱᴛɪᴏɴᴀʀ-ᴠᴄ"
    );

    const createVoice = await ensureVoiceChannel(guild, category, "➕ Crear voice");

    updateGuildData(guild.id, (data) => {
      data.config.tempVoiceCategoryId = category.id;
      data.config.tempVoiceCreateChannelId = createVoice.id;
    });

    return interaction.reply({
      content:
        `✅ Temp voice configurado.\n` +
        `Texto: ${manageChannel}\n` +
        `Voice: **${createVoice.name}**`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "role-button") {
    const channel = interaction.options.getChannel("channel");
    const role = interaction.options.getRole("role");
    const label = interaction.options.getString("label");
    const emoji = interaction.options.getString("emoji");
    const customId = `rolebtn:${role.id}`;

    const button = new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(ButtonStyle.Secondary);

    if (emoji) button.setEmoji(emoji);

    const row = new ActionRowBuilder().addComponents(button);

    await channel.send({
      embeds: [
        bigEmbed({
          color: 0x57f287,
          title: "🎭 Panel de Rol",
          description: `Pulsa el botón para recibir o quitarte el rol ${role}.`,
          footer: `${guild.name} • Role Panel`,
        }),
      ],
      components: [row],
    });

    updateGuildData(guild.id, (data) => {
      data.roleButtons[customId] = {
        roleId: role.id,
        channelId: channel.id,
      };
    });

    return interaction.reply({
      content: `✅ Botón de rol creado para ${role}`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "ban") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return interaction.reply({
        content: "❌ No tienes permiso para banear.",
        ephemeral: true,
      });
    }

    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "Sin razón";
    const member = await guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.reply({
        content: "❌ No encontré a ese usuario.",
        ephemeral: true,
      });
    }

    await member.ban({ reason: `${reason} | Por ${interaction.user.tag}` });

    await interaction.reply(`🔨 ${user.tag} fue baneado.`);
    await logAction(
      guild,
      `🔨 **Ban**\nUsuario: <@${user.id}>\nModerador: <@${interaction.user.id}>\nRazón: ${reason}`,
      0xed4245
    );
    return;
  }

  if (interaction.commandName === "kick") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return interaction.reply({
        content: "❌ No tienes permiso para expulsar.",
        ephemeral: true,
      });
    }

    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "Sin razón";
    const member = await guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.reply({
        content: "❌ No encontré a ese usuario.",
        ephemeral: true,
      });
    }

    await member.kick(`${reason} | Por ${interaction.user.tag}`);

    await interaction.reply(`👢 ${user.tag} fue expulsado.`);
    await logAction(
      guild,
      `👢 **Kick**\nUsuario: <@${user.id}>\nModerador: <@${interaction.user.id}>\nRazón: ${reason}`,
      0xe67e22
    );
    return;
  }

  if (interaction.commandName === "timeout") {
    if (
      !interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)
    ) {
      return interaction.reply({
        content: "❌ No tienes permiso para timeout.",
        ephemeral: true,
      });
    }

    const user = interaction.options.getUser("user");
    const minutes = interaction.options.getInteger("minutes");
    const reason = interaction.options.getString("reason") || "Sin razón";
    const member = await guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.reply({
        content: "❌ No encontré a ese usuario.",
        ephemeral: true,
      });
    }

    await member.timeout(minutes * 60 * 1000, `${reason} | Por ${interaction.user.tag}`);

    await interaction.reply(`⏳ ${user.tag} recibió timeout por ${minutes} minutos.`);
    await logAction(
      guild,
      `⏳ **Timeout**\nUsuario: <@${user.id}>\nModerador: <@${interaction.user.id}>\nDuración: ${minutes} minutos\nRazón: ${reason}`,
      0xfee75c
    );
    return;
  }

  if (interaction.commandName === "clear") {
    if (
      !interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)
    ) {
      return interaction.reply({
        content: "❌ No tienes permiso para borrar mensajes.",
        ephemeral: true,
      });
    }

    const amount = interaction.options.getInteger("amount");
    const deleted = await interaction.channel.bulkDelete(amount, true);

    await interaction.reply({
      content: `🧹 Se borraron ${deleted.size} mensajes.`,
      ephemeral: true,
    });

    await logAction(
      guild,
      `🧹 **Clear**\nCanal: ${interaction.channel}\nModerador: <@${interaction.user.id}>\nCantidad: ${deleted.size}`,
      0x95a5a6
    );
    return;
  }

  if (interaction.commandName === "daily") {
    const user = ensureUserData(guild.id, interaction.user.id);
    const now = Date.now();
    const cooldown = 24 * 60 * 60 * 1000;

    if (now - user.lastDailyAt < cooldown) {
      return interaction.reply({
        content: `⏳ Ya reclamaste tu diaria. Vuelve en **${formatDuration(
          cooldown - (now - user.lastDailyAt)
        )}**.`,
        ephemeral: true,
      });
    }

    const reward = 250;

    updateUserData(guild.id, interaction.user.id, (u) => {
      u.balance += reward;
      u.lastDailyAt = now;
    });

    return interaction.reply({
      content: `💸 Reclamas tu diaria: **${reward}** monedas.`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "balance") {
    const target = interaction.options.getUser("user") || interaction.user;
    const data = ensureUserData(guild.id, target.id);

    return interaction.reply({
      embeds: [
        bigEmbed({
          color: 0x57f287,
          title: "💰 Balance",
          description: `**${target.username}** tiene **${data.balance}** monedas.`,
          footer: `${guild.name} • Economy`,
        }),
      ],
      ephemeral: true,
    });
  }

  if (interaction.commandName === "coinflip") {
    const choice = interaction.options.getString("choice");
    const bet = interaction.options.getInteger("bet");
    const userData = ensureUserData(guild.id, interaction.user.id);

    if (userData.balance < bet) {
      return interaction.reply({
        content: "❌ No tienes suficientes monedas.",
        ephemeral: true,
      });
    }

    const result = Math.random() < 0.5 ? "cara" : "cruz";
    const won = result === choice;

    updateUserData(guild.id, interaction.user.id, (u) => {
      u.balance += won ? bet : -bet;
    });

    return interaction.reply({
      embeds: [
        bigEmbed({
          color: won ? 0x57f287 : 0xed4245,
          title: "🪙 Coinflip",
          description:
            `Elegiste **${choice}**\n` +
            `Salió **${result}**\n\n` +
            (won ? `Ganaste **${bet}** monedas.` : `Perdiste **${bet}** monedas.`),
          footer: `${guild.name} • Economy`,
        }),
      ],
      ephemeral: true,
    });
  }

  if (interaction.commandName === "rank") {
    const target = interaction.options.getUser("user") || interaction.user;
    const data = ensureUserData(guild.id, target.id);
    const nextLevelXp = (data.level + 1) * 100;

    return interaction.reply({
      embeds: [
        bigEmbed({
          color: 0x5865f2,
          title: "📈 Rank",
          description:
            `**Usuario:** ${target}\n` +
            `**Nivel:** ${data.level}\n` +
            `**XP:** ${data.xp}/${nextLevelXp}\n` +
            `**Monedas:** ${data.balance}`,
          footer: `${guild.name} • Levels`,
        }),
      ],
      ephemeral: true,
    });
  }

  if (interaction.commandName === "levels") {
    const enabled = interaction.options.getBoolean("enabled");

    updateGuildData(guild.id, (data) => {
      data.config.levelsEnabled = enabled;
    });

    return interaction.reply({
      content: `✅ Sistema de niveles ${enabled ? "activado" : "desactivado"}.`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "counting") {
    const sub = interaction.options.getSubcommand();

    if (sub === "set") {
      const channel = interaction.options.getChannel("channel");

      updateGuildData(guild.id, (data) => {
        data.config.countingChannelId = channel.id;
        data.config.countingCurrent = 1;
        data.config.countingLastUserId = null;
      });

      return interaction.reply({
        content: `✅ Canal de conteo configurado en ${channel}`,
        ephemeral: true,
      });
    }

    if (sub === "reset") {
      updateGuildData(guild.id, (data) => {
        data.config.countingCurrent = 1;
        data.config.countingLastUserId = null;
      });

      return interaction.reply({
        content: "✅ Conteo reiniciado a 1.",
        ephemeral: true,
      });
    }
  }
}

async function handleButton(interaction) {
  const guild = interaction.guild;
  if (!guild) return;

  if (interaction.customId === "ticket:create") {
    const config = getGuildConfig(guild.id);

    if (!config.ticketCategoryId) {
      return interaction.reply({
        content: "❌ No hay categoría de tickets configurada.",
        ephemeral: true,
      });
    }

    const alreadyOpen = guild.channels.cache.find(
      (c) =>
        c.parentId === config.ticketCategoryId &&
        c.name === `ticket-${interaction.user.id}`
    );

    if (alreadyOpen) {
      return interaction.reply({
        content: `❌ Ya tienes un ticket abierto: ${alreadyOpen}`,
        ephemeral: true,
      });
    }

    const overwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
    ];

    const staffRoleIds = getGuildConfig(guild.id).staffRoleIds || [];
    for (const roleId of staffRoleIds) {
      overwrites.push({
        id: roleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      });
    }

    const channel = await guild.channels.create({
      name: `ticket-${interaction.user.id}`,
      type: ChannelType.GuildText,
      parent: config.ticketCategoryId,
      permissionOverwrites: overwrites,
      topic: `Ticket de ${interaction.user.tag}`,
      reason: "Ticket creado automáticamente",
    });

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket:close")
        .setLabel("Cerrar Ticket")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `${interaction.user}`,
      embeds: [
        bigEmbed({
          color: 0x5865f2,
          title: "🎫 Ticket abierto",
          description:
            `Hola ${interaction.user}\n\n` +
            `Tu ticket fue creado correctamente.\n` +
            `Explica tu problema y el staff te responderá.\n\n` +
            `🔒 Este canal es privado.`,
          footer: `${guild.name} • Ticket`,
        }),
      ],
      components: [closeRow],
    });

    updateGuildData(guild.id, (data) => {
      data.tickets[channel.id] = {
        ownerId: interaction.user.id,
        createdAt: Date.now(),
      };
    });

    await interaction.reply({
      content: `✅ Ticket creado: ${channel}`,
      ephemeral: true,
    });

    await logAction(
      guild,
      `🎫 **Ticket creado** por <@${interaction.user.id}> en ${channel}`,
      0x5865f2
    );
    return;
  }

  if (interaction.customId === "ticket:close") {
    await interaction.reply({
      content: "🔒 Cerrando ticket en 3 segundos...",
      ephemeral: true,
    });

    updateGuildData(guild.id, (data) => {
      delete data.tickets[interaction.channel.id];
    });

    await logAction(
      guild,
      `🔒 **Ticket cerrado** por <@${interaction.user.id}> en ${interaction.channel}`,
      0xed4245
    );

    setTimeout(async () => {
      try {
        await interaction.channel.delete("Ticket cerrado");
      } catch {}
    }, 3000);
    return;
  }

  if (interaction.customId.startsWith("rolebtn:")) {
    const roleId = interaction.customId.split(":")[1];
    const role = guild.roles.cache.get(roleId);

    if (!role) {
      return interaction.reply({
        content: "❌ Ese rol ya no existe.",
        ephemeral: true,
      });
    }

    const member = await guild.members.fetch(interaction.user.id);

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      return interaction.reply({
        content: `✅ Se te quitó el rol ${role}.`,
        ephemeral: true,
      });
    } else {
      await member.roles.add(roleId);
      return interaction.reply({
        content: `✅ Se te dio el rol ${role}.`,
        ephemeral: true,
      });
    }
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Bot conectado como ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    ensureGuildData(guild.id);
    await guild.members.fetch().catch(() => null);
    await updateStatsForGuild(guild);
  }

  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await guild.members.fetch().catch(() => null);
      await updateStatsForGuild(guild);
    }
  }, 60 * 1000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlash(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (error) {
    console.error("Error en interacción:", error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "❌ Ocurrió un error ejecutando esa acción.",
        ephemeral: true,
      }).catch(() => null);
    } else {
      await interaction.reply({
        content: "❌ Ocurrió un error ejecutando esa acción.",
        ephemeral: true,
      }).catch(() => null);
    }
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  const config = getGuildConfig(member.guild.id);

  if (config.autoRoleId) {
    try {
      await member.roles.add(config.autoRoleId);
    } catch (error) {
      console.error("Error dando autorol:", error.message);
    }
  }

  if (config.welcomeChannelId) {
    const channel = member.guild.channels.cache.get(config.welcomeChannelId);
    if (channel && channel.isTextBased()) {
      await safeSend(channel, {
        embeds: [
          bigEmbed({
            color: 0x57f287,
            title: "👋 Nuevo miembro",
            description:
              `Bienvenido ${member} a **${member.guild.name}**\n\n` +
              `Revisa las reglas, elige tus roles y disfruta la comunidad.\n\n` +
              `✨ Esperamos que la pases bien aquí.`,
            thumbnail: member.user.displayAvatarURL({ forceStatic: false }),
            footer: `${member.guild.name} • Welcome`,
          }),
        ],
      });
    }
  }

  await logAction(
    member.guild,
    `👋 Entró un nuevo miembro: <@${member.id}>`,
    0x57f287
  );
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;

  const config = getGuildConfig(message.guild.id);

  if (config.countingChannelId && message.channel.id === config.countingChannelId) {
    const expected = config.countingCurrent;
    const value = Number(message.content.trim());

    if (
      !Number.isInteger(value) ||
      value !== expected ||
      config.countingLastUserId === message.author.id
    ) {
      await message.react("❌").catch(() => null);
      await message.delete().catch(() => null);
      return;
    }

    await message.react("✅").catch(() => null);
    updateGuildData(message.guild.id, (data) => {
      data.config.countingCurrent += 1;
      data.config.countingLastUserId = message.author.id;
    });
  }

  if (!config.levelsEnabled) return;

  const now = Date.now();
  const user = ensureUserData(message.guild.id, message.author.id);
  if (now - user.lastXpAt < 60000) return;

  const gained = Math.floor(Math.random() * 11) + 15;
  let leveledUp = false;
  let newLevel = user.level;

  updateUserData(message.guild.id, message.author.id, (u) => {
    u.lastXpAt = now;
    u.xp += gained;

    const needed = (u.level + 1) * 100;
    if (u.xp >= needed) {
      u.xp -= needed;
      u.level += 1;
      u.balance += 100;
      leveledUp = true;
      newLevel = u.level;
    }
  });

  if (leveledUp) {
    await message.reply(
      `🎉 ${message.author}, subiste a **nivel ${newLevel}** y ganaste **100 monedas**.`
    ).catch(() => null);
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const config = getGuildConfig(guild.id);
  const createChannelId = config.tempVoiceCreateChannelId;
  const tempCategoryId = config.tempVoiceCategoryId;

  if (createChannelId && newState.channelId === createChannelId && newState.member) {
    const channel = await guild.channels.create({
      name: `🔊 ${newState.member.user.username}`,
      type: ChannelType.GuildVoice,
      parent: tempCategoryId || null,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak,
          ],
        },
        {
          id: newState.member.id,
          allow: [
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.MoveMembers,
            PermissionsBitField.Flags.MuteMembers,
            PermissionsBitField.Flags.DeafenMembers,
          ],
        },
      ],
      reason: "Temp voice automático",
    });

    updateGuildData(guild.id, (data) => {
      data.tempVoices[channel.id] = {
        ownerId: newState.member.id,
        createdAt: Date.now(),
      };
    });

    await newState.setChannel(channel).catch(() => null);
  }

  if (
    oldState.channel &&
    oldState.channel.parentId === tempCategoryId &&
    oldState.channel.members.size === 0
  ) {
    const store = readStore();
    const guildData = store.guilds[guild.id];

    if (
      guildData &&
      guildData.tempVoices &&
      guildData.tempVoices[oldState.channel.id]
    ) {
      try {
        delete guildData.tempVoices[oldState.channel.id];
        writeStore(store);
        await oldState.channel.delete("Temp voice vacío");
      } catch (error) {
        console.error("Error borrando temp voice:", error.message);
      }
    }
  }
});

(async () => {
  if (!process.env.TOKEN || !process.env.CLIENT_ID) {
    console.error("Faltan TOKEN o CLIENT_ID en .env");
    process.exit(1);
  }

  await registerCommands();
  await client.login(process.env.TOKEN);
})();
const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("StreamBoost Bot Online");
});

app.listen(PORT, () => {
  console.log("Web server running on port " + PORT);
});
