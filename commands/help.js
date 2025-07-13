const { SlashCommandBuilder, PermissionsBitField, ChannelType, GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType } = require('discord.js');
const { parseKSTDateTime } = require('../utils/time.js'); // 방금 만든 유틸리티 함수 불러오기

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('봇 사용법과 명령어 목록을 보여줍니다.')
        .addStringOption(option => option.setName('command').setDescription('특정 명령어에 대한 도움말을 요청합니다.')),

    async execute(interaction) {
        // 권한 확인 (필요한 경우)
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.SendMessages)) {
            return interaction.reply({ content: '이 명령어를 사용하려면 메시지를 보낼 수 있는 권한이 필요합니다.', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            const commandName = interaction.options.getString('command');
            if (commandName) {
                // 특정 명령어에 대한 도움말 제공
                const command = interaction.client.commands.get(commandName);
                if (!command) {
                    return interaction.editReply(`❌ '${commandName}' 명령어를 찾을 수 없습니다.`);
                }
                const helpMessage = `**명령어:** \`${command.data.name}\`\n**설명:** ${command.data.description}`;
                return interaction.editReply(helpMessage);
            } else {
                // 전체 명령어 목록 제공
                const commandsList = interaction.client.commands.map(cmd => `\`${cmd.data.name}\`: ${cmd.data.description}`).join('\n');
                return interaction.editReply(`**사용 가능한 명령어 목록:**\n${commandsList}`);
            }
        } catch (error) {
            console.error('Error executing help command:', error);
            await interaction.editReply('❌ 도움말을 가져오는 중 오류가 발생했습니다.');
        }
    },
};