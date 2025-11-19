// events/interactionCreate.js

const { Events } = require('discord.js');
const { logToDiscord } = require('../utils/catch_log.js');
const config = require('../config/manage_environments.js');

const ALLOWED_GUILD_ID = config.discord.guildId;
const OWNER_ID = config.discord.ownerId;

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        if (client.amIActive === false) {
            return;
        }

        const foundUser = await WhiteList.findOne({ memberId: interaction.user.id });

        if (interaction.guildId !== ALLOWED_GUILD_ID && interaction.user.id !== OWNER_ID || !foundUser.isWhite) {
            return interaction.reply({ 
                content: '이 봇은 승인된 서버 내부 또는 화이트 리스트 유저만 사용할 수 있습니다. 🔒', 
                ephemeral: true
            });
        }

        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`'${interaction.commandName}'에 해당하는 명령어를 찾을 수 없습니다.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Error executing ${interaction.commandName}`);
            await logToDiscord(client, 'ERROR', `/${interaction.commandName} 명령어 실행 중 오류 발생`, interaction, error);

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: '명령어 실행 중 오류가 발생했습니다!', ephemeral: true });
            } else {
                await interaction.reply({ content: '명령어 실행 중 오류가 발생했습니다!', ephemeral: true });
            }
        }
    },
};