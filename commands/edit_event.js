// commands/edit_event.js

const { SlashCommandBuilder, PermissionsBitField, ChannelType, GuildScheduledEventEntityType } = require('discord.js');
const { parseKSTDateTime } = require('../utils/time.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit_event')
        .setDescription('기존 서버 이벤트를 수정합니다.')
        .addStringOption(option => option.setName('current_name').setDescription('수정할 이벤트의 현재 이름').setRequired(true))
        // ... (나머지 addStringOption, addChannelOption 등 기존 정의와 동일하게 추가)
        .addStringOption(option => option.setName('new_name').setDescription('새 이벤트 이름 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_description').setDescription('새 이벤트 설명 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_start_time').setDescription("새 시작 시간 (예: '2025-07-13 21:00') - KST").setRequired(false))
        .addChannelOption(option => option.setName('new_channel').setDescription('새 이벤트 채널 (선택 사항)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText).setRequired(false))
        .addStringOption(option => option.setName('new_end_time').setDescription("새 종료 시간 (예: '2025-07-13 23:00')").setRequired(false)),

    async execute(interaction) {
        // 권한 확인
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
            return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            const currentName = interaction.options.getString('current_name');
            const events = await interaction.guild.scheduledEvents.fetch();
            const targetEvent = events.find(event => event.name.toLowerCase() === currentName.toLowerCase());

            if (!targetEvent) {
                return interaction.editReply(`❌ 이름이 "${currentName}"인 이벤트를 찾을 수 없습니다.`);
            }

            const editOptions = {};
            const newName = interaction.options.getString('new_name');
            const newDescription = interaction.options.getString('new_description');
            const newStartTimeString = interaction.options.getString('new_start_time');
            const newChannel = interaction.options.getChannel('new_channel');
            const newEndTimeString = interaction.options.getString('new_end_time');

            if (newName) editOptions.name = newName;
            if (newDescription) editOptions.description = newDescription;
            // ... (index.js에 있던 나머지 수정 로직을 여기에 그대로 붙여넣습니다.)
            // 시간 파싱 등 모든 로직이 parseKSTDateTime 함수를 사용하도록 합니다.

            await targetEvent.edit(editOptions);
            await interaction.editReply(`✅ 이벤트 "${currentName}"이(가) 성공적으로 수정되었습니다!`);

        } catch (error) {
            console.error('Error editing scheduled event:', error);
            await interaction.editReply('❌ 이벤트를 수정하는 중 오류가 발생했습니다. 입력값을 확인해주세요.');
        }
    },
};