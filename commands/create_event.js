// commands/create_event.js

const { SlashCommandBuilder, PermissionsBitField, ChannelType, GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType } = require('discord.js');
const { parseKSTDateTime } = require('../utils/time.js'); // 방금 만든 유틸리티 함수 불러오기

module.exports = {
    data: new SlashCommandBuilder()
        .setName('create_event')
        .setDescription('서버 이벤트를 생성합니다.')
        .addStringOption(option => option.setName('name').setDescription('이벤트 이름').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('이벤트 설명').setRequired(true))
        .addStringOption(option => option.setName('start_time').setDescription("시작 시간 (예: '2025-07-13 20:00') - KST").setRequired(true))
        .addChannelOption(option => option.setName('channel').setDescription('이벤트 채널').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText).setRequired(true))
        .addStringOption(option => option.setName('end_time').setDescription("종료 시간 (예: '2025-07-13 22:00') - 텍스트 채널 시 필수").setRequired(false)),

    async execute(interaction) {
        // --- 여기부터 ---
        // (index.js의 'else if (commandName === 'create_event')' 블록 안의 내용을
        //  그대로 복사해서 여기에 붙여넣습니다.)
        
        // 권한 확인
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageEvents)) {
             return interaction.reply({ content: '이 명령어를 사용하려면 "이벤트 관리" 권한이 필요합니다.', ephemeral: true });
        }
        
        try {
            await interaction.deferReply({ ephemeral: true });

            const eventName = interaction.options.getString('name');
            // ... (나머지 옵션 가져오는 코드) ...
            const startTimeString = interaction.options.getString('start_time');

            let scheduledStartTime;
            try {
                // 분리된 함수 사용
                scheduledStartTime = parseKSTDateTime(startTimeString);
                // ... (나머지 시간 처리 및 이벤트 생성 로직) ...

            } catch (e) {
                return interaction.editReply(`오류: 시작 시간 형식이 잘못되었습니다. 'YYYY-MM-DD HH:MM' 형식으로 입력해주세요.`);
            }

            // ... (기존 이벤트 생성 로직 전체) ...
            
            await interaction.guild.scheduledEvents.create(eventOptions);
            await interaction.editReply(`✅ 이벤트 "${eventName}"이(가) 성공적으로 생성되었습니다!`);

        } catch (error) {
            console.error('Error creating scheduled event:', error);
            await interaction.editReply('❌ 이벤트를 생성하는 중 오류가 발생했습니다.');
        }
        // --- 여기까지 ---
    },
};