const { SlashCommandBuilder, PermissionsBitField, ChannelType, GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType } = require('discord.js');
const { parseKSTDateTime } = require('../utils/time.js'); // 방금 만든 유틸리티 함수 불러오기

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delete_event')
        .setDescription('기존 서버 이벤트를 삭제합니다.')
        .addStringOption(option => option.setName('event_name').setDescription('삭제할 이벤트의 이름').setRequired(true)),

    async execute(interaction) {
        // --- 여기부터 ---
        // (index.js의 'else if (commandName === 'delete_event')' 블록 안의 내용을
        //  그대로 복사해서 여기에 붙여넣습니다.)

        // 권한 확인
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
            return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true });
        }
        if (!interaction.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageEvents)) {
            return interaction.reply({ content: '봇이 이벤트를 삭제할 권한이 없습니다. 서버 관리자에게 문의하세요.', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            const eventName = interaction.options.getString('event_name');

            // 이름으로 이벤트 찾기 (대소문자 구분 없이)
            const events = await interaction.guild.scheduledEvents.fetch();
            const targetEvents = events.filter(event => event.name.toLowerCase() === eventName.toLowerCase());

            if (targetEvents.size === 0) {
                return interaction.editReply(`❌ 이름이 "${eventName}"인 이벤트를 찾을 수 없습니다.`);
            }
            if (targetEvents.size > 1) {
                // 중복 이름 처리: 사용자에게 ID로 다시 시도하도록 안내 (ID 기반 삭제는 아직 구현 안 됨)
                const eventList = targetEvents.map((event, id) => ` - ${event.name} (ID: ${id})`).join('\n');
                return interaction.editReply(`❌ 이름이 "${eventName}"인 이벤트가 여러 개 있습니다. 더 구체적인 이름이나 ID로 삭제해주세요.\n발견된 이벤트:\n${eventList}\n(ID 기반 삭제는 아직 지원되지 않습니다.)`);
            }

            const eventToDelete = targetEvents.first();
            await eventToDelete.delete();
            await interaction.editReply(`✅ 이벤트 "${eventToDelete.name}"이(가) 성공적으로 삭제되었습니다!`);

        } catch (error) {
            console.error('Error deleting scheduled event:', error);
            await interaction.editReply('❌ 이벤트를 삭제하는 중 오류가 발생했습니다.');
        }
        // --- 여기까지 ---
    },
};