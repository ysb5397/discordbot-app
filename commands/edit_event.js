const { SlashCommandBuilder, PermissionsBitField, ChannelType, GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType } = require('discord.js');
const { parseKSTDateTime } = require('../utils/time.js'); // 방금 만든 유틸리티 함수 불러오기

module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit_event')        
        .setDescription('기존 서버 이벤트를 수정합니다.')
        .addStringOption(option => option.setName('current_name').setDescription('수정할 이벤트의 현재 이름').setRequired(true))
        .addStringOption(option => option.setName('new_name').setDescription('새 이벤트 이름 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_description').setDescription('새 이벤트 설명 (선택 사항)').setRequired(false))
        .addStringOption(option => option.setName('new_start_time').setDescription("새 시작 시간 (예: '2025-05-11 21:00') - KST").setRequired(false))
        .addChannelOption(option => option.setName('new_channel').setDescription('새 이벤트 채널 (선택 사항)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText).setRequired(false))
        .addStringOption(option => option.setName('new_end_time').setDescription("새 종료 시간 (예: '2025-05-11 23:00')").setRequired(false)),

    async execute(interaction) {
        // --- 여기부터 ---
        // (index.js의 'else if (commandName === 'edit_event')' 블록 안의 내용을
        //  그대로 복사해서 여기에 붙여넣습니다.)

        // 권한 확인
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
             return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true });
        }
        if (!interaction.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageEvents)) {
            return interaction.reply({ content: '봇이 이벤트를 수정할 권한이 없습니다. 서버 관리자에게 문의하세요.', ephemeral: true });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            const currentName = interaction.options.getString('current_name');
            const newName = interaction.options.getString('new_name');
            const newDescription = interaction.options.getString('new_description');
            const newStartTimeString = interaction.options.getString('new_start_time');            const newChannel = interaction.options.getChannel('new_channel');
            const newEndTimeString = interaction.options.getString('new_end_time');

            // 이름으로 이벤트 찾기 (대소문자 구분 없이)
            const events = await interaction.guild.scheduledEvents.fetch();
            const targetEvents = events.filter(event => event.name.toLowerCase() === currentName.toLowerCase());

            if (targetEvents.size === 0) {
                return interaction.editReply(`❌ 이름이 "${currentName}"인 이벤트를 찾을 수 없습니다.`);
            }
            if (targetEvents.size > 1) {
                // 중복 이름 처리: 사용자에게 ID로 다시 시도하도록 안내 (ID 기반 수정은 아직 구현 안 됨)
                const eventList = targetEvents.map((event, id) => ` - ${event.name} (ID: ${id})`).join('\n');
                return interaction.editReply(`❌ 이름이 "${currentName}"인 이벤트가 여러 개 있습니다. 더 구체적인 이름이나 ID로 수정해주세요.\n발견된 이벤트:\n${eventList}\n(ID 기반 수정은 아직 지원되지 않습니다.)`);
            }

            const eventToEdit = targetEvents.first();
            const editOptions = {}; // 수정할 옵션만 담을 객체

            // 각 옵션이 입력되었는지 확인하고 editOptions에 추가
            if (newName) editOptions.name = newName;
            if (newDescription) editOptions.description = newDescription;

            // 시작 시간 수정 처리
            if (newStartTimeString) {
                try {
                    // 수정된 parseKSTDateTime 함수 사용
                    editOptions.scheduledStartTime = parseKSTDateTime(newStartTimeString);
                    if (editOptions.scheduledStartTime < new Date()) { // 현재 시간보다 이전인지 확인
                        return interaction.editReply('오류: 새 시작 시간은 현재 시간 이후여야 합니다.');
                    }
                    console.log(`[Schedule Edit] Parsed new start time: ${newStartTimeString} KST -> ${editOptions.scheduledStartTime.toISOString()} UTC`);
                } catch (e) {
                    console.error("New Start Date parsing error:", e);
                    return interaction.editReply(`오류: 새 시작 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`);
                }
            }
            // 채널 수정 처리
            if (newChannel) {
                if (![ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText].includes(newChannel.type)) {
                    return interaction.editReply('오류: 이벤트 채널은 음성 또는 텍스트 채널이어야 합니다.');
                }
                editOptions.channel = newChannel.id;
            }
            // 종료 시간 수정 처리
            if (newEndTimeString) {
                try {
                    const newEndTime = parseKSTDateTime(newEndTimeString);
                    if (newEndTime <= editOptions.scheduledStartTime) {
                        return interaction.editReply('오류: 새 종료 시간은 시작 시간 이후여야 합니다.');
                    }
                    editOptions.scheduledEndTime = newEndTime;
                } catch (e) {
                    console.error("New End Date parsing error:", e);
                    return interaction.editReply(`오류: 새 종료 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`);
                }
            }

            await eventToEdit.edit(editOptions);
            await interaction.editReply(`✅ 이벤트 "${currentName}"이(가) 성공적으로 수정되었습니다!`);
        } catch (error) {
            console.error('Error editing scheduled event:', error);
            await interaction.editReply('❌ 이벤트를 수정하는 중 오류가 발생했습니다.');
        }
        // --- 여기까지 ---
    },
};