// commands/event.js

const { SlashCommandBuilder, PermissionsBitField, ChannelType, GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType } = require('discord.js');
const { parseKSTDateTime } = require('../utils/time.js');

/**
 * 길드의 예약된 이벤트를 이름으로 찾는 헬퍼 함수
 * @param {import('discord.js').Interaction} interaction - 명령어 상호작용
 * @param {string} name - 찾을 이벤트의 이름
 * @returns {Promise<import('discord.js').GuildScheduledEvent|null>} - 찾은 이벤트 객체 또는 null
 */
async function findEventByName(interaction, name) {
    const events = await interaction.guild.scheduledEvents.fetch();
    return events.find(event => event.name.toLowerCase() === name.toLowerCase()) || null;
}

module.exports = {
    // 1. data: 서브커맨드를 사용하여 명령어 구조를 통합
    data: new SlashCommandBuilder()
        .setName('event')
        .setDescription('서버 이벤트를 관리합니다.')
        // 2. setDefaultMemberPermissions: 명령어 자체에 권한을 설정 (코드 중복 제거)
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageEvents)
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('새로운 이벤트를 생성합니다.')
                .addStringOption(option => option.setName('name').setDescription('이벤트 이름').setRequired(true))
                .addStringOption(option => option.setName('description').setDescription('이벤트 설명').setRequired(true))
                .addStringOption(option => option.setName('start_time').setDescription("시작 시간 (예: '2025-10-03 20:00') - KST").setRequired(true))
                .addChannelOption(option => option.setName('channel').setDescription('이벤트 채널 (음성/스테이지/텍스트)').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(true))
                .addStringOption(option => option.setName('end_time').setDescription("종료 시간 (예: '2025-10-03 22:00') - KST").setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription('기존 이벤트를 수정합니다.')
                .addStringOption(option => option.setName('name').setDescription('수정할 이벤트의 현재 이름').setRequired(true))
                .addStringOption(option => option.setName('new_name').setDescription('새 이벤트 이름').setRequired(false))
                .addStringOption(option => option.setName('new_description').setDescription('새 이벤트 설명').setRequired(false))
                .addStringOption(option => option.setName('new_start_time').setDescription("새 시작 시간 (예: '2025-10-03 21:00')").setRequired(false))
                .addChannelOption(option => option.setName('new_channel').setDescription('새 이벤트 채널').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(false))
                .addStringOption(option => option.setName('new_end_time').setDescription("새 종료 시간").setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('이벤트를 삭제합니다.')
                .addStringOption(option => option.setName('name').setDescription('삭제할 이벤트의 이름').setRequired(true))
        ),

    // 3. execute: 서브커맨드에 따라 로직을 분기
    async execute(interaction) {
        // 권한 확인 코드가 필요 없음! (setDefaultMemberPermissions가 이미 처리)
        
        const subcommand = interaction.options.getSubcommand();

        try {
            await interaction.deferReply({ ephemeral: true });

            if (subcommand === 'create') {
                const name = interaction.options.getString('name');
                const description = interaction.options.getString('description');
                const startTimeString = interaction.options.getString('start_time');
                const channel = interaction.options.getChannel('channel');
                const endTimeString = interaction.options.getString('end_time');

                const scheduledStartTime = parseKSTDateTime(startTimeString);
                const scheduledEndTime = endTimeString ? parseKSTDateTime(endTimeString) : null;

                if (scheduledEndTime && scheduledStartTime >= scheduledEndTime) {
                    return interaction.editReply('❌ 종료 시간은 시작 시간보다 빨라야 합니다.');
                }

                await interaction.guild.scheduledEvents.create({
                    name,
                    description,
                    scheduledStartTime,
                    scheduledEndTime,
                    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
                    entityType: GuildScheduledEventEntityType.Voice,
                    channel: channel.id,
                });
                await interaction.editReply(`✅ 이벤트 "${name}"이(가) 성공적으로 생성되었습니다!`);
            
            } else if (subcommand === 'edit') {
                const name = interaction.options.getString('name');
                const targetEvent = await findEventByName(interaction, name);

                if (!targetEvent) {
                    return interaction.editReply(`❌ 이름이 "${name}"인 이벤트를 찾을 수 없습니다.`);
                }
                
                const editOptions = {
                    name: interaction.options.getString('new_name') || undefined,
                    description: interaction.options.getString('new_description') || undefined,
                    channel: interaction.options.getChannel('new_channel')?.id || undefined,
                    scheduledStartTime: interaction.options.getString('new_start_time') ? parseKSTDateTime(interaction.options.getString('new_start_time')) : undefined,
                    scheduledEndTime: interaction.options.getString('new_end_time') ? parseKSTDateTime(interaction.options.getString('new_end_time')) : undefined,
                };

                // 빈 객체는 edit을 호출하지 않도록 필터링
                const filteredOptions = Object.fromEntries(Object.entries(editOptions).filter(([_, v]) => v !== undefined));
                
                if (Object.keys(filteredOptions).length === 0) {
                    return interaction.editReply('⚠️ 수정할 내용을 하나 이상 입력해주세요.');
                }

                await targetEvent.edit(filteredOptions);
                await interaction.editReply(`✅ 이벤트 "${name}"이(가) 성공적으로 수정되었습니다!`);

            } else if (subcommand === 'delete') {
                const name = interaction.options.getString('name');
                const targetEvent = await findEventByName(interaction, name);

                if (!targetEvent) {
                    return interaction.editReply(`❌ 이름이 "${name}"인 이벤트를 찾을 수 없습니다.`);
                }
                
                await targetEvent.delete();
                await interaction.editReply(`✅ 이벤트 "${name}"이(가) 성공적으로 삭제되었습니다!`);
            }
        } catch (error) {
            console.error(`Error during /event ${subcommand}:`, error);
            // 시간 파싱 에러를 잡기 위한 좀 더 친절한 메시지
            if (error.message.includes("Invalid time value")) {
                return interaction.editReply("❌ 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.");
            }
            await interaction.editReply('❌ 명령을 처리하는 중 오류가 발생했습니다.');
        }
    },
};