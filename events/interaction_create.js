// events/interactionCreate.js

const { Events } = require('discord.js');
const { logToDiscord } = require('../utils/catch_log.js');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`'${interaction.commandName}'에 해당하는 명령어를 찾을 수 없습니다.`);
            return;
        }

        if (interaction.user.id !== process.env.MY_DISCORD_USER_ID) {
            return interaction.reply({ 
                content: '이 명령어는 봇 소유자만 사용할 수 있어요! 🔒', 
                ephemeral: true
            });
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