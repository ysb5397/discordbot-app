// commands/delete_event.js

const { SlashCommandBui_eventlder, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delete_event')
        .setDescription('서버 이벤트를 삭제합니다.')
        .addStringOption(option => option.setName('name').setDescription('삭제할 이벤트의 이름').setRequired(true)),

    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
            return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            const eventName = interaction.options.getString('name');
            const events = await interaction.guild.scheduledEvents.fetch();
            const targetEvent = events.find(event => event.name.toLowerCase() === eventName.toLowerCase());

            if (!targetEvent) {
                return interaction.editReply(`❌ 이름이 "${eventName}"인 이벤트를 찾을 수 없습니다.`);
            }

            await targetEvent.delete();
            await interaction.editReply(`✅ 이벤트 "${eventName}"이(가) 성공적으로 삭제되었습니다!`);

        } catch (error) {
            console.error('Error deleting scheduled event:', error);
            await interaction.editReply('❌ 이벤트를 삭제하는 중 오류가 발생했습니다.');
        }
    },
};