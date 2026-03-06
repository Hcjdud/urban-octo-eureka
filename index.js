const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// Веб-сервер для Render
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot diagnostic mode'));
app.listen(PORT, '0.0.0.0', () => console.log('✅ Сервер диагностики запущен'));

// Проверка переменных
console.log('=== ДИАГНОСТИКА ===');
console.log('CLIENT_ID:', process.env.CLIENT_ID || '❌ НЕ НАЙДЕН');
console.log('BOT_TOKEN:', process.env.BOT_TOKEN ? '✅ НАЙДЕН' : '❌ НЕ НАЙДЕН');
console.log('BOT_TOKEN length:', process.env.BOT_TOKEN?.length || 0);

// Discord клиент
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds] 
});

client.once('ready', () => {
    console.log('✅ БОТ ПОДКЛЮЧЕН К DISCORD!');
    console.log('Имя бота:', client.user.tag);
    client.user.setStatus('online');
});

client.login(process.env.BOT_TOKEN).catch(err => {
    console.error('❌ ОШИБКА ПОДКЛЮЧЕНИЯ:', err.message);
});
