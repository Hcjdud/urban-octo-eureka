const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const config = require('./config.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

// Оптимизированное хранилище данных
const antiRaid = {
    enabled: new Map(),
    settings: new Map(), // guildId -> { joinThreshold, joinWindow, roleThreshold, roleWindow, channelThreshold, channelWindow }
    joinCache: new Map(),
    actionCache: new Map(), // guildId -> Map<userId, {roles: [], channels: [], timestamp}>
    backups: new Map()
};

// Загрузка команд
client.commands = new Map();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.name, command);
}

client.once('ready', () => {
    console.log(`Бот ${client.user.tag} успешно запущен`);
    client.user.setActivity('!antiraid help', { type: 3 });
});

// Обработка команд
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith(config.prefix) || message.author.bot) return;

    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    if (!client.commands.has(commandName)) return;

    const command = client.commands.get(commandName);

    try {
        await command.execute(message, args, client, antiRaid);
    } catch (error) {
        console.error(`Ошибка в команде ${commandName}:`, error);
        await message.reply('Произошла ошибка при выполнении команды');
    }
});

// Оптимизированная проверка новых участников
client.on('guildMemberAdd', async (member) => {
    const guildId = member.guild.id;
    if (!antiRaid.enabled.get(guildId)) return;

    const settings = antiRaid.settings.get(guildId) || {
        joinThreshold: 5,
        joinWindow: 10
    };

    const now = Date.now();
    
    if (!antiRaid.joinCache.has(guildId)) {
        antiRaid.joinCache.set(guildId, []);
    }

    const joinCache = antiRaid.joinCache.get(guildId);
    joinCache.push({ userId: member.id, timestamp: now });

    // Очистка старых записей
    const filtered = joinCache.filter(entry => now - entry.timestamp < settings.joinWindow * 1000);
    antiRaid.joinCache.set(guildId, filtered);

    if (filtered.length >= settings.joinThreshold) {
        await handleMassJoin(member.guild);
    }
});

// Оптимизированная проверка действий с ролями
client.on('guildRoleCreate', async (role) => {
    await checkAction(role.guild, 'role', 'create');
});

client.on('guildRoleDelete', async (role) => {
    await checkAction(role.guild, 'role', 'delete');
});

client.on('guildRoleUpdate', async (oldRole, newRole) => {
    await checkAction(newRole.guild, 'role', 'update');
});

client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    await checkAction(channel.guild, 'channel', 'create');
});

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    await checkAction(channel.guild, 'channel', 'delete');
});

// Универсальная функция проверки действий
async function checkAction(guild, type, action) {
    const guildId = guild.id;
    if (!antiRaid.enabled.get(guildId)) return;

    const settings = antiRaid.settings.get(guildId) || {
        roleThreshold: 3,
        roleWindow: 5,
        channelThreshold: 3,
        channelWindow: 5
    };

    try {
        const auditLogs = await guild.fetchAuditLogs({ 
            limit: 1, 
            type: getAuditType(type, action) 
        });
        
        const log = auditLogs.entries.first();
        if (!log || log.executor.bot) return;

        const now = Date.now();
        const threshold = type === 'role' ? settings.roleThreshold : settings.channelThreshold;
        const timeWindow = type === 'role' ? settings.roleWindow : settings.channelWindow;

        if (!antiRaid.actionCache.has(guildId)) {
            antiRaid.actionCache.set(guildId, new Map());
        }

        const userCache = antiRaid.actionCache.get(guildId);
        if (!userCache.has(log.executor.id)) {
            userCache.set(log.executor.id, { roles: [], channels: [], timestamp: now });
        }

        const userActions = userCache.get(log.executor.id);
        const actionArray = type === 'role' ? userActions.roles : userActions.channels;
        
        actionArray.push({ timestamp: now, action });
        
        // Очистка старых записей
        const filtered = actionArray.filter(a => now - a.timestamp < timeWindow * 1000);
        if (type === 'role') {
            userActions.roles = filtered;
        } else {
            userActions.channels = filtered;
        }

        if (filtered.length >= threshold) {
            await handleRaid(guild, log.executor, type);
        }

    } catch (error) {
        console.error(`Ошибка проверки действия:`, error);
    }
}

// Обработка массовых заходов
async function handleMassJoin(guild) {
    try {
        // Включаем максимальную проверку
        await guild.setVerificationLevel(3);
        
        // Баним подозрительных ботов (аккаунты младше 1 дня)
        const members = await guild.members.fetch();
        const now = Date.now();
        
        for (const [_, member] of members) {
            if (member.user.bot) continue;
            
            const accountAge = now - member.user.createdTimestamp;
            const oneDay = 24 * 60 * 60 * 1000;
            
            if (accountAge < oneDay && !member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                try {
                    await member.ban({ reason: 'Подозрение на рейд (аккаунт младше 1 дня)' });
                } catch (e) {
                    // Игнорируем ошибки бана
                }
            }
        }
        
    } catch (error) {
        console.error('Ошибка обработки массового захода:', error);
    }
}

// Обработка рейда
async function handleRaid(guild, executor, type) {
    try {
        // Баним нарушителя
        await guild.members.ban(executor.id, { 
            reason: `${type === 'role' ? 'Ролевой' : 'Канальный'} рейд` 
        });
        
    } catch (error) {
        console.error('Ошибка обработки рейда:', error);
    }
}

// Получение типа аудит лога
function getAuditType(type, action) {
    const types = {
        role: { create: 30, delete: 32, update: 31 },
        channel: { create: 10, delete: 12 }
    };
    return types[type]?.[action] || null;
}

// Создание бэкапа
async function createBackup(guild) {
    try {
        const backup = {
            id: `${guild.id}_${Date.now()}`,
            name: guild.name,
            timestamp: Date.now(),
            roles: [],
            channels: []
        };

        // Сохраняем роли
        guild.roles.cache.forEach(role => {
            if (role.name !== '@everyone') {
                backup.roles.push({
                    name: role.name,
                    color: role.color,
                    hoist: role.hoist,
                    permissions: role.permissions.bitfield.toString(),
                    position: role.position
                });
            }
        });

        // Сохраняем каналы
        guild.channels.cache.forEach(channel => {
            backup.channels.push({
                name: channel.name,
                type: channel.type,
                position: channel.position,
                parentId: channel.parentId
            });
        });

        // Сохраняем в память
        antiRaid.backups.set(guild.id, backup);

        // Сохраняем в файл
        if (!fs.existsSync('./backups')) {
            fs.mkdirSync('./backups');
        }
        
        fs.writeFileSync(`./backups/${backup.id}.json`, JSON.stringify(backup));

        return backup;
    } catch (error) {
        console.error('Ошибка создания бэкапа:', error);
        return null;
    }
}

// Восстановление из бэкапа
async function restoreFromBackup(guild, backupData) {
    try {
        // Удаляем все каналы
        for (const [_, channel] of guild.channels.cache) {
            try {
                await channel.delete('Восстановление из бэкапа');
            } catch (e) {
                // Игнорируем ошибки
            }
        }

        // Удаляем все роли кроме @everyone
        for (const [_, role] of guild.roles.cache) {
            if (role.name !== '@everyone') {
                try {
                    await role.delete('Восстановление из бэкапа');
                } catch (e) {
                    // Игнорируем ошибки
                }
            }
        }

        // Восстанавливаем роли
        for (const roleData of backupData.roles) {
            try {
                await guild.roles.create({
                    name: roleData.name,
                    color: roleData.color,
                    hoist: roleData.hoist,
                    permissions: BigInt(roleData.permissions),
                    reason: 'Восстановление из бэкапа'
                });
            } catch (e) {
                // Игнорируем ошибки
            }
        }

        // Восстанавливаем каналы
        for (const channelData of backupData.channels) {
            try {
                await guild.channels.create({
                    name: channelData.name,
                    type: channelData.type,
                    reason: 'Восстановление из бэкапа'
                });
            } catch (e) {
                // Игнорируем ошибки
            }
        }

        return true;
    } catch (error) {
        console.error('Ошибка восстановления:', error);
        return false;
    }
}

client.login(config.token);
