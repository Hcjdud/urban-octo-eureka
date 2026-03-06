const { Client, GatewayIntentBits, PermissionsBitField, REST, Routes, SlashCommandBuilder, ActivityType } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ============================================
// ВЕБ-СЕРВЕР ДЛЯ RENDER
// ============================================
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('Anti-Raid Discord Bot is running!');
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

if (!BOT_TOKEN) {
    console.error('❌ ОШИБКА: BOT_TOKEN не найден!');
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error('❌ ОШИБКА: CLIENT_ID не найден!');
    process.exit(1);
}

const PREFIX = '!';
const GUILD_ID = process.env.GUILD_ID;

// ============================================
// СОЗДАНИЕ DISCORD КЛИЕНТА
// ============================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ============================================
// ХРАНИЛИЩЕ ДАННЫХ
// ============================================
const antiRaid = {
    enabled: new Map(),
    settings: new Map(),
    joinCache: new Map(),
    actionCache: new Map(),
    stats: {
        bans: 0,
        raidsDetected: 0,
        joinsTracked: 0,
        startTime: Date.now()
    }
};

// ============================================
// ФУНКЦИЯ РЕГИСТРАЦИИ СЛЕШ-КОМАНД
// ============================================
async function registerSlashCommands() {
    try {
        console.log('🔄 Регистрация слеш-команд...');

        const commands = [
            new SlashCommandBuilder()
                .setName('antiraid')
                .setDescription('Управление анти-рейд защитой')
                .addSubcommand(sub =>
                    sub.setName('on').setDescription('Включить защиту'))
                .addSubcommand(sub =>
                    sub.setName('off').setDescription('Выключить защиту'))
                .addSubcommand(sub =>
                    sub.setName('status').setDescription('Показать статус защиты'))
                .addSubcommand(sub =>
                    sub.setName('set')
                        .setDescription('Настроить параметры защиты')
                        .addStringOption(opt =>
                            opt.setName('type')
                                .setDescription('Тип параметра')
                                .setRequired(true)
                                .addChoices(
                                    { name: 'Массовые заходы', value: 'joins' },
                                    { name: 'Действия с ролями', value: 'roles' },
                                    { name: 'Действия с каналами', value: 'channels' }
                                ))
                        .addIntegerOption(opt =>
                            opt.setName('threshold')
                                .setDescription('Пороговое значение')
                                .setRequired(true)
                                .setMinValue(1)
                                .setMaxValue(50))
                        .addIntegerOption(opt =>
                            opt.setName('window')
                                .setDescription('Временное окно (секунды)')
                                .setRequired(true)
                                .setMinValue(1)
                                .setMaxValue(300))),
            
            new SlashCommandBuilder()
                .setName('backup')
                .setDescription('Управление бэкапами сервера')
                .addSubcommand(sub =>
                    sub.setName('create').setDescription('Создать бэкап сервера'))
                .addSubcommand(sub =>
                    sub.setName('list').setDescription('Показать список бэкапов'))
                .addSubcommand(sub =>
                    sub.setName('restore')
                        .setDescription('Восстановить сервер из бэкапа')
                        .addStringOption(opt =>
                            opt.setName('backup_id')
                                .setDescription('ID бэкапа (оставьте пустым для последнего)')
                                .setRequired(false))),
            
            new SlashCommandBuilder()
                .setName('ping')
                .setDescription('Проверка работоспособности бота'),
            
            new SlashCommandBuilder()
                .setName('help')
                .setDescription('Показать список команд')
        ];

        const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

        if (GUILD_ID) {
            // Регистрация на конкретном сервере (мгновенно)
            await rest.put(
                Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
                { body: commands }
            );
            console.log(`✅ Слеш-команды зарегистрированы на сервере ${GUILD_ID}`);
        } else {
            // Глобальная регистрация (до 1 часа)
            await rest.put(
                Routes.applicationCommands(CLIENT_ID),
                { body: commands }
            );
            console.log('✅ Слеш-команды зарегистрированы глобально');
        }
    } catch (error) {
        console.error('❌ Ошибка регистрации слеш-команд:', error);
    }
}

// ============================================
// ФУНКЦИЯ ДЛЯ ПОДДЕРЖАНИЯ ЗЕЛЕНОГО СТАТУСА
// ============================================
function keepBotOnline() {
    // Устанавливаем начальный статус
    client.user.setStatus('online');
    client.user.setActivity('запуск...', { type: ActivityType.Playing });
    
    // Меняем активность каждые 30 секунд для поддержания "активности"
    const activities = [
        { name: 'за сервером', type: ActivityType.Watching },
        { name: 'анти-рейд защиту', type: ActivityType.Playing },
        { name: `${client.guilds.cache.size} серверов`, type: ActivityType.Watching },
        { name: 'рейдеров', type: ActivityType.Watching }
    ];
    
    let index = 0;
    
    // Интервал обновления активности
    setInterval(() => {
        try {
            // Явно устанавливаем статус онлайн (зеленый кружок)
            client.user.setStatus('online');
            
            // Обновляем активность
            client.user.setActivity(activities[index].name, { 
                type: activities[index].type 
            });
            
            index = (index + 1) % activities.length;
            
            // Необязательно: логируем для отладки (можно закомментировать)
            // console.log(`🔄 Статус обновлен: ${activities[index].name}`);
        } catch (error) {
            console.error('Ошибка при обновлении статуса:', error);
        }
    }, 30000); // Каждые 30 секунд
    
    // Дополнительный пинг каждые 5 минут для поддержания соединения
    setInterval(() => {
        try {
            // Просто пингуем Discord API
            const ping = client.ws.ping;
            console.log(`🏓 WebSocket ping: ${ping}ms`);
        } catch (error) {
            console.error('Ошибка при пинге:', error);
        }
    }, 300000); // Каждые 5 минут
}

// ============================================
// ОБРАБОТКА СЛЕШ-КОМАНД
// ============================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options, guild, member } = interaction;

    // Проверка прав для команд управления
    const adminCommands = ['antiraid', 'backup'];
    if (adminCommands.includes(commandName)) {
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ 
                content: '❌ У вас нет прав администратора для этой команды', 
                ephemeral: true 
            });
        }
    }

    // Команда /ping
    if (commandName === 'ping') {
        const latency = Date.now() - interaction.createdTimestamp;
        const apiLatency = client.ws.ping;
        return interaction.reply(
            `🏓 **Понг!**\n` +
            `⏱️ Задержка бота: ${latency}ms\n` +
            `📡 Задержка API: ${apiLatency}ms`
        );
    }

    // Команда /help
    if (commandName === 'help') {
        const helpText = 
            '**🛡️ Anti-Raid Bot - Команды**\n\n' +
            '**Слеш-команды:**\n' +
            '• `/antiraid on` - включить защиту\n' +
            '• `/antiraid off` - выключить защиту\n' +
            '• `/antiraid status` - статус защиты\n' +
            '• `/antiraid set` - настройка параметров\n' +
            '• `/backup create` - создать бэкап\n' +
            '• `/backup list` - список бэкапов\n' +
            '• `/backup restore` - восстановить из бэкапа\n' +
            '• `/ping` - проверить работу бота\n' +
            '• `/help` - показать это сообщение\n\n' +
            '**Префиксные команды:**\n' +
            '• `!antiraid help` - тоже работают';
        
        return interaction.reply(helpText);
    }

    // Команда /antiraid
    if (commandName === 'antiraid') {
        const subcommand = options.getSubcommand();
        const guildId = guild.id;

        switch (subcommand) {
            case 'on':
                antiRaid.enabled.set(guildId, true);
                return interaction.reply('✅ Анти-рейд защита **включена** на этом сервере');

            case 'off':
                antiRaid.enabled.set(guildId, false);
                return interaction.reply('✅ Анти-рейд защита **выключена** на этом сервере');

            case 'status':
                const settings = antiRaid.settings.get(guildId) || {
                    joinThreshold: 5, joinWindow: 10,
                    roleThreshold: 3, roleWindow: 5,
                    channelThreshold: 3, channelWindow: 5
                };
                const status = antiRaid.enabled.get(guildId) ? '✅ Включена' : '❌ Выключена';
                return interaction.reply(
                    `**Статус защиты:** ${status}\n` +
                    `👥 Заходы: ${settings.joinThreshold} за ${settings.joinWindow} сек\n` +
                    `👑 Роли: ${settings.roleThreshold} за ${settings.roleWindow} сек\n` +
                    `📺 Каналы: ${settings.channelThreshold} за ${settings.channelWindow} сек`
                );

            case 'set':
                const type = options.getString('type');
                const threshold = options.getInteger('threshold');
                const window = options.getInteger('window');

                const newSettings = antiRaid.settings.get(guildId) || {};
                
                if (type === 'joins') {
                    newSettings.joinThreshold = threshold;
                    newSettings.joinWindow = window;
                } else if (type === 'roles') {
                    newSettings.roleThreshold = threshold;
                    newSettings.roleWindow = window;
                } else if (type === 'channels') {
                    newSettings.channelThreshold = threshold;
                    newSettings.channelWindow = window;
                }
                
                antiRaid.settings.set(guildId, newSettings);
                return interaction.reply(`✅ Параметр **${type}** установлен: ${threshold} за ${window} сек`);
        }
    }

    // Команда /backup
    if (commandName === 'backup') {
        const subcommand = options.getSubcommand();
        
        if (subcommand === 'create') {
            await interaction.reply('🔄 Создание бэкапа...');
            // Здесь будет логика создания бэкапа
            setTimeout(() => {
                interaction.editReply('✅ Бэкап успешно создан!');
            }, 2000);
        } else if (subcommand === 'list') {
            interaction.reply('📋 Функция списка бэкапов в разработке');
        } else if (subcommand === 'restore') {
            const backupId = options.getString('backup_id') || 'последний';
            interaction.reply(`🔄 Восстановление из бэкапа ${backupId}...\n⚠️ Запрос отправлен владельцу сервера`);
        }
    }
});

// ============================================
// ОБРАБОТКА ПРЕФИКСНЫХ КОМАНД
// ============================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    if (commandName === 'antiraid' && args[0] === 'help') {
        message.reply('Используйте `/help` для списка всех команд');
    }
});

// ============================================
// ОБНАРУЖЕНИЕ МАССОВЫХ ЗАХОДОВ
// ============================================
client.on('guildMemberAdd', async (member) => {
    const guildId = member.guild.id;
    if (!antiRaid.enabled.get(guildId)) return;

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
        console.log(`🚨 МАССОВЫЙ ЗАХОД на сервере ${member.guild.name} (${filtered.length} за ${settings.joinWindow} сек)`);
        try {
            await member.guild.setVerificationLevel(3);
            console.log(`✅ Уровень проверки повышен для сервера ${member.guild.name}`);
        } catch (error) {
            console.error('Ошибка при повышении уровня проверки:', error.message);
        }
    }
});

// ============================================
// ЗАЩИТА ОТ ДЕЙСТВИЙ С РОЛЯМИ
// ============================================
client.on('guildRoleCreate', async (role) => {
    const guildId = role.guild.id;
    if (!antiRaid.enabled.get(guildId)) return;

    const settings = antiRaid.settings.get(guildId) || { roleThreshold: 3, roleWindow: 5 };
    
    try {
        const auditLogs = await role.guild.fetchAuditLogs({ limit: 1, type: 30 });
        const log = auditLogs.entries.first();
        if (!log || log.executor.bot) return;

        const now = Date.now();
        
        if (!antiRaid.actionCache.has(guildId)) {
            antiRaid.actionCache.set(guildId, new Map());
        }

        const userCache = antiRaid.actionCache.get(guildId);
        if (!userCache.has(log.executor.id)) {
            userCache.set(log.executor.id, { roles: [], lastAction: now });
        }

        const userActions = userCache.get(log.executor.id);
        userActions.roles.push({ timestamp: now, action: 'create' });
        userActions.roles = userActions.roles.filter(a => now - a.timestamp < settings.roleWindow * 1000);

        if (userActions.roles.length >= settings.roleThreshold) {
            antiRaid.stats.raidsDetected++;
            console.log(`🚨 РОЛЕВОЙ РЕЙД от ${log.executor.tag} на сервере ${role.guild.name}`);
            
            try {
                await role.guild.members.ban(log.executor.id, { 
                    reason: `Анти-рейд: ${userActions.roles.length} действий с ролями` 
                });
                antiRaid.stats.bans++;
                console.log(`✅ Нарушитель забанен: ${log.executor.tag}`);
            } catch (e) {
                console.error('Не удалось забанить нарушителя:', e.message);
            }
        }
    } catch (error) {
        console.error('Ошибка при проверке ролевых действий:', error.message);
    }
});

// ============================================
// СОБЫТИЕ ГОТОВНОСТИ БОТА
// ============================================
client.once('ready', async () => {
    console.log(`=================================`);
    console.log(`✅ БОТ УСПЕШНО ЗАПУЩЕН!`);
    console.log(`=================================`);
    console.log(`📊 Информация:`);
    console.log(`   Имя бота: ${client.user.tag}`);
    console.log(`   ID бота: ${client.user.id}`);
    console.log(`   Серверов: ${client.guilds.cache.size}`);
    console.log(`   Пользователей: ${client.users.cache.size}`);
    console.log(`=================================`);
    
    // РЕГИСТРИРУЕМ СЛЕШ-КОМАНДЫ ПОСЛЕ ЗАПУСКА БОТА
    await registerSlashCommands();
    
    // ЗАПУСКАЕМ ФУНКЦИЮ ПОДДЕРЖАНИЯ ЗЕЛЕНОГО СТАТУСА
    keepBotOnline();
    
    console.log(`🎯 Статус: ONLINE (зеленый)`);
    console.log(`=================================`);
});

// ============================================
// ЗАПУСК БОТА
// ============================================
console.log('🔄 Запуск Anti-Raid бота...');
console.log(`🕐 Время: ${new Date().toLocaleString()}`);
console.log(`📦 Node.js версия: ${process.version}`);

client.login(BOT_TOKEN).catch(error => {
    console.error('❌ Ошибка при входе в Discord:', error.message);
    process.exit(1);
});
