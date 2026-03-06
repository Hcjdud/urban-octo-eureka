const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const express = require('express'); // Подключаем Express для создания веб-сервера
const fs = require('fs');
const path = require('path');

// ============================================
// СОЗДАЁМ ВЕБ-СЕРВЕР (для бесплатного тарифа)
// ============================================
const app = express();
// Render сам назначает порт. Берём его из окружения, или берём стандартный 10000.
const PORT = process.env.PORT || 10000;

// Главная страница - чтобы Render видел, что сервер работает
app.get('/', (req, res) => {
  res.send('Anti-Raid Discord Bot is running!');
});

// Это специальная страница для проверки здоровья (health check).
// Render будет её регулярно пинговать, чтобы убедиться, что всё хорошо.
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Запускаем сервер. КРИТИЧЕСКИ ВАЖНО слушать на всех интерфейсах (0.0.0.0)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Веб-сервер для Render запущен на порту ${PORT}`);
});

// ============================================
// ПРОВЕРКА ТОКЕНА
// ============================================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ ОШИБКА: BOT_TOKEN не найден в переменных окружения!');
    process.exit(1);
}

const PREFIX = '!'; // Префикс команд

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
// ХРАНИЛИЩЕ ДАННЫХ ДЛЯ АНТИ-РЕЙД СИСТЕМЫ
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
// ЗАГРУЗКА КОМАНД
// ============================================
client.commands = new Map();
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
// СОБЫТИЕ ГОТОВНОСТИ БОТА
// ============================================
client.once('ready', () => {
    console.log(`=================================`);
    console.log(`✅ БОТ УСПЕШНО ЗАПУЩЕН!`);
    console.log(`=================================`);
    console.log(`   Имя бота: ${client.user.tag}`);
    console.log(`   Серверов: ${client.guilds.cache.size}`);
    console.log(`=================================`);
    client.user.setActivity(`${PREFIX}antiraid help`, { type: 3 });
});

// ============================================
// ОБРАБОТКА КОМАНД
// ============================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    // Базовая команда antiraid
    if (commandName === 'antiraid') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ У вас нет прав администратора');
        }

        const sub = args[0];
        const guildId = message.guild.id;

        // HELP
        if (!sub || sub === 'help') {
            return message.reply(`
**🛡️ Anti-Raid Bot - Команды**
!antiraid on - включить защиту
!antiraid off - выключить защиту
!antiraid status - статус защиты
!antiraid set joins <число> <сек> - порог заходов
!antiraid set roles <число> <сек> - порог ролей
!antiraid set channels <число> <сек> - порог каналов
            `);
        }

        // ON
        if (sub === 'on') {
            antiRaid.enabled.set(guildId, true);
            return message.reply('✅ Анти-рейд защита **включена**');
        }

        // OFF
        if (sub === 'off') {
            antiRaid.enabled.set(guildId, false);
            return message.reply('✅ Анти-рейд защита **выключена**');
        }

        // STATUS
        if (sub === 'status') {
            const settings = antiRaid.settings.get(guildId) || {
                joinThreshold: 5, joinWindow: 10,
                roleThreshold: 3, roleWindow: 5,
                channelThreshold: 3, channelWindow: 5
            };
            const status = antiRaid.enabled.get(guildId) ? '✅ Включена' : '❌ Выключена';
            return message.reply(`
**Статус защиты:** ${status}
👥 Заходы: ${settings.joinThreshold} за ${settings.joinWindow} сек
👑 Роли: ${settings.roleThreshold} за ${settings.roleWindow} сек
📺 Каналы: ${settings.channelThreshold} за ${settings.channelWindow} сек
            `);
        }

        // SET
        if (sub === 'set') {
            const type = args[1];
            const threshold = parseInt(args[2]);
            const timeWindow = parseInt(args[3]);

            if (!type || isNaN(threshold) || isNaN(timeWindow)) {
                return message.reply('❌ Использование: !antiraid set <joins/roles/channels> <число> <секунды>');
            }

            const newSettings = antiRaid.settings.get(guildId) || {};
            
            if (type === 'joins') {
                newSettings.joinThreshold = threshold;
                newSettings.joinWindow = timeWindow;
                message.reply(`✅ Порог заходов: ${threshold} за ${timeWindow} сек`);
            } else if (type === 'roles') {
                newSettings.roleThreshold = threshold;
                newSettings.roleWindow = timeWindow;
                message.reply(`✅ Порог ролей: ${threshold} за ${timeWindow} сек`);
            } else if (type === 'channels') {
                newSettings.channelThreshold = threshold;
                newSettings.channelWindow = timeWindow;
                message.reply(`✅ Порог каналов: ${threshold} за ${timeWindow} сек`);
            } else {
                return message.reply('❌ Неверный тип. Используйте: joins, roles, channels');
            }
            
            antiRaid.settings.set(guildId, newSettings);
            return;
        }

        message.reply('❌ Неизвестная команда. Используйте !antiraid help');
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
// ЗАПУСК БОТА
// ============================================
client.login(BOT_TOKEN).catch(error => {
    console.error('❌ Ошибка при входе в Discord:', error.message);
    process.exit(1);
});
