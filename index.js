const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const express = require('express');

// Создаем Express сервер для Render
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Anti-Raid Bot работает!');
});

app.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});

// Получаем токен из переменных окружения
const config = {
    token: process.env.BOT_TOKEN,
    prefix: '!'
};

if (!config.token) {
    console.error('ОШИБКА: Не найден BOT_TOKEN в переменных окружения!');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Хранилище данных
const antiRaid = {
    enabled: new Map(),
    settings: new Map(),
    joinCache: new Map(),
    actionCache: new Map()
};

// Загрузка команд
client.commands = new Map();

try {
    if (fs.existsSync('./commands')) {
        const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            try {
                const command = require(`./commands/${file}`);
                client.commands.set(command.name, command);
                console.log(`Загружена команда: ${command.name}`);
            } catch (e) {
                console.error(`Ошибка загрузки команды ${file}:`, e);
            }
        }
        console.log(`Загружено команд: ${client.commands.size}`);
    } else {
        console.log('Папка commands не найдена, создаю...');
        fs.mkdirSync('./commands');
    }
} catch (error) {
    console.error('Ошибка при загрузке команд:', error);
}

client.once('ready', () => {
    console.log(`✅ Бот ${client.user.tag} успешно запущен на Render!`);
    client.user.setActivity('!antiraid help', { type: 3 });
});

// Обработка команд
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith(config.prefix) || message.author.bot) return;

    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    if (commandName === 'antiraid') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('У вас нет прав администратора');
        }

        const sub = args[0];
        const guildId = message.guild.id;

        if (!sub || sub === 'help') {
            return message.reply(`
Анти-рейд команды:
!antiraid on - включить защиту
!antiraid off - выключить защиту
!antiraid status - статус защиты
!antiraid set joins <число> <секунды> - порог заходов
!antiraid set roles <число> <секунды> - порог ролей
!antiraid set channels <число> <секунды> - порог каналов
            `);
        }

        switch (sub) {
            case 'on':
                antiRaid.enabled.set(guildId, true);
                message.reply('✅ Анти-рейд защита включена');
                break;

            case 'off':
                antiRaid.enabled.set(guildId, false);
                message.reply('✅ Анти-рейд защита выключена');
                break;

            case 'status':
                const settings = antiRaid.settings.get(guildId) || {
                    joinThreshold: 5, joinWindow: 10,
                    roleThreshold: 3, roleWindow: 5,
                    channelThreshold: 3, channelWindow: 5
                };
                const status = antiRaid.enabled.get(guildId) ? '✅ Включена' : '❌ Выключена';
                message.reply(`
**Статус защиты:** ${status}
**Параметры:**
👥 Заходы: ${settings.joinThreshold} за ${settings.joinWindow} сек
👑 Роли: ${settings.roleThreshold} за ${settings.roleWindow} сек
📺 Каналы: ${settings.channelThreshold} за ${settings.channelWindow} сек
                `);
                break;

            case 'set':
                const type = args[1];
                const threshold = parseInt(args[2]);
                const timeWindow = parseInt(args[3]);

                if (!type || isNaN(threshold) || isNaN(timeWindow)) {
                    return message.reply('Использование: !antiraid set <joins/roles/channels> <число> <секунды>');
                }

                const newSettings = antiRaid.settings.get(guildId) || {};
                
                switch (type) {
                    case 'joins':
                        newSettings.joinThreshold = threshold;
                        newSettings.joinWindow = timeWindow;
                        message.reply(`✅ Порог заходов: ${threshold} за ${timeWindow} сек`);
                        break;
                    case 'roles':
                        newSettings.roleThreshold = threshold;
                        newSettings.roleWindow = timeWindow;
                        message.reply(`✅ Порог ролей: ${threshold} за ${timeWindow} сек`);
                        break;
                    case 'channels':
                        newSettings.channelThreshold = threshold;
                        newSettings.channelWindow = timeWindow;
                        message.reply(`✅ Порог каналов: ${threshold} за ${timeWindow} сек`);
                        break;
                    default:
                        return message.reply('❌ Неверный тип. Используйте: joins, roles, channels');
                }
                
                antiRaid.settings.set(guildId, newSettings);
                break;

            default:
                message.reply('❌ Неизвестная команда. Используйте !antiraid help');
        }
    }
});

// Проверка новых участников
client.on('guildMemberAdd', async (member) => {
    const guildId = member.guild.id;
    if (!antiRaid.enabled.get(guildId)) return;

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
        try {
            await member.guild.setVerificationLevel(3);
            console.log(`Массовый заход на сервере ${member.guild.name}`);
        } catch (error) {
            console.error('Ошибка при защите:', error);
        }
    }
});

// Запуск бота
client.login(config.token);
