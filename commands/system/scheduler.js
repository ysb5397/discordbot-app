const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { SchedulerConfig } = require('../../utils/system/database.js');
const { reloadBriefingSchedule } = require('../../utils/scheduler/briefing_scheduler.js');
const config = require('../../config/manage_environments.js');

const OWNER_ID = config.discord.ownerId;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('scheduler')
        .setDescription('봇의 자동 작업 스케줄을 관리합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // 관리자만 가능
        // 1. 지진 감지 설정
        .addSubcommand(subcommand =>
            subcommand
                .setName('earthquake')
                .setDescription('지진 정보 확인 주기를 설정합니다.')
                .addIntegerOption(option =>
                    option.setName('interval')
                        .setDescription('확인 주기 (초 단위, 최소 30초)')
                        .setRequired(true)
                        .setMinValue(30)))
        // 2. 일일 브리핑 설정
        .addSubcommand(subcommand =>
            subcommand
                .setName('briefing')
                .setDescription('매일 특정 시간에 AI 브리핑을 받습니다.')
                .addStringOption(option =>
                    option.setName('time')
                        .setDescription('브리핑 시간 (예: 08:30)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('topic')
                        .setDescription('브리핑 주제 (기본값: 오늘의 주요 뉴스)')
                        .setRequired(false))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('브리핑을 받을 채널 (기본값: 현재 채널)')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('active')
                        .setDescription('브리핑 활성화 여부 (기본값: True)')
                        .setRequired(false))),

    async execute(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ 관리자만 사용할 수 있는 명령어입니다.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        await interaction.deferReply();

        try {
            if (subcommand === 'earthquake') {
                const interval = interaction.options.getInteger('interval');

                await SchedulerConfig.findOneAndUpdate(
                    { type: 'EARTHQUAKE', guildId: 'GLOBAL' },
                    {
                        scheduleValue: interval.toString(),
                        isActive: true
                    },
                    { upsert: true, new: true }
                );

                await interaction.editReply(`✅ **지진 감지 주기 설정 완료!**\n이제 **${interval}초**마다 기상청 정보를 확인해.`);
            }

            else if (subcommand === 'briefing') {
                const timeStr = interaction.options.getString('time');
                const topic = interaction.options.getString('topic') || "오늘의 주요 뉴스 및 트렌드";
                const channel = interaction.options.getChannel('channel') || interaction.channel;
                const isActive = interaction.options.getBoolean('active') !== false;

                const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
                if (!timeRegex.test(timeStr)) {
                    return interaction.editReply('❌ 시간 형식이 잘못됐어! **HH:MM** (예: 08:30, 23:00) 형식으로 입력해줘.');
                }

                await SchedulerConfig.findOneAndUpdate(
                    { type: 'BRIEFING', guildId: guildId },
                    {
                        scheduleValue: timeStr,
                        channelId: channel.id,
                        extraData: { topic: topic },
                        isActive: isActive
                    },
                    { upsert: true, new: true }
                );

                await reloadBriefingSchedule(interaction.client);

                if (isActive) {
                    await interaction.editReply(`✅ **일일 브리핑 예약 완료!**\n\n⏰ 시간: 매일 **${timeStr}**\n📺 채널: ${channel}\n📝 주제: **${topic}**\n\n내일부터 꼬박꼬박 챙겨줄게! 😉`);
                } else {
                    await interaction.editReply(`💤 **일일 브리핑을 껐어.** 필요하면 다시 켜줘!`);
                }
            }

        } catch (error) {
            console.error('[/scheduler] 오류:', error);
            await interaction.editReply(`설정 저장 중 오류가 발생했어: ${error.message}`);
        }
    },
};