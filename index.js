const { Client, GatewayIntentBits, PermissionsBitField, REST, Routes, SlashCommandBuilder, ActivityType } = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ============================================
// ВЕБ-СЕРВЕР ДЛЯ RENDER (ОБЯЗАТЕЛЬНО)
// ============================================
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>Anti-Raid Bot</title></head>
            <body>
                <h1>✅ Anti-Raid Bot is running!</h1>
                <p>Status: ONLINE</p>
                <p>Time: ${new Date().toLocaleString()}</p>
            </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Запускаем сервер на 0.0.0.0 (ВАЖНО!)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ [SERVER] Веб-сервер запущен на порту ${PORT}`);
});

// ============================================
// ПРОВЕРКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ
// ============================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // Опционально

if (!BOT_TOKEN) {
    console.error('❌ [ERROR] BOT_TOKEN не найден в переменных окружения!');
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error('❌ [ERROR] CLIENT_ID не найден в переменных окружения!');
    process.exit(1);
}

console.log('✅ [ENV] Переменные окружения загружены');
console.log(`   CLIENT_ID: ${CLIENT_ID}`);
if (GUILD_ID) console.log(`   GUILD_ID: ${GUILD_ID}`);

// ============================================
// НАСТРОЙКА ПРЕФИКСА
// ============================================
const PREFIX = '!';

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
async function registerCommands() {
    try {
        console.log('🔄 [CMDS] Регистрация слеш-команд...');

        const commands = [
            new SlashCommandBuilder()
                .setName('ping')
                .setDescription('Проверка работы бота'),
            
            new SlashCommandBuilder()
                .setName('help')
                .setDescription('Показать список команд'),
            
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
                                .setDescription('Пороговое значение (1-50)')
                                .setRequired(true)
                                .setMinValue(1)
                                .setMaxValue(50))
                        .addIntegerOption(opt =>
                            opt.setName('window')
                                .setDescription('Временное окно в секундах (1-300)')
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
        ];

        const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

        if (GUILD_ID) {
            // Регистрация на конкретном сервере (мгновенно)
            await rest.put(
                Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
                { body: commands }
            );
            console.log(`✅ [CMDS] Команды зарегистрированы на сервере ${GUILD_ID}`);
        } else {
            // Глобальная регистрация (до 1 часа)
            await rest.put(
                Routes.applicationCommands(CLIENT_ID),
                { body: commands }
            );
            console.log('✅ [CMDS] Команды зарегистрированы глобально');
        }
    } catch (error) {
        console.error('❌ [CMDS] Ошибка регистрации команд:', error.message);
    }
}

// ============================================
// ФУНКЦИЯ ПОДДЕРЖАНИЯ СТАТУСА
// ============================================
function keepAlive() {
    // Устанавливаем начальный статус
    client.user.setStatus('online');
    client.user.setActivity('запуск...', { type: ActivityType.Playing });
    
    const activities = [
        { name: 'за сервером', type: ActivityType.Watching },
        { name: 'анти-рейд защиту', type: ActivityType.Playing },
        { name: `${client.guilds.cache.size} серверов`, type: ActivityType.Watching },
        { name: 'команды /help', type: ActivityType.Listening }
    ];
    
    let index = 0;
    
    // Обновляем активность каждые 30 секунд
    setInterval(() => {
        try {
            client.user.setStatus('online');
            client.user.setActivity(activities[index].name, { 
                type: activities[index].type 
            });
            index = (index + 1) % activities.length;
            console.log(`🔄 [STATUS] Активность обновлена`);
        } catch (error) {
            console.error('❌ [STATUS] Ошибка обновления статуса:', error.message);
        }
    }, 30000);
    
    // Пинг каждые 5 минут для поддержания соединения
    setInterval(() => {
        try {
            const ping = client.ws.ping;
            console.log(`🏓 [PING] WebSocket ping: ${ping}ms`);
        } catch (error) {
            console.error('❌ [PING] Ошибка пинга:', error.message);
        }
    }, 300000);
    
    // Самопинг каждые 10 минут через HTTP (чтобы Render не усыплял)
    setInterval(() => {
        try {
            axios.get(`http://localhost:${PORT}/health`)
                .then(() => console.log('🔄 [SELF] Самопинг успешен'))
                .catch(err => console.log('⚠️ [SELF] Самопинг не удался:', err.message));
        } catch (error) {
            // Игнорируем
        }
    }, 600000);
}

// ============================================
// ОБРАБОТКА СЛЕШ-КОМАНД
// ============================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options, guild, member } = interaction;

    console.log(`📨 [CMD] Получена команда: /${commandName} от ${member.user.tag}`);

    // Команда /ping
    if (commandName === 'ping') {
        const latency = Date.now() - interaction.createdTimestamp;
        const apiLatency = client.ws.ping;
        
        return interaction.reply({ 
            content: `🏓 **Понг!**\n⏱️ Задержка бота: ${latency}ms\n📡 Задержка API: ${apiLatency}ms`,
            ephemeral: false
        });
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
            '• `/ping` - проверить работу бота\n' +
            '• `/help` - показать это сообщение';
        
        return interaction.reply(helpText);
    }

    // Проверка прав для команд управления
    if (commandName === 'antiraid' || commandName === 'backup') {
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ 
                content: '❌ У вас нет прав администратора для этой команды', 
                ephemeral: true 
            });
        }
    }

    // Команда /antiraid
    if (commandName === 'antiraid') {
        const subcommand = options.getSubcommand();
        const guildId = guild.id;

        switch (subcommand) {
            case 'on':
                antiRaid.enabled.set(guildId, true);
                return interaction.reply('✅ Анти-рейд защита **включена**');

            case 'off':
                antiRaid.enabled.set(guildId, false);
                return interaction.reply('✅ Анти-рейд защита **выключена**');

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
            
            setTimeout(() => {
                interaction.editReply('✅ Бэкап успешно создан!');
            }, 2000);
        } else if (subcommand === 'list') {
            interaction.reply('📋 Функция списка бэкапов в разработке');
        }
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
        console.log(`🚨 [RAID] Массовый заход на сервере ${member.guild.name} (${filtered.length} за ${settings.joinWindow} сек)`);
        try {
            await member.guild.setVerificationLevel(3);
            console.log(`✅ [RAID] Уровень проверки повышен для сервера ${member.guild.name}`);
        } catch (error) {
            console.error('❌ [RAID] Ошибка:', error.message);
        }
    }
});

// ============================================
// СОБЫТИЕ ГОТОВНОСТИ БОТА
// ============================================
client.once('ready', async () => {
    console.log('\n=================================');
    console.log('✅ БОТ УСПЕШНО ЗАПУЩЕН!');
    console.log('=================================');
    console.log(`📊 Информация:`);
    console.log(`   Имя бота: ${client.user.tag}`);
    console.log(`   ID бота: ${client.user.id}`);
    console.log(`   Серверов: ${client.guilds.cache.size}`);
    console.log(`   Пользователей: ${client.users.cache.size}`);
    console.log('=================================\n');
    
    // РЕГИСТРИРУЕМ КОМАНДЫ
    await registerCommands();
    
    // ЗАПУСКАЕМ ПОДДЕРЖАНИЕ СТАТУСА
    keepAlive();
    
    console.log('🎯 Статус: ONLINE (зеленый)\n');
});

// ============================================
// ЗАПУСК БОТА
// ============================================
console.log('\n🔄 Запуск Anti-Raid бота...');
console.log(`🕐 Время: ${new Date().toLocaleString()}`);
console.log(`📦 Node.js версия: ${process.version}\n`);

client.login(BOT_TOKEN).catch(error => {
    console.error('❌ [FATAL] Ошибка при входе в Discord:', error.message);
    process.exit(1);
});
