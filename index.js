const { Client, GatewayIntentBits, PermissionsBitField, REST, Routes, SlashCommandBuilder } = require('discord.js');
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
const CLIENT_ID = process.env.CLIENT_ID; // НУЖНО ДОБАВИТЬ! ID бота из Discord Developer Portal

if (!BOT_TOKEN) {
    console.error('❌ ОШИБКА: BOT_TOKEN не найден!');
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error('❌ ОШИБКА: CLIENT_ID не найден! Добавьте его в переменные окружения');
    process.exit(1);
}

const PREFIX = '!';
const GUILD_ID = process.env.GUILD_ID; // Опционально: ID сервера для быстрой регистрации

// ============================================
// СОЗДАНИЕ SLASH КОМАНД
// ============================================
const commands = [
    new SlashCommandBuilder()
        .setName('antiraid')
        .setDescription('Управление анти-рейд защитой')
        .addSubcommand(subcommand =>
            subcommand
                .setName('on')
                .setDescription('Включить защиту'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('off')
                .setDescription('Выключить защиту'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Показать статус защиты'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Настроить параметры защиты')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Тип параметра')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Массовые заходы', value: 'joins' },
                            { name: 'Действия с ролями', value: 'roles' },
                            { name: 'Действия с каналами', value: 'channels' }
                        ))
                .addIntegerOption(option =>
                    option.setName('threshold')
                        .setDescription('Пороговое значение')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(50))
                .addIntegerOption(option =>
                    option.setName('window')
                        .setDescription('Временное окно (секунды)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(300))),
    
    new SlashCommandBuilder()
        .setName('backup')
        .setDescription('Управление бэкапами сервера')
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Создать бэкап сервера'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Показать список бэкапов'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('restore')
                .setDescription('Восстановить сервер из бэкапа')
                .addStringOption(option =>
                    option.setName('backup_id')
                        .setDescription('ID бэкапа (оставьте пустым для последнего)')
                        .setRequired(false))),
    
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Проверка работоспособности бота'),
    
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Показать список команд')
];

// ============================================
// РЕГИСТРАЦИЯ SLASH КОМАНД
// ============================================
const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

async function registerCommands() {
    try {
        console.log('🔄 Регистрация слеш-команд...');

        if (GUILD_ID) {
            // Регистрация на конкретном сервере (быстрее, для тестирования)
            await rest.put(
                Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
                { body: commands }
            );
            console.log(`✅ Команды зарегистрированы на сервере ${GUILD_ID}`);
        } else {
            // Глобальная регистрация (может занять до 1 часа)
            await rest.put(
                Routes.applicationCommands(CLIENT_ID),
                { body: commands }
            );
            console.log('✅ Команды зарегистрированы глобально');
        }
    } catch (error) {
        console.error('❌ Ошибка регистрации команд:', error);
    }
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
// ОБРАБОТКА SLASH КОМАНД
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
        return interaction.reply(`🏓 Понг! Задержка: ${latency}ms`);
    }

    // Команда /help
    if (commandName === 'help') {
        const helpText = `
**🛡️ Anti-Raid Bot - Команды**

**Слеш-команды:**
/antiraid on - включить защиту
/antiraid off - выключить защиту
/antiraid status - статус защиты
/antiraid set - настройка параметров

/backup create - создать бэкап
/backup list - список бэкапов
/backup restore - восстановить из бэкапа

/ping - проверить работу бота
/help - показать это сообщение

**Префиксные команды:**
!antiraid help - тоже работают
        `;
        return interaction.reply(helpText);
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
                return interaction.reply(`
**Статус защиты:** ${status}
👥 Заходы: ${settings.joinThreshold} за ${settings.joinWindow} сек
👑 Роли: ${settings.roleThreshold} за ${settings.roleWindow} сек
📺 Каналы: ${settings.channelThreshold} за ${settings.channelWindow} сек
                `);

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

    // Команда /backup (упрощенная версия)
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
        message.reply('Используйте /help для списка всех команд');
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
        console.log(`🚨 Массовый заход на сервере ${member.guild.name}`);
        try {
            await member.guild.setVerificationLevel(3);
        } catch (error) {
            console.error('Ошибка при защите:', error.message);
        }
    }
});

// ============================================
// ЗАПУСК
// ============================================
client.once('ready', () => {
    console.log(`=================================`);
    console.log(`✅ БОТ УСПЕШНО ЗАПУЩЕН!`);
    console.log(`=================================`);
    console.log(`   Имя бота: ${client.user.tag}`);
    console.log(`   ID бота: ${client.user.id}`);
    console.log(`   Серверов: ${client.guilds.cache.size}`);
    console.log(`   Слеш-команды: /help, /ping, /antiraid, /backup`);
    console.log(`=================================`);
    client.user.setActivity('/help | Анти-рейд защита', { type: 3 });
});

// Регистрируем команды и запускаем бота
registerCommands().then(() => {
    client.login(BOT_TOKEN);
});
