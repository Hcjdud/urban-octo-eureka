const { PermissionsBitField } = require('discord.js');
const fs = require('fs');

module.exports = {
    name: 'backup',
    description: 'Управление бэкапами',
    async execute(message, args, client, antiRaid) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('У вас нет прав администратора');
        }

        const subcommand = args[0];

        if (!subcommand || subcommand === 'help') {
            return message.reply(`
Команды бэкапов:
!backup create - создать бэкап
!backup list - список бэкапов
!backup restore [id] - восстановить из бэкапа
            `);
        }

        switch (subcommand) {
            case 'create':
                try {
                    await message.reply('Создание бэкапа...');
                    
                    const backup = await createBackup(message.guild);
                    
                    message.reply(`
Бэкап создан:
ID: ${backup.id}
Ролей: ${backup.roles.length}
Каналов: ${backup.channels.length}
                    `);
                    
                } catch (error) {
                    message.reply('Ошибка при создании бэкапа');
                }
                break;

            case 'list':
                try {
                    const files = fs.readdirSync('./backups')
                        .filter(f => f.startsWith(message.guild.id));
                    
                    if (files.length === 0) {
                        return message.reply('Нет доступных бэкапов');
                    }

                    let response = 'Доступные бэкапы:\n';
                    files.forEach((file, index) => {
                        const data = JSON.parse(fs.readFileSync(`./backups/${file}`));
                        const date = new Date(data.timestamp).toLocaleString();
                        response += `${index + 1}. ID: ${data.id} | Дата: ${date}\n`;
                    });

                    message.reply(response);

                } catch (error) {
                    message.reply('Ошибка при получении списка бэкапов');
                }
                break;

            case 'restore':
                try {
                    const backupId = args[1];
                    let backupFile;

                    if (backupId) {
                        backupFile = `./backups/${backupId}.json`;
                        if (!fs.existsSync(backupFile)) {
                            return message.reply('Бэкап не найден');
                        }
                    } else {
                        const files = fs.readdirSync('./backups')
                            .filter(f => f.startsWith(message.guild.id))
                            .sort()
                            .reverse();

                        if (files.length === 0) {
                            return message.reply('Нет бэкапов для восстановления');
                        }

                        backupFile = `./backups/${files[0]}`;
                    }

                    const backupData = JSON.parse(fs.readFileSync(backupFile));

                    // Отправляем запрос владельцу
                    try {
                        const owner = await message.guild.fetchOwner();
                        
                        await owner.send(`
Запрос на восстановление сервера ${message.guild.name}
Бэкап от: ${new Date(backupData.timestamp).toLocaleString()}
Запросил: ${message.author.tag}

Для подтверждения отправьте: confirm
Для отмены отправьте: cancel
                        `);

                        message.reply('Запрос отправлен владельцу сервера');

                    } catch (error) {
                        message.reply('Не удалось отправить запрос владельцу');
                    }

                } catch (error) {
                    message.reply('Ошибка при восстановлении');
                }
                break;

            default:
                message.reply('Неизвестная команда. Используйте !backup help');
        }
    }
};

// Функция создания бэкапа
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
                hoist: role.hoist,
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

    if (!fs.existsSync('./backups')) {
        fs.mkdirSync('./backups');
    }

    fs.writeFileSync(`./backups/${backup.id}.json`, JSON.stringify(backup));

    return backup;
                      }
