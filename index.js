const { Client, GatewayIntentBits, PermissionsBitField, REST, Routes, SlashCommandBuilder, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Collection } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ============================================
// ВЕБ-СЕРВЕР ДЛЯ RAILWAY
// ============================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Anti-Raid Discord Bot is running on Railway 24/7!');
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Веб-сервер запущен на порту ${PORT}`);
});

// ============================================
// КОНФИГУРАЦИЯ
// ============================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PREFIX = '!';

if (!BOT_TOKEN) {
    console.error('❌ ОШИБКА: BOT_TOKEN не найден!');
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error('❌ ОШИБКА: CLIENT_ID не найден!');
    process.exit(1);
}

// ============================================
// СОЗДАНИЕ DISCORD КЛИЕНТА
// ============================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// ============================================
// ХРАНИЛИЩЕ ДАННЫХ
// ============================================
const antiRaid = {
    enabled: new Collection(),
    settings: new Collection(),
    joinCache: new Collection(),
    actionCache: new Collection(),
    backups: new Collection(),
    verification: {
        enabled: new Collection(),
        roleId: new Collection(),
        channelId: new Collection(),
        type: new Collection(), // 'button' или 'captcha'
        pendingUsers: new Collection(),
        logChannel: new Collection(),
        captchaCodes: new Collection() // Для хранения капч
    },
    stats: {
        bans: 0,
        raidsDetected: 0,
        joinsTracked: 0,
        verifiedUsers: 0,
        startTime: Date.now()
    }
};

// ============================================
// ЗАГРУЗКА КОМАНД
// ============================================
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');

if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath, { recursive: true });
}

try {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        try {
            const command = require(`./commands/${file}`);
            client.commands.set(command.name, command);
            console.log(`✅ Загружена команда: ${command.name}`);
        } catch (e) {
            console.error(`❌ Ошибка загрузки команды ${file}:`, e.message);
        }
    }
} catch (error) {
    console.error('❌ Ошибка при загрузке команд:', error.message);
}

// ============================================
// ФУНКЦИЯ ГЕНЕРАЦИИ КАПЧИ
// ============================================
function generateCaptcha() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let captcha = '';
    for (let i = 0; i < 6; i++) {
        captcha += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return captcha;
}

// ============================================
// ФУНКЦИЯ ЛОГИРОВАНИЯ
// ============================================
async function logToChannel(guild, type, user, moderator = null, reason = null) {
    try {
        const logChannelId = antiRaid.verification.logChannel.get(guild.id);
        if (!logChannelId) return;
        
        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (!logChannel) return;
        
        const embed = new EmbedBuilder()
            .setColor(type === 'success' ? '#00ff00' : type === 'fail' ? '#ff0000' : '#ffa500')
            .setTitle(`✅ Верификация - ${type === 'success' ? 'Успех' : type === 'fail' ? 'Неудача' : 'Инфо'}`)
            .setTimestamp()
            .addFields(
                { name: 'Пользователь', value: `${user.tag} (${user.id})`, inline: true }
            );
        
        if (moderator) {
            embed.addFields({ name: 'Модератор', value: `${moderator.tag} (${moderator.id})`, inline: true });
        }
        
        if (reason) {
            embed.addFields({ name: 'Причина', value: reason, inline: false });
        }
        
        await logChannel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Ошибка при логировании:', error);
    }
}

// ============================================
// ОПРЕДЕЛЕНИЕ СЛЕШ-КОМАНД
// ============================================
const slashCommands = [
    // АНТИ-РЕЙД КОМАНДЫ
    new SlashCommandBuilder()
        .setName('antiraid')
        .setDescription('🛡️ Управление анти-рейд защитой')
        .addSubcommand(sub => 
            sub.setName('on')
                .setDescription('Включить анти-рейд защиту'))
        .addSubcommand(sub => 
            sub.setName('off')
                .setDescription('Выключить анти-рейд защиту'))
        .addSubcommand(sub => 
            sub.setName('status')
                .setDescription('Показать статус защиты'))
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('Настроить параметры защиты')
                .addStringOption(opt =>
                    opt.setName('type')
                        .setDescription('Тип параметра')
                        .setRequired(true)
                        .addChoices(
                            { name: '👥 Массовые заходы', value: 'joins' },
                            { name: '👑 Действия с ролями', value: 'roles' },
                            { name: '📺 Действия с каналами', value: 'channels' }
                        ))
                .addIntegerOption(opt =>
                    opt.setName('threshold')
                        .setDescription('Пороговое значение (1-50)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(50))
                .addIntegerOption(opt =>
                    opt.setName('window')
                        .setDescription('Временное окно (1-300 сек)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(300))),

    // КОМАНДЫ ВЕРИФИКАЦИИ
    new SlashCommandBuilder()
        .setName('verify')
        .setDescription('✅ Управление системой верификации')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Настроить систему верификации')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Канал для верификации')
                        .setRequired(true))
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('Роль после верификации')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('type')
                        .setDescription('Тип верификации')
                        .setRequired(true)
                        .addChoices(
                            { name: '🔘 Кнопка', value: 'button' },
                            { name: '🔐 Капча', value: 'captcha' }
                        )))
        .addSubcommand(sub =>
            sub.setName('disable')
                .setDescription('Отключить систему верификации'))
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('Показать статус верификации'))
        .addSubcommand(sub =>
            sub.setName('check')
                .setDescription('Проверить верификацию пользователя')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('Пользователь для проверки')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('log')
                .setDescription('Настроить канал для логов')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Канал для логов')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('reset')
                .setDescription('Сбросить верификацию для пользователя')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('Пользователь')
                        .setRequired(true))),

    // КОМАНДЫ БЭКАПОВ
    new SlashCommandBuilder()
        .setName('backup')
        .setDescription('💾 Управление бэкапами сервера')
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Создать бэкап сервера'))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('Список бэкапов'))
        .addSubcommand(sub =>
            sub.setName('restore')
                .setDescription('Восстановить из бэкапа')
                .addStringOption(opt =>
                    opt.setName('backup_id')
                        .setDescription('ID бэкапа (оставьте пустым для последнего)')
                        .setRequired(false))),

    // КОМАНДЫ МОДЕРАЦИИ
    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('👢 Кикнуть пользователя')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Пользователь')
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('reason')
                .setDescription('Причина')
                .setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('🧹 Очистить сообщения')
        .addIntegerOption(opt =>
            opt.setName('amount')
                .setDescription('Количество (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)),

    // СЛУЖЕБНЫЕ КОМАНДЫ
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('🏓 Проверка связи'),
    
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('📊 Статистика бота'),
    
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('📋 Список команд')
];

// ============================================
// РЕГИСТРАЦИЯ СЛЕШ-КОМАНД
// ============================================
async function registerSlashCommands() {
    try {
        console.log('🔄 Регистрация слеш-команд...');
        const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

        if (GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
                { body: slashCommands }
            );
            console.log(`✅ Слеш-команды зарегистрированы на сервере ${GUILD_ID}`);
        } else {
            await rest.put(
                Routes.applicationCommands(CLIENT_ID),
                { body: slashCommands }
            );
            console.log('✅ Слеш-команды зарегистрированы глобально');
        }
    } catch (error) {
        console.error('❌ Ошибка регистрации слеш-команд:', error);
    }
}

// ============================================
// ФУНКЦИЯ ПОДДЕРЖАНИЯ СТАТУСА
// ============================================
function keepBotOnline() {
    client.user.setStatus('online');
    
    const activities = [
        { name: 'за сервером', type: ActivityType.Watching },
        { name: 'анти-рейд защиту', type: ActivityType.Playing },
        { name: `${client.guilds.cache.size} серверов`, type: ActivityType.Watching },
        { name: 'верификацию', type: ActivityType.Playing },
        { name: '/help', type: ActivityType.Listening }
    ];
    
    let index = 0;
    
    setInterval(() => {
        try {
            client.user.setStatus('online');
            client.user.setActivity(activities[index].name, { 
                type: activities[index].type 
            });
            index = (index + 1) % activities.length;
        } catch (error) {
            console.error('Ошибка при обновлении статуса:', error);
        }
    }, 30000);
    
    setInterval(() => {
        try {
            const ping = client.ws.ping;
            console.log(`🏓 Пинг: ${ping}ms | Серверов: ${client.guilds.cache.size}`);
        } catch (error) {
            console.error('Ошибка при пинге:', error);
        }
    }, 300000);
}

// ============================================
// ОБРАБОТКА НОВЫХ УЧАСТНИКОВ (ВЕРИФИКАЦИЯ)
// ============================================
client.on('guildMemberAdd', async (member) => {
    const guildId = member.guild.id;
    
    // Анти-рейд защита (отслеживание массовых заходов) [citation:7]
    if (antiRaid.enabled.get(guildId)) {
        antiRaid.stats.joinsTracked++;

        const settings = antiRaid.settings.get(guildId) || { joinThreshold: 5, joinWindow: 10 };
        const now = Date.now();
        
        if (!antiRaid.joinCache.has(guildId)) {
            antiRaid.joinCache.set(guildId, []);
        }

        const joinCache = antiRaid.joinCache.get(guildId);
        joinCache.push({ userId: member.id, timestamp: now });

        const filtered = joinCache.filter(entry => now - entry.timestamp < settings.joinWindow * 1000);
        antiRaid.joinCache.set(guildId, filtered);

        if (filtered.length >= settings.joinThreshold) {
            antiRaid.stats.raidsDetected++;
            console.log(`🚨 МАССОВЫЙ ЗАХОД на ${member.guild.name} (${filtered.length} за ${settings.joinWindow} сек)`);
            
            try {
                await member.guild.setVerificationLevel(3); // Повышаем уровень проверки [citation:10]
                
                // Баним подозрительные аккаунты (младше 1 дня)
                const oneDay = 24 * 60 * 60 * 1000;
                const accountAge = now - member.user.createdTimestamp;
                if (accountAge < oneDay) {
                    await member.ban({ reason: 'Анти-рейд: подозрительный аккаунт (младше 1 дня)' });
                    antiRaid.stats.bans++;
                }
            } catch (error) {
                console.error('Ошибка при защите:', error.message);
            }
        }
    }
    
    // Верификация [citation:3][citation:6]
    if (antiRaid.verification.enabled.get(guildId)) {
        const verifyChannelId = antiRaid.verification.channelId.get(guildId);
        const verifyRoleId = antiRaid.verification.roleId.get(guildId);
        const verifyType = antiRaid.verification.type.get(guildId) || 'button';
        
        if (!verifyChannelId || !verifyRoleId) return;
        
        const verifyChannel = await member.guild.channels.fetch(verifyChannelId).catch(() => null);
        if (!verifyChannel) return;
        
        // Проверяем, не верифицирован ли уже пользователь
        const verifyRole = member.guild.roles.cache.get(verifyRoleId);
        if (verifyRole && member.roles.cache.has(verifyRoleId)) return;
        
        if (verifyType === 'button') {
            // Кнопочная верификация [citation:3]
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`verify_${member.id}`)
                        .setLabel('✅ Пройти верификацию')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅')
                );
            
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('✅ Верификация')
                .setDescription(`${member.user}, добро пожаловать на сервер!\n\nНажмите на кнопку ниже, чтобы пройти верификацию и получить доступ.`)
                .setFooter({ text: 'Anti-Raid Bot' })
                .setTimestamp();
            
            await verifyChannel.send({ 
                content: `${member.user}`, 
                embeds: [embed], 
                components: [row] 
            });
            
            // Сохраняем в ожидающих
            if (!antiRaid.verification.pendingUsers.has(guildId)) {
                antiRaid.verification.pendingUsers.set(guildId, new Collection());
            }
            const pending = antiRaid.verification.pendingUsers.get(guildId);
            pending.set(member.id, {
                userId: member.id,
                joinedAt: Date.now(),
                verified: false,
                type: 'button'
            });
            
        } else if (verifyType === 'captcha') {
            // Капча верификация [citation:3]
            const captcha = generateCaptcha();
            
            // Сохраняем капчу
            if (!antiRaid.verification.captchaCodes.has(guildId)) {
                antiRaid.verification.captchaCodes.set(guildId, new Collection());
            }
            const captchas = antiRaid.verification.captchaCodes.get(guildId);
            captchas.set(member.id, {
                code: captcha,
                attempts: 0,
                expires: Date.now() + 5 * 60 * 1000 // 5 минут
            });
            
            // Сохраняем в ожидающих
            if (!antiRaid.verification.pendingUsers.has(guildId)) {
                antiRaid.verification.pendingUsers.set(guildId, new Collection());
            }
            const pending = antiRaid.verification.pendingUsers.get(guildId);
            pending.set(member.id, {
                userId: member.id,
                joinedAt: Date.now(),
                verified: false,
                type: 'captcha'
            });
            
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🔐 Верификация по капче')
                .setDescription(`${member.user}, добро пожаловать на сервер!\n\nДля верификации введите код ниже в этом канале:\n\`\`\`${captcha}\`\`\`\n*Код действителен 5 минут. У вас есть 3 попытки.*`)
                .setFooter({ text: 'Anti-Raid Bot' })
                .setTimestamp();
            
            await verifyChannel.send({ content: `${member.user}`, embeds: [embed] });
        }
    }
});

// ============================================
// ОБРАБОТКА НАЖАТИЙ КНОПОК
// ============================================
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        const [action, userId] = interaction.customId.split('_');
        
        if (action === 'verify' && userId === interaction.user.id) {
            const guildId = interaction.guild.id;
            
            // Проверяем включена ли верификация
            if (!antiRaid.verification.enabled.get(guildId)) {
                return interaction.reply({ 
                    content: '❌ Система верификации отключена на этом сервере.', 
                    ephemeral: true 
                });
            }
            
            const roleId = antiRaid.verification.roleId.get(guildId);
            if (!roleId) {
                return interaction.reply({ 
                    content: '❌ Роль для верификации не настроена.', 
                    ephemeral: true 
                });
            }
            
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) {
                return interaction.reply({ 
                    content: '❌ Роль для верификации не найдена.', 
                    ephemeral: true 
                });
            }
            
            try {
                await interaction.member.roles.add(role);
                
                // Удаляем из ожидающих
                const pending = antiRaid.verification.pendingUsers.get(guildId);
                if (pending) {
                    pending.delete(interaction.user.id);
                }
                
                antiRaid.stats.verifiedUsers++;
                
                await logToChannel(interaction.guild, 'success', interaction.user);
                
                await interaction.reply({ 
                    content: '✅ **Верификация пройдена успешно!** Теперь у вас есть доступ к серверу.', 
                    ephemeral: true 
                });
                
                // Удаляем сообщение с кнопкой
                await interaction.message.delete().catch(() => {});
                
            } catch (error) {
                console.error('Ошибка при выдаче роли:', error);
                await interaction.reply({ 
                    content: '❌ Произошла ошибка при верификации. Обратитесь к администратору.', 
                    ephemeral: true 
                });
            }
        }
    }
    
    if (!interaction.isCommand()) return;

    const { commandName, options, guild, member, user, channel } = interaction;

    // Проверка прав для админ-команд
    const adminCommands = ['antiraid', 'backup', 'verify', 'kick', 'clear'];
    if (adminCommands.includes(commandName)) {
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ 
                content: '❌ У вас нет прав администратора для этой команды', 
                ephemeral: true 
            });
        }
    }

    // ===== КОМАНДА /HELP =====
    if (commandName === 'help') {
        const helpText = 
            '# 📋 ANTI-RAID BOT - ВСЕ КОМАНДЫ\n\n' +
            '## 🛡️ **Анти-рейд защита**\n' +
            '• `/antiraid on` - Включить защиту\n' +
            '• `/antiraid off` - Выключить защиту\n' +
            '• `/antiraid status` - Статус защиты\n' +
            '• `/antiraid set` - Настройка параметров\n\n' +
            '## ✅ **Верификация**\n' +
            '• `/verify setup` - Настроить верификацию\n' +
            '• `/verify disable` - Отключить верификацию\n' +
            '• `/verify status` - Статус верификации\n' +
            '• `/verify check` - Проверить пользователя\n' +
            '• `/verify log` - Настроить канал логов\n' +
            '• `/verify reset` - Сбросить верификацию\n\n' +
            '## 💾 **Бэкапы**\n' +
            '• `/backup create` - Создать бэкап\n' +
            '• `/backup list` - Список бэкапов\n' +
            '• `/backup restore` - Восстановить\n\n' +
            '## ⚙️ **Модерация**\n' +
            '• `/kick` - Кикнуть пользователя\n' +
            '• `/clear` - Очистить сообщения\n\n' +
            '## 📊 **Служебные**\n' +
            '• `/ping` - Проверка связи\n' +
            '• `/stats` - Статистика бота\n' +
            '• `/help` - Это сообщение\n\n' +
            '**📞 Поддержка:** https://discord.gg/ваш-сервер';
        
        return interaction.reply(helpText);
    }

    // ===== КОМАНДА /PING =====
    if (commandName === 'ping') {
        const latency = Date.now() - interaction.createdTimestamp;
        const apiLatency = client.ws.ping;
        return interaction.reply(
            `🏓 **Понг!** Бот работает 24/7 на Railway\n` +
            `⏱️ Задержка бота: ${latency}ms\n` +
            `📡 Задержка API: ${apiLatency}ms`
        );
    }

    // ===== КОМАНДА /STATS =====
    if (commandName === 'stats') {
        const uptime = Math.floor((Date.now() - antiRaid.stats.startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        
        return interaction.reply(
            `📊 **Статистика бота**\n\n` +
            `🕐 **Аптайм:** ${hours}ч ${minutes}м\n` +
            `🛡️ **Серверов:** ${client.guilds.cache.size}\n` +
            `👥 **Пользователей:** ${client.users.cache.size}\n` +
            `🚨 **Рейдов обнаружено:** ${antiRaid.stats.raidsDetected}\n` +
            `🔨 **Нарушителей забанено:** ${antiRaid.stats.bans}\n` +
            `✅ **Верифицировано:** ${antiRaid.stats.verifiedUsers}\n` +
            `👀 **Заходов отслежено:** ${antiRaid.stats.joinsTracked}`
        );
    }

    // ===== КОМАНДА /KICK =====
    if (commandName === 'kick') {
        const targetUser = options.getUser('user');
        const reason = options.getString('reason') || 'Не указана';
        
        const targetMember = await guild.members.fetch(targetUser.id);
        
        if (!targetMember.kickable) {
            return interaction.reply({ 
                content: '❌ Невозможно кикнуть этого пользователя', 
                ephemeral: true 
            });
        }
        
        try {
            await targetMember.kick(reason);
            await interaction.reply(`✅ **Пользователь ${targetUser.tag} кикнут**\nПричина: ${reason}`);
        } catch (error) {
            await interaction.reply({ 
                content: '❌ Ошибка при кике', 
                ephemeral: true 
            });
        }
    }

    // ===== КОМАНДА /CLEAR =====
    if (commandName === 'clear') {
        const amount = options.getInteger('amount');
        
        try {
            const messages = await channel.messages.fetch({ limit: amount });
            await channel.bulkDelete(messages);
            await interaction.reply({ 
                content: `✅ **Удалено ${messages.size} сообщений**`, 
                ephemeral: true 
            });
        } catch (error) {
            await interaction.reply({ 
                content: '❌ Ошибка при очистке', 
                ephemeral: true 
            });
        }
    }

    // ===== КОМАНДА /VERIFY =====
    if (commandName === 'verify') {
        const subcommand = options.getSubcommand();
        const guildId = guild.id;

        if (subcommand === 'setup') {
            const verifyChannel = options.getChannel('channel');
            const verifyRole = options.getRole('role');
            const verifyType = options.getString('type');

            if (verifyChannel.type !== 0) {
                return interaction.reply({ 
                    content: '❌ Канал должен быть текстовым!', 
                    ephemeral: true 
                });
            }

            antiRaid.verification.enabled.set(guildId, true);
            antiRaid.verification.channelId.set(guildId, verifyChannel.id);
            antiRaid.verification.roleId.set(guildId, verifyRole.id);
            antiRaid.verification.type.set(guildId, verifyType);

            const setupEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Система верификации настроена')
                .setDescription(`Система верификации успешно настроена!`)
                .addFields(
                    { name: '📝 Канал', value: `${verifyChannel}`, inline: true },
                    { name: '🎭 Роль', value: `${verifyRole}`, inline: true },
                    { name: '🔧 Тип', value: verifyType === 'button' ? '🔘 Кнопка' : '🔐 Капча', inline: true }
                )
                .setFooter({ text: 'Anti-Raid Bot' })
                .setTimestamp();

            await interaction.reply({ embeds: [setupEmbed] });

            // Отправляем приветственное сообщение в канал верификации
            if (verifyType === 'button') {
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('verify_test')
                            .setLabel('✅ Пример кнопки')
                            .setStyle(ButtonStyle.Success)
                            .setEmoji('✅')
                            .setDisabled(true)
                    );

                const testEmbed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('✅ Верификация настроена')
                    .setDescription(`Система верификации готова к работе!\nНовые участники будут получать роль ${verifyRole} после нажатия на кнопку.`)
                    .setFooter({ text: 'Anti-Raid Bot' });

                await verifyChannel.send({ embeds: [testEmbed], components: [row] });
            } else {
                const testEmbed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('🔐 Верификация настроена')
                    .setDescription(`Система верификации готова к работе!\nНовые участники будут получать роль ${verifyRole} после ввода правильного кода.`)
                    .setFooter({ text: 'Anti-Raid Bot' });

                await verifyChannel.send({ embeds: [testEmbed] });
            }

        } else if (subcommand === 'disable') {
            antiRaid.verification.enabled.set(guildId, false);
            antiRaid.verification.channelId.delete(guildId);
            antiRaid.verification.roleId.delete(guildId);
            antiRaid.verification.type.delete(guildId);
            antiRaid.verification.pendingUsers.delete(guildId);
            antiRaid.verification.captchaCodes.delete(guildId);

            await interaction.reply('✅ **Система верификации отключена**');

        } else if (subcommand === 'status') {
            const isEnabled = antiRaid.verification.enabled.get(guildId) || false;
            const channelId = antiRaid.verification.channelId.get(guildId);
            const roleId = antiRaid.verification.roleId.get(guildId);
            const verifyType = antiRaid.verification.type.get(guildId) || 'не настроен';
            
            const channel = channelId ? `<#${channelId}>` : 'не настроен';
            const role = roleId ? `<@&${roleId}>` : 'не настроен';
            
            const pending = antiRaid.verification.pendingUsers.get(guildId);
            const pendingCount = pending ? pending.size : 0;

            await interaction.reply(
                `## 📊 **Статус верификации**\n\n` +
                `**Статус:** ${isEnabled ? '✅ Включена' : '❌ Выключена'}\n` +
                `**Канал:** ${channel}\n` +
                `**Роль:** ${role}\n` +
                `**Тип:** ${verifyType}\n` +
                `**Ожидают:** ${pendingCount} пользователей\n`
            );

        } else if (subcommand === 'check') {
            const targetUser = options.getUser('user');
            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            
            if (!targetMember) {
                return interaction.reply({ 
                    content: '❌ Пользователь не найден на сервере', 
                    ephemeral: true 
                });
            }
            
            const roleId = antiRaid.verification.roleId.get(guildId);
            const hasRole = roleId ? targetMember.roles.cache.has(roleId) : false;
            
            const pending = antiRaid.verification.pendingUsers.get(guildId);
            const isPending = pending ? pending.has(targetUser.id) : false;
            
            await interaction.reply(
                `## ✅ **Проверка пользователя**\n\n` +
                `**Пользователь:** ${targetUser.tag}\n` +
                `**Статус:** ${hasRole ? '✅ Верифицирован' : '❌ Не верифицирован'}\n` +
                `**В ожидании:** ${isPending ? '✅ Да' : '❌ Нет'}\n`
            );

        } else if (subcommand === 'log') {
            const logChannel = options.getChannel('channel');
            
            if (logChannel.type !== 0) {
                return interaction.reply({ 
                    content: '❌ Канал должен быть текстовым!', 
                    ephemeral: true 
                });
            }
            
            antiRaid.verification.logChannel.set(guildId, logChannel.id);
            
            await interaction.reply(`✅ **Канал для логов установлен:** ${logChannel}`);
            
            const testEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Канал логов настроен')
                .setDescription(`Этот канал будет использоваться для логирования событий верификации.`)
                .setFooter({ text: 'Anti-Raid Bot' })
                .setTimestamp();
            
            await logChannel.send({ embeds: [testEmbed] });

        } else if (subcommand === 'reset') {
            const targetUser = options.getUser('user');
            
            // Удаляем из ожидающих
            const pending = antiRaid.verification.pendingUsers.get(guildId);
            if (pending) {
                pending.delete(targetUser.id);
            }
            
            // Удаляем капчу
            const captchas = antiRaid.verification.captchaCodes.get(guildId);
            if (captchas) {
                captchas.delete(targetUser.id);
            }
            
            await interaction.reply(`✅ **Верификация сброшена для пользователя ${targetUser.tag}**`);
        }
    }

    // ===== КОМАНДА /ANTIRAID =====
    if (commandName === 'antiraid') {
        const subcommand = options.getSubcommand();
        const guildId = guild.id;

        switch (subcommand) {
            case 'on':
                antiRaid.enabled.set(guildId, true);
                return interaction.reply('✅ **Анти-рейд защита включена**');

            case 'off':
                antiRaid.enabled.set(guildId, false);
                return interaction.reply('✅ **Анти-рейд защита выключена**');

            case 'status':
                const settings = antiRaid.settings.get(guildId) || {
                    joinThreshold: 5, joinWindow: 10,
                    roleThreshold: 3, roleWindow: 5,
                    channelThreshold: 3, channelWindow: 5
                };
                const status = antiRaid.enabled.get(guildId) ? '✅ Включена' : '❌ Выключена';
                
                return interaction.reply(
                    `## 📊 **Статус защиты сервера**\n\n` +
                    `**Общий статус:** ${status}\n\n` +
                    `### 👥 **Массовые заходы**\n` +
                    `Порог: ${settings.joinThreshold} за ${settings.joinWindow} сек\n` +
                    `*При превышении: повышение уровня проверки*\n\n` +
                    `### 👑 **Действия с ролями**\n` +
                    `Порог: ${settings.roleThreshold} за ${settings.roleWindow} сек\n` +
                    `*При превышении: автоматический бан*\n\n` +
                    `### 📺 **Действия с каналами**\n` +
                    `Порог: ${settings.channelThreshold} за ${settings.channelWindow} сек\n` +
                    `*При превышении: автоматический бан*`
                );

            case 'set':
                const type = options.getString('type');
                const threshold = options.getInteger('threshold');
                const window = options.getInteger('window');

                const newSettings = antiRaid.settings.get(guildId) || {};
                
                let typeName = '';
                if (type === 'joins') {
                    newSettings.joinThreshold = threshold;
                    newSettings.joinWindow = window;
                    typeName = 'массовых заходов';
                } else if (type === 'roles') {
                    newSettings.roleThreshold = threshold;
                    newSettings.roleWindow = window;
                    typeName = 'действий с ролями';
                } else if (type === 'channels') {
                    newSettings.channelThreshold = threshold;
                    newSettings.channelWindow = window;
                    typeName = 'действий с каналами';
                }
                
                antiRaid.settings.set(guildId, newSettings);
                return interaction.reply(`✅ **Параметр "${typeName}" установлен**\nПорог: ${threshold} за ${window} сек`);
        }
    }

    // ===== КОМАНДА /BACKUP =====
    if (commandName === 'backup') {
        const subcommand = options.getSubcommand();
        
        if (subcommand === 'create') {
            await interaction.reply('🔄 **Создание бэкапа...**');
            
            try {
                const backup = await createBackup(guild);
                await interaction.editReply(
                    `✅ **Бэкап успешно создан!**\n` +
                    `📁 ID: ${backup.id}\n` +
                    `👑 Ролей: ${backup.roles.length}\n` +
                    `📺 Каналов: ${backup.channels.length}`
                );
            } catch (error) {
                await interaction.editReply('❌ **Ошибка при создании бэкапа**');
            }
            
        } else if (subcommand === 'list') {
            try {
                const files = fs.readdirSync('./backups')
                    .filter(f => f.startsWith(guild.id))
                    .sort()
                    .reverse();
                
                if (files.length === 0) {
                    return interaction.reply('📭 **Нет доступных бэкапов**');
                }

                let response = '## 📋 **Список бэкапов**\n\n';
                files.slice(0, 5).forEach((file, index) => {
                    try {
                        const data = JSON.parse(fs.readFileSync(`./backups/${file}`));
                        const date = new Date(data.timestamp).toLocaleString();
                        response += `**#${index + 1}**\n`;
                        response += `ID: \`${data.id}\`\n`;
                        response += `Дата: ${date}\n`;
                        response += `Ролей: ${data.roles.length}, Каналов: ${data.channels.length}\n\n`;
                    } catch (e) {}
                });
                
                return interaction.reply(response);
            } catch (error) {
                return interaction.reply('❌ **Ошибка при получении списка**');
            }
            
        } else if (subcommand === 'restore') {
            const backupId = options.getString('backup_id');
            
            try {
                const owner = await guild.fetchOwner();
                
                await owner.send(
                    `## ⚠️ **Запрос на восстановление сервера**\n\n` +
                    `**Сервер:** ${guild.name}\n` +
                    `**Запросил:** ${user.tag}\n` +
                    `**Бэкап:** ${backupId || 'последний'}\n\n` +
                    `Для подтверждения напишите: \`!confirm restore\``
                );
                
                await interaction.reply({ 
                    content: '📬 **Запрос отправлен владельцу сервера**', 
                    ephemeral: true 
                });
            } catch (error) {
                return interaction.reply('❌ **Не удалось отправить запрос**');
            }
        }
    }
});

// ============================================
// ОБРАБОТКА СООБЩЕНИЙ (ДЛЯ КАПЧИ)
// ============================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const guildId = message.guild?.id;
    if (!guildId) return;
    
    // Проверка капчи [citation:3]
    if (antiRaid.verification.enabled.get(guildId)) {
        const verifyChannelId = antiRaid.verification.channelId.get(guildId);
        if (message.channel.id === verifyChannelId) {
            // Проверяем, есть ли пользователь в ожидающих
            const pending = antiRaid.verification.pendingUsers.get(guildId);
            if (pending && pending.has(message.author.id)) {
                const userData = pending.get(message.author.id);
                
                // Проверяем тип верификации
                if (userData.type === 'captcha') {
                    // Получаем капчу
                    const captchas = antiRaid.verification.captchaCodes.get(guildId);
                    if (!captchas || !captchas.has(message.author.id)) {
                        return;
                    }
                    
                    const captchaData = captchas.get(message.author.id);
                    
                    // Проверяем срок действия
                    if (Date.now() > captchaData.expires) {
                        pending.delete(message.author.id);
                        captchas.delete(message.author.id);
                        await message.reply('❌ Время для верификации истекло. Зайдите заново.').then(msg => {
                            setTimeout(() => msg.delete().catch(() => {}), 5000);
                        });
                        await message.delete().catch(() => {});
                        return;
                    }
                    
                    // Проверяем код
                    if (message.content === captchaData.code) {
                        // Успешная верификация
                        const roleId = antiRaid.verification.roleId.get(guildId);
                        if (roleId) {
                            const role = message.guild.roles.cache.get(roleId);
                            if (role) {
                                try {
                                    await message.member.roles.add(role);
                                    userData.verified = true;
                                    antiRaid.stats.verifiedUsers++;
                                    pending.delete(message.author.id);
                                    captchas.delete(message.author.id);
                                    
                                    await logToChannel(message.guild, 'success', message.author);
                                    
                                    await message.reply('✅ **Верификация пройдена успешно!**').then(msg => {
                                        setTimeout(() => msg.delete().catch(() => {}), 5000);
                                    });
                                    await message.delete().catch(() => {});
                                } catch (error) {
                                    await message.reply('❌ Ошибка при выдаче роли');
                                }
                            }
                        }
                    } else {
                        // Неверный код
                        captchaData.attempts++;
                        
                        if (captchaData.attempts >= 3) {
                            // Превышено количество попыток
                            pending.delete(message.author.id);
                            captchas.delete(message.author.id);
                            await message.reply('❌ Слишком много попыток. Зайдите заново.').then(msg => {
                                setTimeout(() => msg.delete().catch(() => {}), 5000);
                            });
                            
                            await logToChannel(message.guild, 'fail', message.author, null, 'Превышено количество попыток');
                        } else {
                            await message.reply(`❌ Неверный код. Осталось попыток: ${3 - captchaData.attempts}`).then(msg => {
                                setTimeout(() => msg.delete().catch(() => {}), 3000);
                            });
                        }
                        await message.delete().catch(() => {});
                    }
                }
            }
        }
    }
    
    // Префиксные команды
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    if (commandName === 'antiraid' && args[0] === 'help') {
        message.reply('Используйте `/help` для списка всех команд');
    }
    
    if (commandName === 'confirm' && args[0] === 'restore') {
        if (message.author.id !== message.guild.ownerId) {
            return message.reply('❌ Только владелец сервера может подтвердить восстановление');
        }
        message.reply('✅ Восстановление подтверждено! Функция в разработке.');
    }
});

// ============================================
// ЗАЩИТА ОТ ДЕЙСТВИЙ С РОЛЯМИ [citation:7]
// ============================================
client.on('guildRoleCreate', async (role) => {
    await checkRoleAction(role.guild, 'create');
});

client.on('guildRoleDelete', async (role) => {
    await checkRoleAction(role.guild, 'delete');
});

async function checkRoleAction(guild, action) {
    const guildId = guild.id;
    if (!antiRaid.enabled.get(guildId)) return;

    const settings = antiRaid.settings.get(guildId) || { roleThreshold: 3, roleWindow: 5 };

    try {
        const auditLogs = await guild.fetchAuditLogs({ 
            limit: 1, 
            type: action === 'create' ? 30 : 32 
        });
        
        const log = auditLogs.entries.first();
        if (!log || log.executor.bot) return;

        const now = Date.now();
        
        if (!antiRaid.actionCache.has(guildId)) {
            antiRaid.actionCache.set(guildId, new Collection());
        }

        const userCache = antiRaid.actionCache.get(guildId);
        if (!userCache.has(log.executor.id)) {
            userCache.set(log.executor.id, { roles: [], channels: [] });
        }

        const userActions = userCache.get(log.executor.id);
        userActions.roles.push({ timestamp: now, action });
        userActions.roles = userActions.roles.filter(a => now - a.timestamp < settings.roleWindow * 1000);

        if (userActions.roles.length >= settings.roleThreshold) {
            antiRaid.stats.raidsDetected++;
            console.log(`🚨 РОЛЕВОЙ РЕЙД от ${log.executor.tag} на ${guild.name}`);
            
            try {
                await guild.members.ban(log.executor.id, { 
                    reason: `Анти-рейд: ${userActions.roles.length} действий с ролями` 
                });
                antiRaid.stats.bans++;
            } catch (e) {
                console.error('Не удалось забанить:', e.message);
            }
        }
    } catch (error) {
        console.error('Ошибка проверки ролей:', error.message);
    }
}

// ============================================
// ЗАЩИТА ОТ ДЕЙСТВИЙ С КАНАЛАМИ
// ============================================
client.on('channelCreate', async (channel) => {
    if (channel.guild) await checkChannelAction(channel.guild, 'create');
});

client.on('channelDelete', async (channel) => {
    if (channel.guild) await checkChannelAction(channel.guild, 'delete');
});

async function checkChannelAction(guild, action) {
    const guildId = guild.id;
    if (!antiRaid.enabled.get(guildId)) return;

    const settings = antiRaid.settings.get(guildId) || { channelThreshold: 3, channelWindow: 5 };

    try {
        const auditLogs = await guild.fetchAuditLogs({ 
            limit: 1, 
            type: action === 'create' ? 10 : 12 
        });
        
        const log = auditLogs.entries.first();
        if (!log || log.executor.bot) return;

        const now = Date.now();
        
        if (!antiRaid.actionCache.has(guildId)) {
            antiRaid.actionCache.set(guildId, new Collection());
        }

        const userCache = antiRaid.actionCache.get(guildId);
        if (!userCache.has(log.executor.id)) {
            userCache.set(log.executor.id, { roles: [], channels: [] });
        }

        const userActions = userCache.get(log.executor.id);
        userActions.channels.push({ timestamp: now, action });
        userActions.channels = userActions.channels.filter(a => now - a.timestamp < settings.channelWindow * 1000);

        if (userActions.channels.length >= settings.channelThreshold) {
            antiRaid.stats.raidsDetected++;
            console.log(`🚨 КАНАЛЬНЫЙ РЕЙД от ${log.executor.tag} на ${guild.name}`);
            
            try {
                await guild.members.ban(log.executor.id, { 
                    reason: `Анти-рейд: ${userActions.channels.length} действий с каналами` 
                });
                antiRaid.stats.bans++;
            } catch (e) {
                console.error('Не удалось забанить:', e.message);
            }
        }
    } catch (error) {
        console.error('Ошибка проверки каналов:', error.message);
    }
}

// ============================================
// ФУНКЦИЯ СОЗДАНИЯ БЭКАПА
// ============================================
async function createBackup(guild) {
    const backup = {
        id: `${guild.id}_${Date.now()}`,
        name: guild.name,
        timestamp: Date.now(),
        roles: [],
        channels: []
    };

    guild.roles.cache.forEach(role => {
        if (role.name !== '@everyone') {
            backup.roles.push({
                name: role.name,
                color: role.color,
                permissions: role.permissions.bitfield.toString(),
                position: role.position
            });
        }
    });

    guild.channels.cache.forEach(channel => {
        backup.channels.push({
            name: channel.name,
            type: channel.type,
            position: channel.position,
            parentId: channel.parentId
        });
    });

    antiRaid.backups.set(guild.id, backup);
    
    if (!fs.existsSync('./backups')) {
        fs.mkdirSync('./backups');
    }
    
    fs.writeFileSync(`./backups/${backup.id}.json`, JSON.stringify(backup, null, 2));
    
    return backup;
}

// ============================================
// ЗАПУСК
// ============================================
client.once('ready', async () => {
    console.log(`=================================`);
    console.log(`✅ БОТ УСПЕШНО ЗАПУЩЕН НА RAILWAY!`);
    console.log(`=================================`);
    console.log(`📊 Информация:`);
    console.log(`   Имя бота: ${client.user.tag}`);
    console.log(`   ID бота: ${client.user.id}`);
    console.log(`   Серверов: ${client.guilds.cache.size}`);
    console.log(`   Пользователей: ${client.users.cache.size}`);
    console.log(`=================================`);
    
    await registerSlashCommands();
    keepBotOnline();
    
    console.log(`📋 Команды:`);
    console.log(`   /antiraid - защита от рейдов`);
    console.log(`   /verify - верификация`);
    console.log(`   /backup - бэкапы`);
    console.log(`   /kick, /clear - модерация`);
    console.log(`   /ping, /stats, /help`);
    console.log(`=================================`);
    console.log(`⏱️ Railway 24/7: бот работает постоянно`);
    console.log(`=================================`);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Необработанная ошибка:', error);
});

console.log('🔄 Запуск Anti-Raid бота на Railway...');
console.log(`🕐 Время: ${new Date().toLocaleString()}`);

client.login(BOT_TOKEN).catch(error => {
    console.error('❌ Ошибка при входе в Discord:', error.message);
    process.exit(1);
});
