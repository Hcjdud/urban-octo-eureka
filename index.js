const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const express = require('express');
const path = require('path');

// ============================================
// НАСТРОЙКА EXPRESS СЕРВЕРА ДЛЯ RENDER
// ============================================
const app = express();
const PORT = process.env.PORT || 10000; // Render ожидает порт 10000

// Мидлвары для логирования запросов (опционально)
app.use(express.json());

// Главная страница - информация о боте
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Anti-Raid Bot</title>
                <style>
                    body { font-family: Arial; margin: 40px; background: #1a1a1a; color: #fff; }
                    .container { max-width: 800px; margin: 0 auto; }
                    .status { color: #00ff00; font-size: 24px; }
                    .info { background: #333; padding: 20px; border-radius: 10px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🛡️ Anti-Raid Bot</h1>
                    <div class="status">✅ Бот работает на Render!</div>
                    <div class="info">
                        <h3>Информация:</h3>
                        <p>Бот активен и защищает сервер от рейдов</p>
                        <p>Время запуска: ${new Date().toLocaleString()}</p>
                    </div>
                </div>
            </body>
        </html>
    `);
});

// Эндпоинт для проверки здоровья (Render использует это)
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: Date.now(),
        bot: client?.user?.tag || 'starting...'
    });
});

// Статистика бота (опционально)
app.get('/stats', (req, res) => {
    const stats = {
        servers: client.guilds.cache.size,
        users: client.users.cache.size,
        uptime: process.uptime(),
        memory: process.memoryUsage()
    };
    res.json(stats);
});

// Запускаем сервер на всех интерфейсах (0.0.0.0 критически важно для Render!)
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================`);
    console.log(`✅ HTTP сервер запущен:`);
    console.log(`   Порт: ${PORT}`);
    console.log(`   Интерфейс: 0.0.0.0 (все доступные)`);
    console.log(`   Health check: /health`);
    console.log(`=================================`);
});

// Увеличиваем таймауты для предотвращения закрытия соединений
server.keepAliveTimeout = 120000; // 120 секунд
server.headersTimeout = 120000; // 120 секунд

// ============================================
// НАСТРОЙКА DISCORD БОТА
// ============================================

// Получаем токен из переменных окружения
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: BOT_TOKEN не найден в переменных окружения!');
    console.error('   Добавьте BOT_TOKEN в Environment Variables на Render');
    process.exit(1); // Останавливаем процесс если нет токена
}

const PREFIX = '!'; // Префикс команд

// Создаем Discord клиент с нужными интентами
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
// ХРАНИЛИЩЕ ДАННЫХ ДЛЯ АНТИ-РЕЙД СИСТЕМЫ
// ============================================
const antiRaid = {
    // Включена ли защита на сервере
    enabled: new Map(),
    
    // Настройки для каждого сервера
    settings: new Map(),
    
    // Кэш массовых заходов
    joinCache: new Map(),
    
    // Кэш действий с ролями/каналами
    actionCache: new Map(),
    
    // Статистика
    stats: {
        bans: 0,
        raidsDetected: 0,
        joinsTracked: 0
    }
};

// ============================================
// ЗАГРУЗКА КОМАНД ИЗ ПАПКИ COMMANDS
// ============================================
client.commands = new Map();

// Проверяем существование папки commands
const commandsPath = path.join(__dirname, 'commands');
if (!fs.existsSync(commandsPath)) {
    console.log('📁 Папка commands не найдена, создаю...');
    fs.mkdirSync(commandsPath, { recursive: true });
}

// Загружаем команды
try {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    
    if (commandFiles.length === 0) {
        console.log('⚠️ В папке commands нет файлов с командами');
    } else {
        for (const file of commandFiles) {
            try {
                const command = require(`./commands/${file}`);
                client.commands.set(command.name, command);
                console.log(`✅ Загружена команда: ${command.name}`);
            } catch (e) {
                console.error(`❌ Ошибка загрузки команды ${file}:`, e.message);
            }
        }
        console.log(`✅ Всего загружено команд: ${client.commands.size}`);
    }
} catch (error) {
    console.error('❌ Ошибка при загрузке команд:', error.message);
}

// ============================================
// СОБЫТИЕ ГОТОВНОСТИ БОТА
// ============================================
client.once('ready', () => {
    console.log(`=================================`);
    console.log(`✅ Бот успешно запущен на Render!`);
    console.log(`   Имя бота: ${client.user.tag}`);
    console.log(`   ID бота: ${client.user.id}`);
    console.log(`   Серверов: ${client.guilds.cache.size}`);
    console.log(`   Пользователей: ${client.users.cache.size}`);
    console.log(`=================================`);
    
    // Устанавливаем статус бота
    client.user.setActivity(`${PREFIX}antiraid help | Защита ${client.guilds.cache.size} серверов`, { 
        type: 3 // WATCHING
    });
});

// ============================================
// ОБРАБОТКА КОМАНД
// ============================================
client.on('messageCreate', async (message) => {
    // Игнорируем сообщения от ботов
    if (message.author.bot) return;
    
    // Проверяем префикс
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    // Базовая команда antiraid (встроенная)
    if (commandName === 'antiraid') {
        // Проверяем права администратора
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ У вас нет прав администратора для этой команды');
        }

        const sub = args[0];
        const guildId = message.guild.id;

        // HELP - показываем справку
        if (!sub || sub === 'help') {
            return message.reply(`
**🛡️ Anti-Raid Bot - Команды**

**Управление:**
${PREFIX}antiraid on - включить защиту
${PREFIX}antiraid off - выключить защиту
${PREFIX}antiraid status - статус защиты

**Настройка порогов:**
${PREFIX}antiraid set joins <число> <секунды> - массовые заходы
${PREFIX}antiraid set roles <число> <секунды> - создание/удаление ролей
${PREFIX}antiraid set channels <число> <секунды> - создание/удаление каналов

**Пример:** ${PREFIX}antiraid set joins 5 10 (5 заходов за 10 секунд = рейд)
            `);
        }

        // Включение защиты
        if (sub === 'on') {
            antiRaid.enabled.set(guildId, true);
            return message.reply('✅ Анти-рейд защита **включена** на этом сервере');
        }

        // Выключение защиты
        if (sub === 'off') {
            antiRaid.enabled.set(guildId, false);
            return message.reply('✅ Анти-рейд защита **выключена** на этом сервере');
        }

        // Статус защиты
        if (sub === 'status') {
            const settings = antiRaid.settings.get(guildId) || {
                joinThreshold: 5, joinWindow: 10,
                roleThreshold: 3, roleWindow: 5,
                channelThreshold: 3, channelWindow: 5
            };
            const status = antiRaid.enabled.get(guildId) ? '✅ Включена' : '❌ Выключена';
            
            return message.reply(`
**📊 Статус защиты сервера**

**Общий статус:** ${status}

**Параметры обнаружения:**
👥 **Массовые заходы:** ${settings.joinThreshold} за ${settings.joinWindow} сек
👑 **Действия с ролями:** ${settings.roleThreshold} за ${settings.roleWindow} сек
📺 **Действия с каналами:** ${settings.channelThreshold} за ${settings.channelWindow} сек

**Статистика бота:**
🛡️ Всего предотвращено рейдов: ${antiRaid.stats.raidsDetected}
🔨 Забанено нарушителей: ${antiRaid.stats.bans}
            `);
        }

        // Настройка параметров
        if (sub === 'set') {
            const type = args[1];
            const threshold = parseInt(args[2]);
            const timeWindow = parseInt(args[3]);

            if (!type || isNaN(threshold) || isNaN(timeWindow)) {
                return message.reply('❌ Использование: !antiraid set <joins/roles/channels> <число> <секунды>');
            }

            // Проверка на разумные значения
            if (threshold < 1 || threshold > 50) {
                return message.reply('❌ Число должно быть от 1 до 50');
            }
            if (timeWindow < 1 || timeWindow > 300) {
                return message.reply('❌ Секунды должны быть от 1 до 300');
            }

            const newSettings = antiRaid.settings.get(guildId) || {};
            
            switch (type) {
                case 'joins':
                    newSettings.joinThreshold = threshold;
                    newSettings.joinWindow = timeWindow;
                    message.reply(`✅ Порог массовых заходов установлен: **${threshold}** за **${timeWindow}** секунд`);
                    break;
                case 'roles':
                    newSettings.roleThreshold = threshold;
                    newSettings.roleWindow = timeWindow;
                    message.reply(`✅ Порог действий с ролями установлен: **${threshold}** за **${timeWindow}** секунд`);
                    break;
                case 'channels':
                    newSettings.channelThreshold = threshold;
                    newSettings.channelWindow = timeWindow;
                    message.reply(`✅ Порог действий с каналами установлен: **${threshold}** за **${timeWindow}** секунд`);
                    break;
                default:
                    return message.reply('❌ Неверный тип. Используйте: joins, roles, channels');
            }
            
            antiRaid.settings.set(guildId, newSettings);
            return;
        }

        // Если команда не распознана
        message.reply('❌ Неизвестная команда. Используйте !antiraid help');
    }
    
    // Здесь можно добавить другие команды (backup и т.д.)
});

// ============================================
// ОБНАРУЖЕНИЕ МАССОВЫХ ЗАХОДОВ
// ============================================
client.on('guildMemberAdd', async (member) => {
    const guildId = member.guild.id;
    
    // Проверяем включена ли защита
    if (!antiRaid.enabled.get(guildId)) return;

    antiRaid.stats.joinsTracked++;

    // Получаем настройки сервера или используем стандартные
    const settings = antiRaid.settings.get(guildId) || { 
        joinThreshold: 5, 
        joinWindow: 10 
    };
    
    const now = Date.now();
    
    // Инициализируем кэш для сервера
    if (!antiRaid.joinCache.has(guildId)) {
        antiRaid.joinCache.set(guildId, []);
    }

    const joinCache = antiRaid.joinCache.get(guildId);
    
    // Добавляем нового участника
    joinCache.push({ 
        userId: member.id, 
        timestamp: now,
        accountAge: now - member.user.createdTimestamp
    });

    // Очищаем старые записи (старше временного окна)
    const filtered = joinCache.filter(entry => now - entry.timestamp < settings.joinWindow * 1000);
    antiRaid.joinCache.set(guildId, filtered);

    // Проверяем превышение порога
    if (filtered.length >= settings.joinThreshold) {
        // Обнаружен массовый заход!
        antiRaid.stats.raidsDetected++;
        
        console.log(`🚨 Обнаружен массовый заход на сервере ${member.guild.name} (${filtered.length} за ${settings.joinWindow} сек)`);
        
        try {
            // Повышаем уровень проверки сервера
            await member.guild.setVerificationLevel(3);
            console.log(`✅ Уровень проверки повышен для сервера ${member.guild.name}`);
            
            // Баним подозрительные аккаунты (младше 1 дня)
            const oneDay = 24 * 60 * 60 * 1000;
            for (const entry of filtered) {
                if (entry.accountAge < oneDay) {
                    try {
                        const memberToBan = await member.guild.members.fetch(entry.userId);
                        await memberToBan.ban({ reason: 'Анти-рейд: подозрительный аккаунт (младше 1 дня)' });
                        antiRaid.stats.bans++;
                    } catch (e) {
                        // Игнорируем ошибки бана
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка при обработке массового захода:', error.message);
        }
    }
});

// ============================================
// ЗАЩИТА ОТ ДЕЙСТВИЙ С РОЛЯМИ (через аудит лог)
// ============================================
async function checkRoleAction(guild, action) {
    const guildId = guild.id;
    if (!antiRaid.enabled.get(guildId)) return;

    const settings = antiRaid.settings.get(guildId) || { 
        roleThreshold: 3, 
        roleWindow: 5 
    };

    try {
        // Получаем последнюю запись из аудит лога
        const auditLogs = await guild.fetchAuditLogs({ 
            limit: 1, 
            type: action === 'create' ? 30 : action === 'delete' ? 32 : 31 
        });
        
        const log = auditLogs.entries.first();
        if (!log || log.executor.bot) return;

        const now = Date.now();
        const executorId = log.executor.id;

        // Инициализируем кэш
        if (!antiRaid.actionCache.has(guildId)) {
            antiRaid.actionCache.set(guildId, new Map());
        }

        const userCache = antiRaid.actionCache.get(guildId);
        if (!userCache.has(executorId)) {
            userCache.set(executorId, { 
                roles: [], 
                channels: [], 
                lastAction: now 
            });
        }

        const userActions = userCache.get(executorId);
        userActions.roles.push({ timestamp: now, action });
        userActions.lastAction = now;
        
        // Очищаем старые записи
        userActions.roles = userActions.roles.filter(a => now - a.timestamp < settings.roleWindow * 1000);

        // Проверяем превышение порога
        if (userActions.roles.length >= settings.roleThreshold) {
            // Обнаружен ролевой рейд!
            antiRaid.stats.raidsDetected++;
            
            console.log(`🚨 Обнаружен ролевой рейд на сервере ${guild.name} от ${log.executor.tag}`);
            
            try {
                await guild.members.ban(executorId, { 
                    reason: `Анти-рейд: ${userActions.roles.length} действий с ролями за ${settings.roleWindow} сек` 
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
}

// Подписываемся на события ролей
client.on('guildRoleCreate', (role) => checkRoleAction(role.guild, 'create'));
client.on('guildRoleDelete', (role) => checkRoleAction(role.guild, 'delete'));
client.on('guildRoleUpdate', (oldRole, newRole) => checkRoleAction(newRole.guild, 'update'));

// ============================================
// ЗАЩИТА ОТ ДЕЙСТВИЙ С КАНАЛАМИ
// ============================================
async function checkChannelAction(guild, action) {
    const guildId = guild.id;
    if (!antiRaid.enabled.get(guildId)) return;

    const settings = antiRaid.settings.get(guildId) || { 
        channelThreshold: 3, 
        channelWindow: 5 
    };

    try {
        // Получаем последнюю запись из аудит лога
        const auditLogs = await guild.fetchAuditLogs({ 
            limit: 1, 
            type: action === 'create' ? 10 : 12 
        });
        
        const log = auditLogs.entries.first();
        if (!log || log.executor.bot) return;

        const now = Date.now();
        const executorId = log.executor.id;

        // Инициализируем кэш
        if (!antiRaid.actionCache.has(guildId)) {
            antiRaid.actionCache.set(guildId, new Map());
        }

        const userCache = antiRaid.actionCache.get(guildId);
        if (!userCache.has(executorId)) {
            userCache.set(executorId, { 
                roles: [], 
                channels: [], 
                lastAction: now 
            });
        }

        const userActions = userCache.get(executorId);
        userActions.channels.push({ timestamp: now, action });
        userActions.lastAction = now;
        
        // Очищаем старые записи
        userActions.channels = userActions.channels.filter(a => now - a.timestamp < settings.channelWindow * 1000);

        // Проверяем превышение порога
        if (userActions.channels.length >= settings.channelThreshold) {
            // Обнаружен канальный рейд!
            antiRaid.stats.raidsDetected++;
            
            console.log(`🚨 Обнаружен канальный рейд на сервере ${guild.name} от ${log.executor.tag}`);
            
            try {
                await guild.members.ban(executorId, { 
                    reason: `Анти-рейд: ${userActions.channels.length} действий с каналами за ${settings.channelWindow} сек` 
                });
                antiRaid.stats.bans++;
                console.log(`✅ Нарушитель забанен: ${log.executor.tag}`);
            } catch (e) {
                console.error('Не удалось забанить нарушителя:', e.message);
            }
        }

    } catch (error) {
        console.error('Ошибка при проверке действий с каналами:', error.message);
    }
}

// Подписываемся на события каналов
client.on('channelCreate', (channel) => {
    if (channel.guild) checkChannelAction(channel.guild, 'create');
});
client.on('channelDelete', (channel) => {
    if (channel.guild) checkChannelAction(channel.guild, 'delete');
});

// ============================================
// ОБРАБОТКА ОШИБОК
// ============================================
process.on('unhandledRejection', (error) => {
    console.error('❌ Необработанная ошибка:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Непойманное исключение:', error);
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
