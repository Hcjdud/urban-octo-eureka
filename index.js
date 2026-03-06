const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');

// ============================================
// ВЕБ-СЕРВЕР ДЛЯ RENDER
// ============================================
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('Anti-Raid Bot is running!');
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('✅ Веб-сервер запущен');
});

// ============================================
// ПРОВЕРКА ТОКЕНА
// ============================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!BOT_TOKEN) {
    console.error('❌ Ошибка: BOT_TOKEN не найден');
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error('❌ Ошибка: CLIENT_ID не найден');
    process.exit(1);
}

console.log('✅ Переменные окружения загружены');

// ============================================
// СОЗДАНИЕ КЛИЕНТА
// ============================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ============================================
// СПИСОК КОМАНД
// ============================================
const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Проверка работы бота'),
    
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Показать список команд')
];

// ============================================
// РЕГИСТРАЦИЯ КОМАНД
// ============================================
async function registerCommands() {
    try {
        console.log('🔄 Регистрация команд...');
        
        const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
        
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );
        
        console.log('✅ Команды зарегистрированы глобально');
    } catch (error) {
        console.error('❌ Ошибка регистрации:', error.message);
    }
}

// ============================================
// ОБРАБОТКА КОМАНД
// ============================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'ping') {
        await interaction.reply('🏓 Понг!');
    }

    if (commandName === 'help') {
        await interaction.reply('Доступные команды: /ping, /help');
    }
});

// ============================================
// ЗАПУСК
// ============================================
client.once('ready', async () => {
    console.log('✅ БОТ ЗАПУЩЕН!');
    console.log(`Имя: ${client.user.tag}`);
    console.log(`Серверов: ${client.guilds.cache.size}`);
    
    client.user.setStatus('online');
    client.user.setActivity('/help', { type: 0 });
    
    await registerCommands();
});

client.login(BOT_TOKEN);
