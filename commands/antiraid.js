const { PermissionsBitField } = require('discord.js');

module.exports = {
    name: 'antiraid',
    description: 'Управление анти-рейд системой',
    async execute(message, args, client, antiRaid) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('У вас нет прав администратора');
        }

        const subcommand = args[0];
        const guildId = message.guild.id;

        if (!subcommand || subcommand === 'help') {
            return message.reply(`
Команды анти-рейд:
!antiraid on - включить защиту
!antiraid off - выключить защиту
!antiraid status - статус защиты
!antiraid set joins <число> <секунды> - порог заходов
!antiraid set roles <число> <секунды> - порог ролей
!antiraid set channels <число> <секунды> - порог каналов
!backup create - создать бэкап
!backup restore - восстановить из бэкапа
            `);
        }

        switch (subcommand) {
            case 'on':
                antiRaid.enabled.set(guildId, true);
                message.reply('Анти-рейд защита включена');
                break;

            case 'off':
                antiRaid.enabled.set(guildId, false);
                message.reply('Анти-рейд защита выключена');
                break;

            case 'status':
                const settings = antiRaid.settings.get(guildId) || {
                    joinThreshold: 5,
                    joinWindow: 10,
                    roleThreshold: 3,
                    roleWindow: 5,
                    channelThreshold: 3,
                    channelWindow: 5
                };
                
                const status = antiRaid.enabled.get(guildId) ? 'Включена' : 'Выключена';
                message.reply(`
Статус защиты: ${status}
Параметры:
- Заходы: ${settings.joinThreshold} за ${settings.joinWindow} сек
- Роли: ${settings.roleThreshold} за ${settings.roleWindow} сек
- Каналы: ${settings.channelThreshold} за ${settings.channelWindow} сек
                `);
                break;

            case 'set':
                const settingType = args[1];
                const threshold = parseInt(args[2]);
                const timeWindow = parseInt(args[3]);

                if (!settingType || isNaN(threshold) || isNaN(timeWindow)) {
                    return message.reply('Использование: !antiraid set <joins/roles/channels> <число> <секунды>');
                }

                const currentSettings = antiRaid.settings.get(guildId) || {};
                
                switch (settingType) {
                    case 'joins':
                        currentSettings.joinThreshold = threshold;
                        currentSettings.joinWindow = timeWindow;
                        message.reply(`Порог заходов: ${threshold} за ${timeWindow} сек`);
                        break;
                    case 'roles':
                        currentSettings.roleThreshold = threshold;
                        currentSettings.roleWindow = timeWindow;
                        message.reply(`Порог ролей: ${threshold} за ${timeWindow} сек`);
                        break;
                    case 'channels':
                        currentSettings.channelThreshold = threshold;
                        currentSettings.channelWindow = timeWindow;
                        message.reply(`Порог каналов: ${threshold} за ${timeWindow} сек`);
                        break;
                    default:
                        return message.reply('Неверный тип. Используйте: joins, roles, channels');
                }
                
                antiRaid.settings.set(guildId, currentSettings);
                break;

            default:
                message.reply('Неизвестная команда. Используйте !antiraid help');
        }
    }
};
