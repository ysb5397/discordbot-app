const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config/manage_environments');

OWNER_ID = config.discord.ownerId;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('intrusion')
        .setDescription('AI 봇의 대화 난입 설정을 변경합니다. (관리자 전용)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addIntegerOption(option =>
            option.setName('chance')
                .setDescription('난입 확률 (0 ~ 100%)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(100))
        .addIntegerOption(option =>
            option.setName('cooldown')
                .setDescription('난입 쿨타임 (초 단위)')
                .setRequired(false)
                .setMinValue(10)), // 최소 10초

    async execute(interaction) {
        const client = interaction.client;

        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '이 명령어는 관리자 전용입니다.', ephemeral: true });
        }

        // 초기화 안전 장치
        if (!client.intrusionConfig) {
            client.intrusionConfig = {
                chance: 0.05,
                cooldown: 60000,
                lastTime: 0
            };
        }

        const newChance = interaction.options.getInteger('chance');
        const newCooldown = interaction.options.getInteger('cooldown');

        let message = "⚙️ **난입 설정 변경 결과**\n";

        if (newChance !== null) {
            client.intrusionConfig.chance = newChance / 100; // 5 -> 0.05
            message += `- 확률: **${newChance}%**로 설정됨\n`;
        }

        if (newCooldown !== null) {
            client.intrusionConfig.cooldown = newCooldown * 1000; // 초 -> 밀리초
            message += `- 쿨타임: **${newCooldown}초**로 설정됨\n`;
        }

        if (newChance === null && newCooldown === null) {
            const currentChance = (client.intrusionConfig.chance * 100).toFixed(0);
            const currentCooldown = client.intrusionConfig.cooldown / 1000;
            message = `📊 **현재 난입 설정**\n- 확률: **${currentChance}%**\n- 쿨타임: **${currentCooldown}초**\n- 마지막 난입: <t:${Math.floor(client.intrusionConfig.lastTime / 1000)}:R>`;
        }

        await interaction.reply({ content: message, ephemeral: true });
    },
};